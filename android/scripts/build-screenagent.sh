#!/usr/bin/env bash
# Build a copy of the current user-consented MediaProjection ScreenAgent adapter.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
export JAVA_HOME="${JAVA_HOME:-$ROOT/.local-tools/jdk/Contents/Home}"
export ANDROID_HOME="${ANDROID_HOME:-$ROOT/.local-tools/android-sdk}"
export ANDROID_SDK_ROOT="$ANDROID_HOME"
export ANDROID_USER_HOME="${ANDROID_USER_HOME:-$ROOT/.local-tools/android-user}"
export GRADLE_USER_HOME="${GRADLE_USER_HOME:-$ROOT/.local-tools/gradle-home}"
export PATH="$JAVA_HOME/bin:$PATH"
GRADLE="${GRADLE:-$ROOT/.local-tools/gradle-8.11.1/bin/gradle}"
TOOLS="$ANDROID_HOME/build-tools/35.0.0"
TEMPLATE="$ROOT/apk-templates/b-packages/screenagent-1.8.5"
for tool in "$JAVA_HOME/bin/java" "$GRADLE" "$TOOLS/apksigner" "$TOOLS/zipalign" "$TOOLS/aapt"; do
  [[ -x "$tool" ]] || { echo "Missing local tool: $tool" >&2; exit 1; }
done
[[ -f "$ANDROID_HOME/platforms/android-35/android.jar" ]] || { echo 'Android API 35 is required.' >&2; exit 1; }
umask 077
mkdir -p "$ROOT/dist"
WORK="$(mktemp -d "$ROOT/dist/screenagent-XXXXXX")"
mkdir -p "$WORK/source/app"
exec > >(tee "$WORK/build.log") 2>&1
echo "[$(date -u +%FT%TZ)] [BUILD] START role=b template=b-packages/screenagent-1.8.5"
echo "[$(date -u +%FT%TZ)] [STAGE:preparing] copy registered B-package template"
cp "$TEMPLATE/"*.gradle.kts "$TEMPLATE/gradle.properties" "$WORK/source/"
cp "$TEMPLATE/app/"{build.gradle.kts,proguard-rules.pro} "$WORK/source/app/"
cp -R "$TEMPLATE/app/src" "$WORK/source/app/src"
ARGS=(--offline)
[[ "${SCREENAGENT_GRADLE_ONLINE:-0}" == 1 ]] && ARGS=(--refresh-dependencies)
echo "Build directory: $WORK"
echo "[$(date -u +%FT%TZ)] [COMMAND:GRADLE_ASSEMBLE_LINT] START"
"$GRADLE" -p "$WORK/source" "${ARGS[@]}" --no-daemon --console=plain \
  -PversionName=1.8.5 -PversionCode=23 assembleDebug lintDebug
echo "[$(date -u +%FT%TZ)] [COMMAND:GRADLE_ASSEMBLE_LINT] OK"
cp "$WORK/source/app/build/outputs/apk/debug/app-debug.apk" "$WORK/screenagent.apk"
echo "[$(date -u +%FT%TZ)] [STAGE:signing] verify APK development signature"
"$TOOLS/apksigner" verify --verbose "$WORK/screenagent.apk" | tee "$WORK/signature.txt"
echo "[$(date -u +%FT%TZ)] [COMMAND:APKSIGNER_VERIFY] OK"
echo "[$(date -u +%FT%TZ)] [STAGE:aligning] verify APK alignment"
"$TOOLS/zipalign" -c -P 16 -v 4 "$WORK/screenagent.apk"
echo "[$(date -u +%FT%TZ)] [COMMAND:ZIPALIGN_VERIFY] OK"
echo "[$(date -u +%FT%TZ)] [STAGE:inspecting] read package and launcher metadata"
"$TOOLS/aapt" dump badging "$WORK/screenagent.apk" | tee "$WORK/badging.txt"
if ! grep -q '^launchable-activity:' "$WORK/badging.txt"; then
  echo 'ScreenAgent 1.8.5 test package must expose its mode-selection launcher.' >&2
  exit 1
fi
grep -q "uses-permission: name='android.permission.FOREGROUND_SERVICE_MEDIA_PROJECTION'" \
  "$WORK/badging.txt" || { echo 'Missing mediaProjection foreground-service permission.' >&2; exit 1; }
echo "[$(date -u +%FT%TZ)] [ROLE] launcher=present expected=present"
shasum -a 256 "$WORK/screenagent.apk" | tee "$WORK/SHA256SUMS"
echo "[$(date -u +%FT%TZ)] [BUILD] SUCCEEDED"
echo "APK: $WORK/screenagent.apk"
echo 'User-consented MediaProjection screenshot and structural-node preview development build. Physical-device verification remains a separate step.'
