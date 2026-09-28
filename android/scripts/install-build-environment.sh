#!/usr/bin/env bash
set -Eeuo pipefail

ROOT="${BOUNDARY_ROOT:-$(cd "$(dirname "$0")/../.." && pwd)}"
PRIVATE_DIR="${BOUNDARY_PRIVATE_DIR:-$ROOT/backend/.node-private}"
NODE_BIN="${BOUNDARY_NODE:-$(command -v node || true)}"
TOOLS="$ROOT/android/.local-tools"
DOWNLOADS="$TOOLS/downloads"
STAGING="$TOOLS/.environment-install.$$"
SDK="$TOOLS/android-sdk"
JDK="$TOOLS/jdk/Contents/Home"
GRADLE="$TOOLS/gradle-8.11.1"
GRADLE_HOME="$TOOLS/gradle-home"
ANDROID_USER_HOME="$TOOLS/android-user"

GRADLE_URL="https://services.gradle.org/distributions/gradle-8.11.1-bin.zip"
GRADLE_SHA256="f397b287023acdba1e9f6fc5ea72d22dd63669d59ed4a289a29b1a76eee151c6"
CMDLINE_URL="https://dl.google.com/android/repository/commandlinetools-linux-15859902_latest.zip"
CMDLINE_SHA256="4e4c464f145a7512b57d088ac6c278c03c9eea610886b35a5e0804e74eedf583"

stage() { printf '[STAGE:%s] %s\n' "$1" "$2"; }
die() { printf '[ERROR] %s\n' "$*" >&2; exit 1; }

sha256() {
    if command -v sha256sum >/dev/null 2>&1; then sha256sum "$1" | awk '{print $1}'
    else shasum -a 256 "$1" | awk '{print $1}'
    fi
}

download() {
    local name="$1"
    local url="$2"
    local expected="$3"
    local file="$DOWNLOADS/$name"
    local temporary="$file.part"
    if [[ -f "$file" && "$(sha256 "$file")" == "$expected" ]]; then
        printf '[CACHE] %s\n' "$name"
        return
    fi
    rm -f "$temporary"
    curl --fail --location --silent --show-error --retry 3 --retry-delay 2 \
        --connect-timeout 20 --output "$temporary" "$url"
    [[ "$(sha256 "$temporary")" == "$expected" ]] || die "$name SHA-256 校验失败"
    mv "$temporary" "$file"
}

replace_dir() {
    local source="$1"
    local target="$2"
    local backup="$target.previous"
    rm -rf "$backup"
    if [[ -e "$target" ]]; then mv "$target" "$backup"; fi
    if mv "$source" "$target"; then rm -rf "$backup"
    else
        if [[ -e "$backup" ]]; then mv "$backup" "$target"; fi
        return 1
    fi
}

cleanup() { rm -rf "$STAGING"; }
trap cleanup EXIT
umask 077

stage preflight '检查 Linux、下载工具和磁盘空间'
[[ "$(uname -s)" == "Linux" ]] || die '网页环境安装仅用于 Linux 服务器'
for command in curl tar unzip awk; do command -v "$command" >/dev/null || die "缺少命令：$command"; done
[[ -n "$NODE_BIN" && -x "$NODE_BIN" ]] || die '未找到当前 Node.js 可执行文件'
available_kb="$(df -Pk "$ROOT" | awk 'NR==2 {print $4}')"
[[ "$available_kb" =~ ^[0-9]+$ && "$available_kb" -ge 6291456 ]] || die '至少需要 6 GiB 可用磁盘空间'
mkdir -p "$DOWNLOADS" "$STAGING" "$SDK" "$GRADLE_HOME" "$ANDROID_USER_HOME" "$PRIVATE_DIR"

case "$(uname -m)" in
    x86_64|amd64)
        JDK_URL="https://github.com/adoptium/temurin17-binaries/releases/download/jdk-17.0.20.1%2B1/OpenJDK17U-jdk_x64_linux_hotspot_17.0.20.1_1.tar.gz"
        JDK_SHA256="3808d1d15e3ec6bd5b84057fb5d84c33d8a1536a258146bcea2e603fc726e08e"
        ;;
    aarch64|arm64)
        JDK_URL="https://github.com/adoptium/temurin17-binaries/releases/download/jdk-17.0.20.1%2B1/OpenJDK17U-jdk_aarch64_linux_hotspot_17.0.20.1_1.tar.gz"
        JDK_SHA256="457b57af8f9c93ec39080bb8c764f559dc8c89a6da1a39d718a400b7890d3e41"
        ;;
    *) die "不支持的服务器架构：$(uname -m)" ;;
esac

