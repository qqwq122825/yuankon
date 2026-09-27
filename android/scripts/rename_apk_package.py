#!/usr/bin/env python3
"""Rename an APK applicationId / package name via apktool.

Dependencies (PATH or --tool flags / env):
  - apktool
  - Java
  - apksigner, zipalign (Android build-tools; optional auto-detect under .local-tools)

Example:
  python3 scripts/rename_apk_package.py input.apk com.example.newpkg -o out.apk
"""

from __future__ import annotations

import argparse
import os
import re
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

PACKAGE_RE = re.compile(r"^[a-zA-Z][a-zA-Z0-9_]*(?:\.[a-zA-Z][a-zA-Z0-9_]*)+$")
ANDROID_NS = "{http://schemas.android.com/apk/res/android}"


def die(msg: str, code: int = 1) -> None:
    print(f"error: {msg}", file=sys.stderr)
    raise SystemExit(code)


def run(cmd: list[str], *, cwd: Path | None = None) -> None:
    print("+", " ".join(cmd))
    subprocess.run(cmd, cwd=cwd, check=True)


def which(name: str) -> str | None:
    return shutil.which(name)


def find_build_tool(name: str, sdk_root: Path | None) -> str | None:
    found = which(name)
    if found:
        return found
    if sdk_root is None:
        return None
    build_tools = sdk_root / "build-tools"
    if not build_tools.is_dir():
        return None
    versions = sorted(
        (p for p in build_tools.iterdir() if p.is_dir()),
        key=lambda p: p.name,
        reverse=True,
    )
    for version in versions:
        candidate = version / name
        if candidate.is_file() and os.access(candidate, os.X_OK):
            return str(candidate)
    return None


def default_sdk_root(repo_root: Path) -> Path | None:
    for env in ("ANDROID_HOME", "ANDROID_SDK_ROOT"):
        value = os.environ.get(env)
        if value and Path(value).is_dir():
            return Path(value)
    local = repo_root / ".local-tools" / "android-sdk"
    if local.is_dir():
        return local
    return None


def read_manifest_package(manifest: Path) -> str:
    text = manifest.read_text(encoding="utf-8")
    match = re.search(r'<manifest\b[^>]*\bpackage="([^"]+)"', text)
    if not match:
        die(f"cannot find package= in {manifest}")
    return match.group(1)


def replace_package_occurrences(text: str, old: str, new: str) -> str:
    """Replace exact package tokens without touching longer dotted names."""
    pattern = re.compile(rf"(?<![A-Za-z0-9_.]){re.escape(old)}(?![A-Za-z0-9_])")
    return pattern.sub(new, text)


def update_manifest(manifest: Path, old: str, new: str) -> None:
    text = manifest.read_text(encoding="utf-8")
    if f'package="{old}"' not in text and f"package='{old}'" not in text:
        # Still rewrite occurrences (authorities / permissions may embed package).
        pass
    text = replace_package_occurrences(text, old, new)
    # Common apktool decode form.
    text = re.sub(
        r'(<manifest\b[^>]*\bpackage=")[^"]+(")',
        rf"\1{new}\2",
        text,
        count=1,
    )
    manifest.write_text(text, encoding="utf-8")


def update_apktool_yml(yml: Path, old: str, new: str) -> None:
    if not yml.is_file():
        return
    text = yml.read_text(encoding="utf-8")
    text = replace_package_occurrences(text, old, new)
    yml.write_text(text, encoding="utf-8")


def smali_type(package: str) -> str:
    return "L" + package.replace(".", "/") + "/"


def rewrite_file_references(path: Path, old: str, new: str, old_type: str, new_type: str) -> bool:
    try:
        data = path.read_bytes()
    except OSError:
        return False
    try:
        text = data.decode("utf-8")
    except UnicodeDecodeError:
        return False

    original = text
    text = text.replace(old_type, new_type)
    text = replace_package_occurrences(text, old, new)
    if text != original:
        path.write_text(text, encoding="utf-8")
        return True
    return False


