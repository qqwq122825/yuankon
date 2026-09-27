#!/usr/bin/env python3
"""Batch-edit standalone APK identity/version, align, sign and verify.

Python standard library only. DEX/resources remain unchanged. ManifestEditor,
JDK and Android Build Tools perform the Android-specific work.
"""
from __future__ import annotations

import argparse
import copy
from contextlib import contextmanager
from datetime import datetime, timezone
import hashlib
import json
import os
from pathlib import Path, PurePosixPath
import re
import secrets
import shlex
import shutil
import stat
import subprocess
import sys
import tempfile
import urllib.request
import zipfile

BASE = Path(__file__).resolve().parent
MANIFEST_EDITOR_VERSION = "2.0"
MANIFEST_EDITOR_SHA256 = "70ccb3eabb12e0d743555f97722bfd62f563dbb6e8f1f3b3c7a645fe22cd685f"
MANIFEST_EDITOR_URL = ("https://github.com/WindySha/ManifestEditor/releases/download/"
                       f"v{MANIFEST_EDITOR_VERSION}/ManifestEditor-{MANIFEST_EDITOR_VERSION}.jar")
PACKAGE_RE = re.compile(r"[A-Za-z][A-Za-z0-9_]*(?:\.[A-Za-z][A-Za-z0-9_]*)+")
MAX_CODE = 2_100_000_000


class RepackError(Exception):
    pass


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def validate_config(config: dict) -> None:
    package = config.get("package_name")
    if not isinstance(package, str) or (package != "random" and not PACKAGE_RE.fullmatch(package)):
        raise RepackError("package_name 请填写 com.example.app 格式，或 random。")
    version = config.get("version_name")
    if not isinstance(version, str) or not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9._+() -]{0,79}", version):
        raise RepackError("version_name 请使用 1–80 位字母、数字、点、空格或 _ + ( ) -，例如 4.0。")
    code = config.get("version_code")
    if code != "random" and (type(code) is not int or not 1 <= code <= MAX_CODE):
        raise RepackError(f"version_code 请填写 1–{MAX_CODE} 的整数，或 random。")
    for key in ("java_home", "android_sdk"):
        if not isinstance(config.get(key, ""), str):
            raise RepackError(f"{key} 请填写路径字符串，或留空字符串。")


def validate_apk(path: Path) -> None:
    if not path.is_file() or path.suffix.lower() != ".apk":
        raise RepackError(f"请提供现有的 .apk 文件：{path}")
    if path.stat().st_size > 512 * 1024 * 1024:
        raise RepackError("单个 APK 大小上限为 512 MiB。")
    try:
        with zipfile.ZipFile(path) as archive:
            entries = archive.infolist()
            if "AndroidManifest.xml" not in archive.namelist():
                raise RepackError("APK 缺少 AndroidManifest.xml。")
            if len(entries) > 100_000 or sum(i.file_size for i in entries) > 2 * 1024**3:
                raise RepackError("APK 解压体积或文件数量超过处理上限。")
            names = set()
            for entry in entries:
                name = entry.filename
                if (name in names or "\\" in name or ":" in name or name.startswith("/")
                        or ".." in PurePosixPath(name).parts or stat.S_ISLNK(entry.external_attr >> 16)):
                    raise RepackError("APK 包含重复或异常压缩路径。")
                if entry.flag_bits & 1 or entry.compress_type not in (zipfile.ZIP_STORED, zipfile.ZIP_DEFLATED):
                    raise RepackError("APK 包含加密或非常规压缩条目。")
                names.add(name)
    except zipfile.BadZipFile as exc:
        raise RepackError("APK 不是有效的 ZIP 文件。") from exc


def run(command: list, env: dict, log, timeout: int = 300) -> str:
    command = [str(arg) for arg in command]
    log.write("\n$ " + shlex.join(command) + "\n")
    log.flush()
    try:
        result = subprocess.run(command, env=env, stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
                                text=True, errors="replace", timeout=timeout, check=False)
    except subprocess.TimeoutExpired as exc:
        raise RepackError(f"命令超时（{timeout} 秒）：{Path(command[0]).name}") from exc
    log.write(result.stdout)
    log.flush()
    if result.returncode:
        raise RepackError(f"{Path(command[0]).name} 执行失败，退出码 {result.returncode}；详情见日志。")
    return result.stdout


