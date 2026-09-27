#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
export JAVA_HOME="${JAVA_HOME:-$ROOT/.local-tools/jdk/Contents/Home}"
export ANDROID_HOME="${ANDROID_HOME:-$ROOT/.local-tools/android-sdk}"
export ANDROID_USER_HOME="$ROOT/.local-tools/android-user"
export GRADLE_USER_HOME="$ROOT/.local-tools/gradle-home"
export PATH="$JAVA_HOME/bin:$PATH"
GRADLE="${GRADLE:-$ROOT/.local-tools/gradle-8.11.1/bin/gradle}"
TOOLS="$ANDROID_HOME/build-tools/35.0.0"
INPUT="$ROOT/inputs/safe.apk"
PROJECT="$ROOT/installer"
# Validate the original before embedding it. Never re-sign or modify the payload.
"$TOOLS/apksigner" verify "$INPUT"
"$TOOLS/aapt" dump badging "$INPUT" | grep -q "package: name='dev.boundarylab.app.b01a0b8762d7b719381cdf81c352e6c2b'"
mkdir -p "$PROJECT/app/src/main/assets" "$PROJECT/app/src/main/res/values" "$ROOT/dist/offline-installer"
cp "$INPUT" "$PROJECT/app/src/main/assets/safe.apk"
HASH="$(shasum -a 256 "$INPUT" | cut -d ' ' -f 1)"
printf '<resources><string name="payload_sha256" translatable="false">%s</string></resources>\n' "$HASH" > "$PROJECT/app/src/main/res/values/payload.xml"
"$GRADLE" -p "$PROJECT" --offline --console=plain assembleDebug lintDebug
OUTPUT="$ROOT/dist/offline-installer/a.apk"
cp "$PROJECT/app/build/outputs/apk/debug/app-debug.apk" "$OUTPUT"
"$TOOLS/apksigner" verify --verbose "$OUTPUT"
"$TOOLS/zipalign" -c -P 16 4 "$OUTPUT"
cmp "$INPUT" "$PROJECT/app/src/main/assets/safe.apk"
python3 - "$INPUT" "$OUTPUT" <<'PY'
import hashlib, json, pathlib, sys, zipfile
source, output = map(pathlib.Path, sys.argv[1:])
with zipfile.ZipFile(output) as apk:
    assert apk.read('assets/safe.apk') == source.read_bytes(), 'Embedded APK differs'
report = {'artifact': str(output), 'size_bytes': output.stat().st_size,
          'sha256': hashlib.sha256(output.read_bytes()).hexdigest(),
          'payload_sha256': hashlib.sha256(source.read_bytes()).hexdigest(),
          'embedded_payload_identical': True, 'signature_verified': True,
          'alignment_verified': True, 'device_tested': False,
          'signing': 'development debug certificate'}
output.with_suffix('.json').write_text(json.dumps(report, indent=2) + '\n')
print(json.dumps(report, indent=2))
PY
