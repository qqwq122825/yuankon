#!/usr/bin/env bash
# Build the unchanged, fixed local browser template without the retired PHP worker.
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
  [[ -x "$tool" ]] || { echo "Missing local build tool: $tool" >&2; exit 1; }
done
[[ -f "$ANDROID_HOME/platforms/android-35/android.jar" ]] || { echo 'Android API 35 is required.' >&2; exit 1; }
umask 077
mkdir -p "$ROOT/dist"
WORK="$(mktemp -d "$ROOT/dist/browser-template-XXXXXX")"
mkdir -p "$WORK/source"
# Copy only fixed source; never reuse a previous build directory or local.properties.
cp "$ROOT/apk-templates/browser-1.0/"*.gradle "$ROOT/apk-templates/browser-1.0/gradle.properties" "$WORK/source/"
mkdir -p "$WORK/source/app"
cp "$ROOT/apk-templates/browser-1.0/app/build.gradle" "$WORK/source/app/"
cp -R "$ROOT/apk-templates/browser-1.0/app/src" "$WORK/source/app/src"
echo "Build directory: $WORK"
"$GRADLE" -p "$WORK/source" --offline --no-daemon --console=plain assembleDebug lintDebug 2>&1 | tee "$WORK/build.log"
cp "$WORK/source/app/build/outputs/apk/debug/app-debug.apk" "$WORK/browser.apk"
"$TOOLS/apksigner" verify --verbose "$WORK/browser.apk" | tee "$WORK/signature.txt"
"$TOOLS/zipalign" -c -P 16 4 "$WORK/browser.apk"
shasum -a 256 "$WORK/browser.apk" | tee "$WORK/SHA256SUMS"
echo "APK: $WORK/browser.apk"
echo 'Development build verified. Device runtime and Telegram delivery are not tested by this command.'