def toolchain(config: dict) -> tuple[dict, dict]:
    exe = ".exe" if os.name == "nt" else ""
    java_homes = [config.get("java_home"), os.environ.get("JAVA_HOME"),
                  str(BASE.parent / ".local-tools/jdk/Contents/Home")]
    java = next((Path(p).expanduser().resolve() / "bin" / ("java" + exe) for p in java_homes
                 if p and (Path(p).expanduser() / "bin" / ("java" + exe)).is_file()), None)
    if java is None:
        located = shutil.which("java")
        java = Path(located).resolve() if located else None
    if java is None:
        raise RepackError("请安装 JDK 17，并在 config.json 填写 java_home。")
    keytool = java.with_name("keytool" + exe)
    javac = java.with_name("javac" + exe)
    if not keytool.is_file() or not javac.is_file():
        raise RepackError("当前 Java 缺少 keytool 或 javac；请将 java_home 指向完整 JDK 17。")
    env = os.environ.copy()
    env["JAVA_HOME"] = str(java.parent.parent)
    env["PATH"] = str(java.parent) + os.pathsep + env.get("PATH", "")
    env["APK_REPACK_PASSWORD"] = "android"
    roots = [config.get("android_sdk"), os.environ.get("ANDROID_HOME"), os.environ.get("ANDROID_SDK_ROOT"),
             str(BASE.parent / ".local-tools/android-sdk"), str(Path.home() / "Library/Android/sdk"),
             str(Path.home() / "Android/Sdk")]
    for root in filter(None, roots):
        builds = Path(root).expanduser() / "build-tools"
        versions = sorted((p for p in builds.glob("*") if re.fullmatch(r"\d+(?:\.\d+)*", p.name)),
                          key=lambda p: tuple(map(int, p.name.split("."))), reverse=True)
        for version in versions:
            if tuple(map(int, version.name.split("."))) < (35, 0, 0):
                continue
            result = {name: version.resolve() / (name + exe) for name in ("aapt", "aapt2", "zipalign")}
            result["apksigner"] = version.resolve() / "lib/apksigner.jar"
            if all(p.is_file() for p in result.values()):
                return dict(result, java=java, javac=javac, keytool=keytool), env
    raise RepackError("请安装 Android SDK Build Tools 35.0.0+，并在 config.json 填写 android_sdk。")


def ensure_manifest_editor() -> Path:
    dest = BASE / ".tools" / f"ManifestEditor-{MANIFEST_EDITOR_VERSION}.jar"
    dest.parent.mkdir(parents=True, exist_ok=True)
    if dest.is_file():
        if sha256(dest) != MANIFEST_EDITOR_SHA256:
            raise RepackError(f"ManifestEditor SHA-256 校验异常，请移走后重试：{dest}")
        return dest
    print(f"首次下载 ManifestEditor {MANIFEST_EDITOR_VERSION}…", flush=True)
    with tempfile.TemporaryDirectory(dir=dest.parent) as folder:
        download = Path(folder) / "download.jar"
        with urllib.request.urlopen(MANIFEST_EDITOR_URL, timeout=60) as response, download.open("wb") as out:
            shutil.copyfileobj(response, out)
        if sha256(download) != MANIFEST_EDITOR_SHA256:
            raise RepackError("ManifestEditor 下载文件 SHA-256 校验异常。")
        os.replace(download, dest)
    return dest


@contextmanager
def single_run():
    private = BASE / ".private"
    private.mkdir(mode=0o700, exist_ok=True)
    lock = private / "run.lock"
    try:
        with lock.open("x", encoding="utf-8") as stream:
            stream.write(str(os.getpid()))
    except FileExistsError as exc:
        raise RepackError(f"已有运行锁，请等待当前任务；异常退出后确认进程已结束，再删除 {lock}") from exc
    try:
        yield
    finally:
        lock.unlink(missing_ok=True)


def ensure_keystore(tools: dict, env: dict, log) -> Path:
    path = BASE / ".private/development.p12"
    if not path.is_file():
        run([tools["keytool"], "-genkeypair", "-keystore", path, "-storetype", "PKCS12",
             "-storepass:env", "APK_REPACK_PASSWORD", "-keypass:env", "APK_REPACK_PASSWORD",
             "-alias", "apk-repack", "-keyalg", "RSA", "-keysize", "2048", "-validity", "10000",
             "-dname", "CN=APK Repack Development,O=Local Development,C=US"], env, log)
        path.chmod(0o600)
    return path


