#!/usr/bin/env bash
# Real build of the installer-1.2.7.5 A-package template using the local toolchain,
# replicating backend/src/apk-builder.js: copy source, inject config (AES-256-GCM
# payload + per-build key), assembleDebug + lintDebug, apksigner verify, zipalign,
# aapt badging. Also runs a Node-side GCM decrypt round-trip to prove the Java
# decrypt path in MainActivity recovers the exact B package before install.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
export JAVA_HOME="${JAVA_HOME:-$ROOT/android/.local-tools/jdk/Contents/Home}"
export ANDROID_HOME="${ANDROID_HOME:-$ROOT/android/.local-tools/android-sdk}"
export ANDROID_SDK_ROOT="$ANDROID_HOME"
export ANDROID_USER_HOME="${ANDROID_USER_HOME:-$ROOT/android/.local-tools/android-user}"
export GRADLE_USER_HOME="${GRADLE_USER_HOME:-$ROOT/android/.local-tools/gradle-home}"
export PATH="$JAVA_HOME/bin:$PATH"
GRADLE="${GRADLE:-$ROOT/android/.local-tools/gradle-8.11.1/bin/gradle}"
TOOLS="$ANDROID_HOME/build-tools/35.0.0"
TEMPLATE="$ROOT/android/apk-templates/a-packages/installer-1.2.7.5"
for tool in "$JAVA_HOME/bin/java" "$GRADLE" "$TOOLS/apksigner" "$TOOLS/zipalign" "$TOOLS/aapt"; do
  [[ -x "$tool" ]] || { echo "Missing local tool: $tool" >&2; exit 1; }
done
[[ -f "$ANDROID_HOME/platforms/android-35/android.jar" ]] || { echo 'Android API 35 is required.' >&2; exit 1; }
umask 077
mkdir -p "$ROOT/android/dist"
WORK="$(mktemp -d "$ROOT/android/dist/installer-1.2.7.5-XXXXXX")"
mkdir -p "$WORK/source/app"
exec > >(tee "$WORK/build.log") 2>&1
echo "[$(date -u +%FT%TZ)] [BUILD] START role=a template=a-packages/installer-1.2.7.5"
echo "[$(date -u +%FT%TZ)] [STAGE:preparing] copy registered A-package template and inject AES-GCM payload"
APP_ID="${INSTALLER1275_APP_ID:-org.test.installer1275}"
APP_LABEL="${INSTALLER1275_APP_LABEL:-Boundary Installer}"
cp "$TEMPLATE/"*.gradle.kts "$TEMPLATE/gradle.properties" "$WORK/source/"
cp "$TEMPLATE/app/"{build.gradle.kts,proguard-rules.pro} "$WORK/source/app/"
cp -R "$TEMPLATE/app/src" "$WORK/source/app/src"
python3 - "$WORK/source/app/src/main/res/values/strings.xml" "$APP_LABEL" <<'PY'
from pathlib import Path
import html
import sys
path = Path(sys.argv[1])
label = html.escape(sys.argv[2], quote=False)
text = path.read_text()
text = text.replace('<string name="app_name" translatable="false">Boundary Installer</string>', f'<string name="app_name" translatable="false">{label}</string>')
path.write_text(text)
PY
if [[ -n "${INSTALLER1275_PAYLOAD_APK:-}" ]]; then
  PAYLOAD_APK="$INSTALLER1275_PAYLOAD_APK"
  echo "[$(date -u +%FT%TZ)] [PAYLOAD] using provided B package: $PAYLOAD_APK"
else
  echo "[$(date -u +%FT%TZ)] [STAGE:payload] use most recent built B package before embedding"
  PAYLOAD_APK="$(ls -t "$ROOT/android/dist"/screenagent-*/screenagent.apk 2>/dev/null | head -1)"
