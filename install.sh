#!/bin/sh
set -eu

ROOT=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
PRIVATE_DIR="$ROOT/backend/.node-private"
ENV_FILE="$ROOT/backend/.env"
LOCK_FILE="$PRIVATE_DIR/install.lock"
ACTIVE_LOCK="$PRIVATE_DIR/.installing.lock"
LOCK_TMP="$PRIVATE_DIR/install.lock.tmp"

ORIGIN=${NODE_PUBLIC_ORIGIN:-}
PORT=${NODE_PORT:-8080}
TRUST_PROXY=${NODE_TRUST_PROXY:-0}

usage() {
    cat <<'EOF'
用法：
  ./install.sh --origin https://example.com [--port 8080] [--trust-proxy]

作用：安装锁定依赖、构建 Vue、初始化私有数据库/主密钥，并生成：
  backend/.env
  backend/.node-private/install.lock

安装锁存在时不会覆盖配置或私有数据。普通更新不要再次运行本脚本。
EOF
}

while [ "$#" -gt 0 ]; do
    case "$1" in
        --origin)
            [ "$#" -ge 2 ] || { echo '安装失败：--origin 缺少值' >&2; exit 2; }
            ORIGIN=$2
            shift 2
            ;;
        --port)
            [ "$#" -ge 2 ] || { echo '安装失败：--port 缺少值' >&2; exit 2; }
            PORT=$2
            shift 2
            ;;
        --trust-proxy)
            TRUST_PROXY=1
            shift
            ;;
        --local-only)
            TRUST_PROXY=0
            shift
            ;;
        -h|--help)
            usage
            exit 0
            ;;
        *)
            echo "安装失败：未知参数 $1" >&2
            usage >&2
            exit 2
            ;;
    esac
done

umask 077
mkdir -p "$PRIVATE_DIR"

if [ -f "$LOCK_FILE" ]; then
    printf 'INSTALL_ALREADY_COMPLETE lock=%s\n' "$LOCK_FILE"
    exit 0
fi

[ -n "$ORIGIN" ] || { echo '安装失败：必须通过 --origin 指定公开 Origin' >&2; exit 2; }

NODE_BIN=$(command -v node || true)
NPM_BIN=$(command -v npm || true)
[ -n "$NODE_BIN" ] || { echo '安装失败：找不到 Node.js' >&2; exit 1; }
[ -n "$NPM_BIN" ] || { echo '安装失败：找不到 npm' >&2; exit 1; }

"$NODE_BIN" - "$ORIGIN" "$PORT" "$TRUST_PROXY" <<'JS'
const [origin, portText, trustProxy] = process.argv.slice(2);
const [major, minor] = process.versions.node.split('.').map(Number);
if (major < 22 || (major === 22 && minor < 12)) {
    throw new Error('Node.js 版本必须不低于 22.12');
}
let parsed;
try {
    parsed = new URL(origin);
} catch {
    throw new Error('公开 Origin 必须是有效 URL');
}
if (
    !['http:', 'https:'].includes(parsed.protocol) ||
    parsed.origin !== origin ||
    parsed.username ||
    parsed.password ||
    parsed.pathname !== '/' ||
    parsed.search ||
    parsed.hash
) {
    throw new Error('公开 Origin 只能包含 http(s) 协议、主机名和可选端口，且末尾不加斜杠');
}
const port = Number(portText);
if (!Number.isInteger(port) || port < 1024 || port > 65535) {
    throw new Error('端口必须是 1024 到 65535 的整数');
}
if (!['0', '1'].includes(trustProxy)) throw new Error('代理模式必须是 0 或 1');
JS

if ! mkdir "$ACTIVE_LOCK" 2>/dev/null; then
    echo '安装失败：另一个初始化进程正在运行' >&2
    exit 1
fi
cleanup() {
    rm -f "$LOCK_TMP"
    rmdir "$ACTIVE_LOCK" 2>/dev/null || true
}
trap cleanup EXIT
trap 'exit 129' HUP
trap 'exit 130' INT
trap 'exit 143' TERM

if [ -f "$ENV_FILE" ]; then
    env -i PATH="$PATH" "$NODE_BIN" --env-file="$ENV_FILE" - "$ORIGIN" "$PORT" "$TRUST_PROXY" <<'JS'
const [origin, port, trustProxy] = process.argv.slice(2);
for (const [name, expected] of [
    ['NODE_PUBLIC_ORIGIN', origin],
    ['NODE_PORT', port],
    ['NODE_TRUST_PROXY', trustProxy],
]) {
    if (process.env[name] !== expected) throw new Error(`现有 backend/.env 的 ${name} 与安装参数不一致`);
}
JS
    echo '保留现有 backend/.env'
else
    ENV_TMP=$(mktemp "$PRIVATE_DIR/env.XXXXXX")
    cat > "$ENV_TMP" <<EOF
NODE_PUBLIC_ORIGIN=$ORIGIN
NODE_PORT=$PORT
NODE_TRUST_PROXY=$TRUST_PROXY
EOF
    chmod 600 "$ENV_TMP"
    mv "$ENV_TMP" "$ENV_FILE"
    echo '已生成 backend/.env'
fi

cd "$ROOT"
"$NPM_BIN" ci
"$NPM_BIN" run build
"$NPM_BIN" --prefix backend run initialize

[ -f "$ROOT/frontend/dist/index.html" ] || { echo '安装失败：缺少前端构建产物' >&2; exit 1; }
[ -f "$PRIVATE_DIR/boundary.sqlite" ] || { echo '安装失败：缺少 SQLite 数据库' >&2; exit 1; }
[ -f "$PRIVATE_DIR/master.key" ] || { echo '安装失败：缺少主密钥' >&2; exit 1; }

COMMIT=$(git -C "$ROOT" rev-parse HEAD 2>/dev/null || printf unavailable)
"$NODE_BIN" --input-type=module - "$LOCK_TMP" "$ORIGIN" "$PORT" "$TRUST_PROXY" "$COMMIT" <<'JS'
import { writeFileSync } from 'node:fs';
const [filename, origin, port, trustProxy, commit] = process.argv.slice(2);
writeFileSync(
    filename,
    JSON.stringify(
        {
            schemaVersion: 1,
            installedAt: new Date().toISOString(),
            origin,
            port: Number(port),
            trustProxy: trustProxy === '1',
            commit,
        },
        null,
        2,
    ) + '\n',
    { mode: 0o600 },
);
JS
mv "$LOCK_TMP" "$LOCK_FILE"
chmod 600 "$LOCK_FILE"

printf 'INSTALL_OK origin=%s port=%s trust_proxy=%s lock=%s\n' \
    "$ORIGIN" "$PORT" "$TRUST_PROXY" "$LOCK_FILE"