def ensure_manifest_helper(tools: dict, env: dict, editor: Path, log) -> Path:
    source = BASE / "ManifestPatch.java"
    classes = BASE / ".tools/manifest-helper"
    marker = classes / ".source-sha256"
    expected = sha256(source) + ":" + sha256(editor)
    class_file = classes / "ManifestPatch.class"
    if not class_file.is_file() or not marker.is_file() or marker.read_text() != expected:
        if classes.exists():
            shutil.rmtree(classes)
        classes.mkdir(parents=True)
        run([tools["javac"], "-encoding", "UTF-8", "-cp", editor, "-d", classes, source], env, log)
        marker.write_text(expected)
    return classes


def read_badging(text: str) -> dict:
    first = next((line for line in text.splitlines() if line.startswith("package:")), "")
    if re.search(r"\bsplit='[^']*'", first):
        raise RepackError("请使用完整的独立 APK；当前输入是 split APK。")
    values = dict(re.findall(r"\b(name|versionName|versionCode)='([^']*)'", first))
    if not {"name", "versionName", "versionCode"} <= values.keys():
        raise RepackError("aapt 输出缺少包名或版本字段。")
    return {"package_name": values["name"], "version_name": values["versionName"], "version_code": int(values["versionCode"])}


def is_v1_signature(name: str) -> bool:
    upper = name.upper()
    if not upper.startswith("META-INF/"):
        return False
    leaf = upper.rsplit("/", 1)[-1]
    return leaf == "MANIFEST.MF" or leaf.endswith((".SF", ".RSA", ".DSA", ".EC"))


def payload_hashes(path: Path) -> dict:
    with zipfile.ZipFile(path) as archive:
        hashes = {}
        for name in archive.namelist():
            if name != "AndroidManifest.xml" and not is_v1_signature(name):
                digest = hashlib.sha256()
                with archive.open(name) as stream:
                    for chunk in iter(lambda: stream.read(1024 * 1024), b""):
                        digest.update(chunk)
                hashes[name] = digest.hexdigest()
        return hashes


def rewrite_apk_manifest(source: Path, manifest: Path, output: Path) -> None:
    with zipfile.ZipFile(source) as incoming, zipfile.ZipFile(output, "x", allowZip64=True) as outgoing:
        for info in incoming.infolist():
            if is_v1_signature(info.filename):
                continue
            cloned = copy.copy(info)
            cloned.extra = b""
            cloned.flag_bits = 0
            # A rewritten archive has no old v2/v3 signing block. Keep entry metadata and compression.
            if info.filename == "AndroidManifest.xml":
                outgoing.writestr(cloned, manifest.read_bytes())
                continue
            with incoming.open(info) as reader, outgoing.open(cloned, "w") as writer:
                shutil.copyfileobj(reader, writer, 1024 * 1024)