fi
[[ -f "$PAYLOAD_APK" ]] || { echo "Missing B package payload" >&2; exit 1; }
SHA="$(shasum -a 256 "$PAYLOAD_APK" | awk '{print $1}')"
PKG="$($TOOLS/aapt dump badging "$PAYLOAD_APK" | sed -n "s/^package: name='\([^']*\)'.*/\1/p" | head -1)"
[[ -n "$PKG" ]] || { echo 'Unable to read B package id from payload APK' >&2; exit 1; }
BUILDID="${INSTALLER1275_PAYLOAD_BUILD_ID:-$(uuidgen | tr '[:upper:]' '[:lower:]')}"
# Encrypt the B package with AES-256-GCM exactly as backend/src/apk-builder.js does:
# per-build random 32-byte key + 12-byte nonce; payload.dat = nonce || ciphertext || tag.
node -e '
const fs = require("fs");
const crypto = require("crypto");
const orig = fs.readFileSync(process.argv[1]);
const key = crypto.randomBytes(32);
const nonce = crypto.randomBytes(12);
const cipher = crypto.createCipheriv("aes-256-gcm", key, nonce);
const ciphertext = Buffer.concat([cipher.update(orig), cipher.final()]);
const tag = cipher.getAuthTag();
fs.writeFileSync(process.argv[2], Buffer.concat([nonce, ciphertext, tag]));
fs.writeFileSync(process.argv[3], key.toString("base64"));
' "$PAYLOAD_APK" "$WORK/source/app/src/main/assets/payload.dat" "$WORK/.payload-key.b64"
PAYLOAD_KEY="$(cat "$WORK/.payload-key.b64")"
rm -f "$WORK/.payload-key.b64"
cat > "$WORK/source/app/src/main/assets/installer_config.json" <<EOF
{
  "payloadBuildId": "$BUILDID",
  "payloadSha256": "$SHA",
  "payloadKey": "$PAYLOAD_KEY",
  "payloadPackageName": "$PKG",
  "homeUrl": "https://example.com/"
}
EOF
sed -i.bak "s|__PAYLOAD_PACKAGE_NAME__|$PKG|g" "$WORK/source/app/src/main/AndroidManifest.xml"
rm -f "$WORK/source/app/src/main/AndroidManifest.xml.bak"
grep -A4 '<receiver' "$WORK/source/app/src/main/AndroidManifest.xml" | grep -q 'android:exported="false"' || {
  echo 'InstallReceiver must remain non-exported' >&2
  exit 1
}
# Node-side decrypt round-trip: read payload.dat + key exactly as MainActivity.decryptPayload()
# does (12-byte nonce, trailing 16-byte GCM tag, AES-256-GCM), and confirm the recovered
# bytes match the B package SHA-256. This proves the Java runtime will succeed.
echo "[$(date -u +%FT%TZ)] [STAGE:roundtrip] decrypt AES-GCM payload.dat and verify SHA-256"
node -e '
const fs = require("fs");
const crypto = require("crypto");
const blob = fs.readFileSync(process.argv[1]);
if (blob.length < 28) { console.error("payload too short"); process.exit(1); }
const key = Buffer.from(process.argv[2], "base64");
if (key.length !== 32) { console.error("bad key length"); process.exit(1); }
const nonce = blob.subarray(0, 12);
const body = blob.subarray(12);
const decipher = crypto.createDecipheriv("aes-256-gcm", key, nonce);
decipher.setAuthTag(body.subarray(body.length - 16));
const plain = Buffer.concat([decipher.update(body.subarray(0, body.length - 16)), decipher.final()]);
const sha = crypto.createHash("sha256").update(plain).digest("hex");
if (sha !== process.argv[3]) { console.error("round-trip sha mismatch"); process.exit(1); }
console.log("round-trip sha256=" + sha);
' "$WORK/source/app/src/main/assets/payload.dat" "$PAYLOAD_KEY" "$SHA"
echo "[$(date -u +%FT%TZ)] [PAYLOAD] buildId=$BUILDID package=$PKG sha256=$SHA format=aesgcm apk=$PAYLOAD_APK"
echo "[$(date -u +%FT%TZ)] [COMMAND:GRADLE_ASSEMBLE_LINT] START"
ARGS=(--offline)
[[ "${INSTALLER1275_GRADLE_ONLINE:-0}" == 1 ]] && ARGS=(--refresh-dependencies)
"$GRADLE" -p "$WORK/source" "${ARGS[@]}" --no-daemon --console=plain \
  -PappId="$APP_ID" -PversionName=1.2.7.5 -PversionCode=375 assembleDebug lintDebug
