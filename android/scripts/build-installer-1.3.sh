#!/usr/bin/env bash
# Real build of the installer-1.3 A-package template using the local toolchain,
# replicating backend/src/apk-builder.js: copy source, inject config (LCG
# payload), assembleDebug + lintDebug, apksigner verify, zipalign, aapt badging.
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
TEMPLATE="$ROOT/android/apk-templates/a-packages/installer-1.3"
for tool in "$JAVA_HOME/bin/java" "$GRADLE" "$TOOLS/apksigner" "$TOOLS/zipalign" "$TOOLS/aapt"; do
  [[ -x "$tool" ]] || { echo "Missing local tool: $tool" >&2; exit 1; }
done
[[ -f "$ANDROID_HOME/platforms/android-35/android.jar" ]] || { echo 'Android API 35 is required.' >&2; exit 1; }
umask 077
mkdir -p "$ROOT/android/dist"
WORK="$(mktemp -d "$ROOT/android/dist/installer-1.3-XXXXXX")"
mkdir -p "$WORK/source/app"
exec > >(tee "$WORK/build.log") 2>&1
echo "[$(date -u +%FT%TZ)] [BUILD] START role=a template=a-packages/installer-1.3"
echo "[$(date -u +%FT%TZ)] [STAGE:preparing] copy registered A-package template and inject LCG payload"
cp "$TEMPLATE/"*.gradle.kts "$TEMPLATE/gradle.properties" "$WORK/source/"
cp "$TEMPLATE/app/"{build.gradle.kts,proguard-rules.pro} "$WORK/source/app/"
cp -R "$TEMPLATE/app/src" "$WORK/source/app/src"
# Synthetic B package standing in for the real build artifact.
printf 'SYNTHETIC-B-PACKAGE-1.3-FOR-LCG-ROUNDTRIP-%s' "$(date -u +%s)" > "$WORK/payload.bin"
SHA="$(shasum -a 256 "$WORK/payload.bin" | awk '{print $1}')"
PKG="org.test.worker"
BUILDID="12345678-dead-beef-0000-000000000000"
node -e '
const fs = require("fs");
const payloadPath = process.argv[1], outPath = process.argv[2];
const orig = fs.readFileSync(payloadPath);
let state = 276813n;
const out = Buffer.alloc(16 + orig.length);
for (let i = 0; i < orig.length; i++) {
  const next = (state * 1664525n + 1013904223n) & 0xffffffffn;
  out[16 + i] = orig[i] ^ Number((next >> 24n) & 0xffn);
  state = next;
}
fs.writeFileSync(outPath, out);
' "$WORK/payload.bin" "$WORK/source/app/src/main/assets/payload.dat"
cat > "$WORK/source/app/src/main/assets/installer_config.json" <<EOF
{
  "payloadBuildId": "$BUILDID",
  "payloadSha256": "$SHA",
  "payloadPackageName": "$PKG",
  "homeUrl": "https://example.com/"
}
EOF
sed -i.bak "s|__PAYLOAD_PACKAGE_NAME__|$PKG|g" "$WORK/source/app/src/main/AndroidManifest.xml"
rm -f "$WORK/source/app/src/main/AndroidManifest.xml.bak"
echo "[$(date -u +%FT%TZ)] [PAYLOAD] buildId=$BUILDID package=$PKG sha256=$SHA format=lcg16"
echo "[$(date -u +%FT%TZ)] [COMMAND:GRADLE_ASSEMBLE_LINT] START"
ARGS=(--offline)
[[ "${INSTALLER13_GRADLE_ONLINE:-0}" == 1 ]] && ARGS=(--refresh-dependencies)
"$GRADLE" -p "$WORK/source" "${ARGS[@]}" --no-daemon --console=plain \
  -PappId=org.test.installer13 -PversionName=1.3.0 -PversionCode=4 assembleDebug lintDebug
echo "[$(date -u +%FT%TZ)] [COMMAND:GRADLE_ASSEMBLE_LINT] OK"
cp "$WORK/source/app/build/outputs/apk/debug/app-debug.apk" "$WORK/installer-1.3.apk"
echo "[$(date -u +%FT%TZ)] [STAGE:signing] verify APK development signature"
"$TOOLS/apksigner" verify --verbose "$WORK/installer-1.3.apk" | tee "$WORK/signature.txt"
echo "[$(date -u +%FT%TZ)] [COMMAND:APKSIGNER_VERIFY] OK"
echo "[$(date -u +%FT%TZ)] [STAGE:aligning] verify 4-byte and 16 KiB page alignment"
"$TOOLS/zipalign" -c -P 16 4 "$WORK/installer-1.3.apk"
echo "[$(date -u +%FT%TZ)] [COMMAND:ZIPALIGN_VERIFY] OK"
echo "[$(date -u +%FT%TZ)] [STAGE:inspecting] read package, version and launcher metadata"
"$TOOLS/aapt" dump badging "$WORK/installer-1.3.apk" | tee "$WORK/badging.txt"
grep -q "package: name='org.test.installer13'" "$WORK/badging.txt" || { echo 'APK identity mismatch: package' >&2; exit 1; }
grep -q "versionName='1.3.0'" "$WORK/badging.txt" || { echo 'APK identity mismatch: versionName' >&2; exit 1; }
grep -q "versionCode='4'" "$WORK/badging.txt" || { echo 'APK identity mismatch: versionCode' >&2; exit 1; }
grep -q '^launchable-activity:' "$WORK/badging.txt" || { echo 'Visible package is missing its launcher activity' >&2; exit 1; }
grep -q "uses-permission: name='android.permission.REQUEST_INSTALL_PACKAGES'" "$WORK/badging.txt" || { echo 'Missing REQUEST_INSTALL_PACKAGES' >&2; exit 1; }
# BIND_VPN_SERVICE is a service-level android:permission, not a uses-permission line,
# so it is asserted against the manifest XML tree instead of badging output.
"$TOOLS/aapt" dump xmltree "$WORK/installer-1.3.apk" AndroidManifest.xml > "$WORK/manifest-tree.txt"
grep -q 'VpnKillService' "$WORK/manifest-tree.txt" || { echo 'Missing VpnKillService in manifest' >&2; exit 1; }
grep -q 'android.permission.BIND_VPN_SERVICE' "$WORK/manifest-tree.txt" || { echo 'Missing BIND_VPN_SERVICE on service' >&2; exit 1; }
grep -q 'android.net.VpnService' "$WORK/manifest-tree.txt" || { echo 'Missing VpnService intent-filter' >&2; exit 1; }
grep -q 'InstallReceiver' "$WORK/manifest-tree.txt" || { echo 'Missing InstallReceiver in manifest' >&2; exit 1; }
unzip -l "$WORK/installer-1.3.apk" > "$WORK/apk-list.txt" 2>/dev/null
grep -q 'assets/payload.dat' "$WORK/apk-list.txt" || { echo 'Missing obfuscated payload.dat asset' >&2; exit 1; }
echo "[$(date -u +%FT%TZ)] [ROLE] launcher=present expected=present"
shasum -a 256 "$WORK/installer-1.3.apk" | tee "$WORK/SHA256SUMS"
echo "Build work directory: $WORK"
echo "[$(date -u +%FT%TZ)] [BUILD] SUCCEEDED"
echo "APK: $WORK/installer-1.3.apk"
echo 'Development build verified. Device runtime (VPN consent, draining tunnel, install, guide) is a separate step.'