stage download-jdk '下载并校验 Eclipse Temurin JDK 17'
download 'temurin-jdk17.tar.gz' "$JDK_URL" "$JDK_SHA256"
mkdir -p "$STAGING/jdk/Contents/Home"
tar -xzf "$DOWNLOADS/temurin-jdk17.tar.gz" --strip-components=1 -C "$STAGING/jdk/Contents/Home"
[[ -x "$STAGING/jdk/Contents/Home/bin/java" ]] || die 'JDK 解压结果无效'
replace_dir "$STAGING/jdk" "$TOOLS/jdk"

stage download-gradle '下载并校验 Gradle 8.11.1'
download 'gradle-8.11.1-bin.zip' "$GRADLE_URL" "$GRADLE_SHA256"
unzip -q "$DOWNLOADS/gradle-8.11.1-bin.zip" -d "$STAGING/gradle"
[[ -x "$STAGING/gradle/gradle-8.11.1/bin/gradle" ]] || die 'Gradle 解压结果无效'
replace_dir "$STAGING/gradle/gradle-8.11.1" "$GRADLE"

stage download-sdk '下载并校验 Android 命令行工具'
download 'android-commandline-tools.zip' "$CMDLINE_URL" "$CMDLINE_SHA256"
unzip -q "$DOWNLOADS/android-commandline-tools.zip" -d "$STAGING/cmdline"
[[ -x "$STAGING/cmdline/cmdline-tools/bin/sdkmanager" ]] || die 'Android 命令行工具解压结果无效'
mkdir -p "$SDK/cmdline-tools"
replace_dir "$STAGING/cmdline/cmdline-tools" "$SDK/cmdline-tools/latest"

export JAVA_HOME="$JDK"
export ANDROID_HOME="$SDK"
export ANDROID_SDK_ROOT="$SDK"
export ANDROID_USER_HOME
export GRADLE_USER_HOME="$GRADLE_HOME"
export PATH="$JDK/bin:$SDK/cmdline-tools/latest/bin:$PATH"
SDKMANAGER="$SDK/cmdline-tools/latest/bin/sdkmanager"

stage sdk-licenses '接受固定 Android SDK 组件所需许可'
set +o pipefail
yes | "$SDKMANAGER" --sdk_root="$SDK" --licenses >/dev/null
license_status="${PIPESTATUS[1]}"
set -o pipefail
[[ "$license_status" -eq 0 ]] || die 'Android SDK 许可确认失败'

stage sdk-packages '安装 Android Platform 35、Build Tools 35.0.0 与 Platform Tools'
"$SDKMANAGER" --sdk_root="$SDK" \
    'platforms;android-35' 'build-tools;35.0.0' 'platform-tools'

stage gradle-cache '预编译登记模板并生成离线依赖缓存'
WARMUP="$PRIVATE_DIR/environment-warmup"
rm -rf "$WARMUP"
mkdir -p "$WARMUP"
mapfile -t template_dirs < <(
    "$NODE_BIN" -e '
        const fs = require("node:fs");
        const path = require("node:path");
        const root = process.argv[1];
        const base = path.join(root, "android/apk-templates");
        const rows = JSON.parse(fs.readFileSync(path.join(base, "templates.json"), "utf8"));
        for (const row of rows) {
            const resolved = path.resolve(base, row.sourceDir);
            if (!resolved.startsWith(base + path.sep)) throw new Error("invalid template path");
            console.log(row.sourceDir);
        }
    ' "$ROOT"
)
for relative in "${template_dirs[@]}"; do
    [[ -n "$relative" ]] || continue
    source_dir="$ROOT/android/apk-templates/$relative"
    target_dir="$WARMUP/${relative//\//__}"
    cp -R "$source_dir" "$target_dir"
    printf '[WARMUP] %s\n' "$relative"
    "$GRADLE/bin/gradle" -p "$target_dir" --no-daemon --console=plain --max-workers=2 \
        assembleDebug lintDebug
done

stage verify '离线复核 Android 工具链与依赖缓存'
test -x "$JDK/bin/java"
test -x "$GRADLE/bin/gradle"
test -x "$SDK/build-tools/35.0.0/apksigner"
test -x "$SDK/build-tools/35.0.0/zipalign"
test -x "$SDK/build-tools/35.0.0/aapt"
test -f "$SDK/platforms/android-35/android.jar"
test -d "$GRADLE_HOME/caches/modules-2/files-2.1/com.android.tools.build/gradle/8.9.2"
rm -rf "$WARMUP"
rm -f "$DOWNLOADS/temurin-jdk17.tar.gz" "$DOWNLOADS/gradle-8.11.1-bin.zip" \
    "$DOWNLOADS/android-commandline-tools.zip"

stage complete 'JDK、Android SDK、Gradle 与离线缓存安装完成'
