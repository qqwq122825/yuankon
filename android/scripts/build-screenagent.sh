#!/usr/bin/env bash
# Build a copy of the single-frame ScreenAgent adapter; leave both source templates intact.
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
for tool in "$JAVA_HOME/bin/java" "$GRADLE" "$TOOLS/apksigner" "$TOOLS/zipalign"; do
  [[ -x "$tool" ]] || { echo "Missing local tool: $tool" >&2; exit 1; }
done
[[ -f "$ANDROID_HOME/platforms/android-35/android.jar" ]] || { echo 'Android API 35 is required.' >&2; exit 1; }
umask 077
mkdir -p "$ROOT/dist"
WORK="$(mktemp -d "$ROOT/dist/screenagent-XXXXXX")"
mkdir -p "$WORK/source/app"
cp "$ROOT/apk-templates/screenagent-1.0/"*.gradle.kts "$ROOT/apk-templates/screenagent-1.0/gradle.properties" "$WORK/source/"
cp "$ROOT/apk-templates/screenagent-1.0/app/"{build.gradle.kts,proguard-rules.pro} "$WORK/source/app/"
cp -R "$ROOT/apk-templates/screenagent-1.0/app/src" "$WORK/source/app/src"
ARGS=(--offline)
[[ "${SCREENAGENT_GRADLE_ONLINE:-0}" == 1 ]] && ARGS=()
echo "Build directory: $WORK"
"$GRADLE" -p "$WORK/source" "${ARGS[@]}" --no-daemon --console=plain assembleDebug lintDebug 2>&1 | tee "$WORK/build.log"
cp "$WORK/source/app/build/outputs/apk/debug/app-debug.apk" "$WORK/screenagent.apk"
"$TOOLS/apksigner" verify --verbose "$WORK/screenagent.apk" | tee "$WORK/signature.txt"
"$TOOLS/zipalign" -c -P 16 4 "$WORK/screenagent.apk"
shasum -a 256 "$WORK/screenagent.apk" | tee "$WORK/SHA256SUMS"
echo "APK: $WORK/screenagent.apk"
echo 'Single-frame development build. Physical-device verification remains a separate step.'