def move_smali_package_dirs(decoded: Path, old: str, new: str) -> None:
    old_parts = old.split(".")
    new_parts = new.split(".")
    for smali_root in sorted(decoded.glob("smali*")):
        if not smali_root.is_dir():
            continue
        old_dir = smali_root.joinpath(*old_parts)
        if not old_dir.is_dir():
            continue
        new_dir = smali_root.joinpath(*new_parts)
        if new_dir.exists():
            die(f"target smali dir already exists: {new_dir}")
        new_dir.parent.mkdir(parents=True, exist_ok=True)
        shutil.move(str(old_dir), str(new_dir))
        # Prune empty old parents under this smali root.
        parent = old_dir.parent
        while parent != smali_root and parent.is_dir() and not any(parent.iterdir()):
            parent.rmdir()
            parent = parent.parent


def walk_and_rewrite(decoded: Path, old: str, new: str) -> int:
    old_type = smali_type(old)
    new_type = smali_type(new)
    changed = 0
    skip_names = {".git"}
    for root, dirs, files in os.walk(decoded):
        dirs[:] = [d for d in dirs if d not in skip_names]
        for name in files:
            if not name.endswith((".smali", ".xml", ".yml", ".yaml", ".txt", ".json", ".properties")):
                continue
            path = Path(root) / name
            if path.name == "AndroidManifest.xml":
                continue
            if rewrite_file_references(path, old, new, old_type, new_type):
                changed += 1
    return changed


def ensure_debug_keystore(path: Path) -> Path:
    if path.is_file():
        return path
    path.parent.mkdir(parents=True, exist_ok=True)
    keytool = which("keytool")
    if not keytool:
        die("keytool not found; install a JDK or provide --keystore")
    run(
        [
            keytool,
            "-genkeypair",
            "-v",
            "-keystore",
            str(path),
            "-storepass",
            "android",
            "-alias",
            "androiddebugkey",
            "-keypass",
            "android",
            "-keyalg",
            "RSA",
            "-keysize",
            "2048",
            "-validity",
            "10000",
            "-dname",
            "CN=Android Debug,O=Android,C=US",
        ]
    )
    return path


def sign_apk(
    unsigned: Path,
    output: Path,
    *,
    apksigner: str,
    zipalign: str | None,
    keystore: Path,
    storepass: str,
    keypass: str,
    alias: str,
) -> None:
    aligned = unsigned.with_name(unsigned.stem + "-aligned.apk")
    if zipalign:
        run([zipalign, "-f", "4", str(unsigned), str(aligned)])
        to_sign = aligned
    else:
        print("warning: zipalign not found; signing without alignment", file=sys.stderr)
        to_sign = unsigned

    signed_tmp = output.with_suffix(".signed.tmp.apk")
    run(
        [
            apksigner,
            "sign",
            "--ks",
            str(keystore),
            "--ks-pass",
            f"pass:{storepass}",
            "--key-pass",
            f"pass:{keypass}",
            "--ks-key-alias",
            alias,
            "--out",
            str(signed_tmp),
            str(to_sign),
        ]
    )
    run([apksigner, "verify", "--verbose", str(signed_tmp)])
    signed_tmp.replace(output)
    if aligned.is_file():
        aligned.unlink(missing_ok=True)