def process_apk(apk: Path, config: dict, tools: dict, env: dict, editor: Path, output: Path) -> Path:
    package = "com.mtx.app" + secrets.token_hex(6) if config["package_name"] == "random" else config["package_name"]
    code = secrets.randbelow(MAX_CODE) + 1 if config["version_code"] == "random" else config["version_code"]
    version = config["version_name"]
    token = secrets.token_hex(4)
    stem = f"{package[:100]}-{version.replace(' ', '_')[:40]}-{code}-{token}"
    log_path = output / (stem + ".log")
    print(f"处理 {apk.name} → {package} / {version} / {code}", flush=True)
    try:
        with log_path.open("x", encoding="utf-8") as log, tempfile.TemporaryDirectory(prefix=".work-", dir=output) as folder:
            work = Path(folder)
            # Work only on a snapshot. The caller's APK is never changed.
            original = work / "input.apk"
            shutil.copy2(apk, original)
            validate_apk(original)
            before = read_badging(run([tools["aapt"], "dump", "badging", original], env, log))
            binary_manifest = work / "AndroidManifest.xml"
            patched_manifest = work / "AndroidManifest-patched.xml"
            with zipfile.ZipFile(original) as archive:
                binary_manifest.write_bytes(archive.read("AndroidManifest.xml"))
            helper = ensure_manifest_helper(tools, env, editor, log)
            run([tools["java"], "-cp", str(editor) + os.pathsep + str(helper), "ManifestPatch",
                 binary_manifest, patched_manifest, before["package_name"], package, version, code], env, log)
            unsigned, aligned, signed = (work / name for name in ("unsigned.apk", "aligned.apk", "signed.apk"))
            rewrite_apk_manifest(original, patched_manifest, unsigned)
            run([tools["zipalign"], "-P", "16", "4", unsigned, aligned], env, log)
            keystore = ensure_keystore(tools, env, log)
            signer = [tools["java"], "-jar", tools["apksigner"]]
            run(signer + ["sign", "--ks", keystore, "--ks-key-alias", "apk-repack",
                          "--ks-pass", "env:APK_REPACK_PASSWORD", "--key-pass", "env:APK_REPACK_PASSWORD",
                          "--v4-signing-enabled", "false", "--out", signed, aligned], env, log)
            run(signer + ["verify", "--verbose", "--print-certs", signed], env, log)
            run([tools["zipalign"], "-c", "-P", "16", "4", signed], env, log)
            after = read_badging(run([tools["aapt"], "dump", "badging", signed], env, log))
            expected = {"package_name": package, "version_name": version, "version_code": code}
            if after != expected or payload_hashes(original) != payload_hashes(signed):
                raise RepackError("最终包的元数据或原始载荷保持校验异常，产物未发布。")
            result = output / (stem + ".apk")
            report = {"input": str(apk), "original": before, "output": str(result), **after,
                      "sha256": sha256(signed), "input_sha256": sha256(original), "size_bytes": signed.stat().st_size,
                      "signature_verified": True, "alignment_verified": True, "payload_unchanged": True,
                      "dex_unchanged": True,
                      "runtime_tested": False, "signing": "local development certificate",
                      "built_at": datetime.now(timezone.utc).isoformat()}
            # Same-filesystem hard link publishes atomically and never overwrites an existing APK.
            os.link(signed, result)
            result.with_suffix(".json").write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
            return result
    except (RepackError, OSError, ValueError) as exc:
        raise RepackError(f"{exc}\n日志：{log_path}") from exc


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="修改 APK 包名、版本号、构建号，自动重打包、签名和校验。")
    parser.add_argument("apk", nargs="*", type=Path, help="可选；默认处理脚本旁 input 目录中的全部 APK")
    parser.add_argument("--config", type=Path, default=BASE / "config.json")
    parser.add_argument("--package", dest="package_name", help="新包名或 random")
    parser.add_argument("--version-name", help="例如 4.0")
    parser.add_argument("--version-code", help="整数或 random")
    parser.add_argument("--output-dir", type=Path, default=BASE / "output")
    args = parser.parse_args(argv)
    try:
        config = json.loads(args.config.read_text(encoding="utf-8-sig"))
        if not isinstance(config, dict):
            raise RepackError("config.json 顶层应为 JSON 对象。")
        for key in ("package_name", "version_name", "version_code"):
            value = getattr(args, key)
            if value is not None:
                config[key] = int(value) if key == "version_code" and value.isdecimal() else value
        validate_config(config)
        files = args.apk or sorted((BASE / "input").glob("*"))
        files = [p.expanduser().resolve() for p in files if args.apk or (p.is_file() and p.suffix.lower() == ".apk")]
        if not files:
            print(f"请把 APK 放到 {BASE / 'input'}，再运行本脚本。")
            return 0
        output = args.output_dir.expanduser().resolve()
        output.mkdir(parents=True, exist_ok=True)
        with single_run():
            tools, env = toolchain(config)
            editor = ensure_manifest_editor()
            failures = 0
            for apk in files:
                try:
                    validate_apk(apk)
                    result = process_apk(apk, config, tools, env, editor, output)
                    print(f"完成：{result}", flush=True)
                except RepackError as exc:
                    failures += 1
                    print(f"失败：{apk.name}\n{exc}", file=sys.stderr, flush=True)
            print(f"处理结束：成功 {len(files) - failures}，失败 {failures}。输出：{output}")
            return 1 if failures else 0
    except (RepackError, OSError, ValueError) as exc:
        print(f"错误：{exc}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    try:
        sys.exit(main())
    except KeyboardInterrupt:
        print("\n操作已中断；输入 APK 保持原样。", file=sys.stderr)
        sys.exit(130)