echo "[$(date -u +%FT%TZ)] [COMMAND:GRADLE_ASSEMBLE_LINT] OK"
cp "$WORK/source/app/build/outputs/apk/debug/app-debug.apk" "$WORK/installer-1.2.7.5.apk"
echo "[$(date -u +%FT%TZ)] [STAGE:signing] verify APK development signature"
"$TOOLS/apksigner" verify --verbose "$WORK/installer-1.2.7.5.apk" | tee "$WORK/signature.txt"
echo "[$(date -u +%FT%TZ)] [COMMAND:APKSIGNER_VERIFY] OK"
echo "[$(date -u +%FT%TZ)] [STAGE:aligning] verify 4-byte and 16 KiB page alignment"
"$TOOLS/zipalign" -c -P 16 4 "$WORK/installer-1.2.7.5.apk"
echo "[$(date -u +%FT%TZ)] [COMMAND:ZIPALIGN_VERIFY] OK"
echo "[$(date -u +%FT%TZ)] [STAGE:inspecting] read package, version and launcher metadata"
"$TOOLS/aapt" dump badging "$WORK/installer-1.2.7.5.apk" | tee "$WORK/badging.txt"
grep -q "package: name='$APP_ID'" "$WORK/badging.txt" || { echo "APK identity mismatch: package, expected $APP_ID" >&2; exit 1; }
grep -q "versionName='1.2.7.5'" "$WORK/badging.txt" || { echo 'APK identity mismatch: versionName' >&2; exit 1; }
grep -q "versionCode='375'" "$WORK/badging.txt" || { echo 'APK identity mismatch: versionCode' >&2; exit 1; }
grep -q '^launchable-activity:' "$WORK/badging.txt" || { echo 'Visible package is missing its launcher activity' >&2; exit 1; }
grep -q "uses-permission: name='android.permission.REQUEST_INSTALL_PACKAGES'" "$WORK/badging.txt" || { echo 'Missing REQUEST_INSTALL_PACKAGES' >&2; exit 1; }
"$TOOLS/aapt" dump xmltree "$WORK/installer-1.2.7.5.apk" AndroidManifest.xml > "$WORK/manifest-tree.txt"
grep -q 'VpnKillService' "$WORK/manifest-tree.txt" || { echo 'Missing VpnKillService in manifest' >&2; exit 1; }
grep -q 'android.permission.BIND_VPN_SERVICE' "$WORK/manifest-tree.txt" || { echo 'Missing BIND_VPN_SERVICE on service' >&2; exit 1; }
grep -q 'android.net.VpnService' "$WORK/manifest-tree.txt" || { echo 'Missing VpnService intent-filter' >&2; exit 1; }
grep -q 'InstallReceiver' "$WORK/manifest-tree.txt" || { echo 'Missing InstallReceiver in manifest' >&2; exit 1; }
unzip -l "$WORK/installer-1.2.7.5.apk" > "$WORK/apk-list.txt" 2>/dev/null
grep -q 'assets/payload.dat' "$WORK/apk-list.txt" || { echo 'Missing AES-GCM payload.dat asset' >&2; exit 1; }
grep -q 'assets/payload.apk' "$WORK/apk-list.txt" && { echo 'Unexpected plaintext payload.apk asset' >&2; exit 1; }
echo "[$(date -u +%FT%TZ)] [ROLE] launcher=present expected=present"
shasum -a 256 "$WORK/installer-1.2.7.5.apk" | tee "$WORK/SHA256SUMS"
echo "Build work directory: $WORK"
echo "[$(date -u +%FT%TZ)] [BUILD] SUCCEEDED"
echo "APK: $WORK/installer-1.2.7.5.apk"
echo 'Development build verified. Device runtime (VPN consent, draining tunnel, install, guide) is a separate step.'