def parse_args() -> argparse.Namespace:
    repo_root = Path(__file__).resolve().parents[1]
    parser = argparse.ArgumentParser(description="Change an APK package / applicationId")
    parser.add_argument("apk", type=Path, help="input APK path")
    parser.add_argument("new_package", help="new package name, e.g. com.example.app")
    parser.add_argument("-o", "--output", type=Path, help="output APK path (default: <name>-renamed.apk)")
    parser.add_argument("--old-package", help="override detected old package name")
    parser.add_argument("--apktool", default=os.environ.get("APKTOOL", "apktool"), help="apktool binary")
    parser.add_argument("--sdk", type=Path, default=default_sdk_root(repo_root), help="Android SDK root")
    parser.add_argument("--apksigner", help="apksigner binary")
    parser.add_argument("--zipalign", help="zipalign binary")
    parser.add_argument("--no-sign", action="store_true", help="only rebuild; do not sign")
    parser.add_argument(
        "--keystore",
        type=Path,
        default=repo_root / ".local-tools" / "debug.keystore",
        help="keystore for resigning (default: .local-tools/debug.keystore)",
    )
    parser.add_argument("--storepass", default="android")
    parser.add_argument("--keypass", default="android")
    parser.add_argument("--alias", default="androiddebugkey")
    parser.add_argument("--keep-work", type=Path, help="keep decoded workdir at this path")
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    apk = args.apk.expanduser().resolve()
    if not apk.is_file():
        die(f"APK not found: {apk}")
    if not PACKAGE_RE.match(args.new_package):
        die(f"invalid package name: {args.new_package}")

    apktool = which(args.apktool) if args.apktool == "apktool" else args.apktool
    if not apktool or (isinstance(apktool, str) and not Path(apktool).exists() and not which(str(apktool))):
        # Allow absolute path even if not on PATH.
        if args.apktool and Path(args.apktool).is_file():
            apktool = str(Path(args.apktool).resolve())
        else:
            die("apktool not found. Install it or pass --apktool /path/to/apktool")

    output = (args.output or apk.with_name(f"{apk.stem}-renamed.apk")).expanduser().resolve()
    sdk = args.sdk
    apksigner = args.apksigner or find_build_tool("apksigner", sdk)
    zipalign = args.zipalign or find_build_tool("zipalign", sdk)

    work_root = Path(tempfile.mkdtemp(prefix="apk-rename-"))
    decoded = work_root / "decoded"
    rebuilt = work_root / "rebuilt.apk"

    try:
        run([str(apktool), "d", "-f", "-o", str(decoded), str(apk)])
        manifest = decoded / "AndroidManifest.xml"
        if not manifest.is_file():
            die("AndroidManifest.xml missing after decode")

        old = args.old_package or read_manifest_package(manifest)
        if not PACKAGE_RE.match(old):
            die(f"invalid old package name: {old}")
        if old == args.new_package:
            die("old and new package names are identical")

        print(f"package: {old} -> {args.new_package}")
        update_manifest(manifest, old, args.new_package)
        update_apktool_yml(decoded / "apktool.yml", old, args.new_package)
        changed = walk_and_rewrite(decoded, old, args.new_package)
        print(f"rewrote {changed} resource/smali files")
        move_smali_package_dirs(decoded, old, args.new_package)

        run([str(apktool), "b", "-o", str(rebuilt), str(decoded)])

        if args.no_sign:
            shutil.copy2(rebuilt, output)
            print(f"wrote unsigned APK: {output}")
        else:
            if not apksigner:
                die("apksigner not found; install build-tools or pass --apksigner / --no-sign")
            keystore = ensure_debug_keystore(args.keystore.expanduser().resolve())
            sign_apk(
                rebuilt,
                output,
                apksigner=apksigner,
                zipalign=zipalign,
                keystore=keystore,
                storepass=args.storepass,
                keypass=args.keypass,
                alias=args.alias,
            )
            print(f"wrote signed APK: {output}")

        if args.keep_work:
            dest = args.keep_work.expanduser().resolve()
            if dest.exists():
                shutil.rmtree(dest)
            shutil.copytree(decoded, dest)
            print(f"kept workdir: {dest}")
    finally:
        shutil.rmtree(work_root, ignore_errors=True)


if __name__ == "__main__":
    try:
        main()
    except subprocess.CalledProcessError as exc:
        die(f"command failed with exit {exc.returncode}: {' '.join(exc.cmd)}")
    except KeyboardInterrupt:
        die("interrupted", 130)
