#!/usr/bin/env python3
"""Re-sign APK after ZIP / binary manifest edits (scan-probe ablation)."""
from __future__ import annotations

import copy
import importlib.util
import json
import os
import shutil
import sys
import zipfile
from pathlib import Path

BASE = Path(__file__).resolve().parent
CORE_PATH = BASE.parent / "apk-repack/repack.py"
spec = importlib.util.spec_from_file_location("repack_core_patch", CORE_PATH)
assert spec and spec.loader
core = importlib.util.module_from_spec(spec)
spec.loader.exec_module(core)


def load_engine():
    spec = importlib.util.spec_from_file_location("shield_engine_patch", BASE / "engine.py")
    engine = importlib.util.module_from_spec(spec)
    assert spec.loader
    spec.loader.exec_module(engine)
    return engine


def zero_bytes(data: bytes) -> bytes:
    return b"\x00" * len(data)


def zero_head(data: bytes, size: int) -> bytes:
    size = min(size, len(data))
    return b"\x00" * size + data[size:]


def zero_tail(data: bytes, size: int) -> bytes:
    size = min(size, len(data))
    return data[:-size] + b"\x00" * size if size else data


def rewrite_archive(source: Path, unsigned: Path, *,
                    replacements: dict[str, bytes] | None = None,
                    omit: set[str] | None = None) -> None:
    replacements = replacements or {}
    omit = omit or set()
    with zipfile.ZipFile(source) as src, zipfile.ZipFile(unsigned, "x", allowZip64=True) as out:
        copied: set[str] = set()
        for info in src.infolist():
            if core.is_v1_signature(info.filename) or info.filename in omit:
                continue
            cloned = copy.copy(info)
            cloned.extra, cloned.flag_bits = b"", 0
            if info.filename in replacements:
                payload = replacements[info.filename]
            else:
                with src.open(info) as reader:
                    payload = reader.read()
            out.writestr(cloned, payload)
            copied.add(info.filename)
        for name, payload in replacements.items():
            if core.is_v1_signature(name) or name in omit or name in copied:
                continue
            out.writestr(name, payload)


def finalize_unsigned(source: Path, dest: Path, unsigned: Path,
                      replacements: dict[str, bytes] | None = None,
                      omit: set[str] | None = None) -> None:
    rewrite_archive(source, unsigned, replacements=replacements, omit=omit)
    engine = load_engine()
    config = json.loads((BASE / "config.json").read_text(encoding="utf-8-sig"))
    tools, env = engine.resolve_tools(config)
    aligned, signed = unsigned.parent / "aligned.apk", unsigned.parent / "signed.apk"
    engine.run_command([tools["zipalign"], "-P", "16", "4", unsigned, aligned], env, None)
    keystore = engine.ensure_keystore(tools, env, None)
    signer = [tools["java"], "-jar", tools["apksigner"]]
    engine.run_command(signer + ["sign", "--ks", keystore, "--ks-key-alias", "apk-repack", "--ks-pass",
        "env:APK_REPACK_PASSWORD", "--key-pass", "env:APK_REPACK_PASSWORD",
        "--v4-signing-enabled", "false", "--out", signed, aligned], env, None)
    shutil.copy2(signed, dest)


def resign_patched(source: Path, dest: Path, *,
                   replacements: dict[str, bytes] | None = None,
                   omit: set[str] | None = None) -> None:
    work = dest.parent / ".patch-work"
    if work.exists():
        shutil.rmtree(work)
    work.mkdir(parents=True)
    unsigned = work / "unsigned.apk"
    finalize_unsigned(source, dest, unsigned, replacements=replacements, omit=omit)
    shutil.rmtree(work)


def _java_helpers(work: Path, tools, env, engine):
    helpers = engine.compile_helpers(tools, env, work, None)
    java = [tools["java"], "-cp", str(helpers) + os.pathsep + str(tools["editor"])]
    return java, helpers


def transform_manifest(data: bytes, work: Path, steps: list[str]) -> bytes:
    engine = load_engine()
    config = json.loads((BASE / "config.json").read_text(encoding="utf-8-sig"))
    tools, env = engine.resolve_tools(config)
    java, _helpers = _java_helpers(work, tools, env, engine)
    current = data
    for step in steps:
        manifest_in = work / "step-in.axml"
        manifest_out = work / "step-out.axml"
        manifest_in.write_bytes(current)
        if step == "queries":
            engine.run_command(java + ["ManifestQueriesStrip", manifest_in, manifest_out], env, None)
        elif step == "accessibility":
            policy = work / "svc.json"
            policy.write_text('{"remove_accessibility_binding_services": true}', encoding="utf-8")
            engine.run_command(java + ["ManifestServiceStrip", manifest_in, manifest_out, policy], env, None)
        elif step.startswith("permissions:"):
            mode = step.split(":", 1)[1]
            policy = work / "perm.json"
            policy.write_text(json.dumps({
                "mode": mode,
                "permissions": [],
                "remove_permission_declarations": True,
            }), encoding="utf-8")
            engine.run_command(java + ["ManifestPermissionStrip", manifest_in, manifest_out, policy], env, None)
        else:
            raise ValueError(f"未知 manifest 步骤：{step}")
        current = manifest_out.read_bytes()
    return current


def manifest_label(source: Path, dest: Path, label: str, version_name: str = "") -> None:
    work = dest.parent / ".label-work"
    if work.exists():
        shutil.rmtree(work)
    work.mkdir(parents=True)
    engine = load_engine()
    config = json.loads((BASE / "config.json").read_text(encoding="utf-8-sig"))
    tools, env = engine.resolve_tools(config)
    java, _helpers = _java_helpers(work, tools, env, engine)
    manifest_in = work / "in.axml"
    manifest_out = work / "out.axml"
    with zipfile.ZipFile(source) as src:
        manifest_in.write_bytes(src.read("AndroidManifest.xml"))
    cmd = java + ["ManifestApplicationPatch", manifest_in, manifest_out, label]
    if version_name:
        cmd.append(version_name)
    engine.run_command(cmd, env, None)
    resign_patched(source, dest, replacements={"AndroidManifest.xml": manifest_out.read_bytes()})
    shutil.rmtree(work)


def manifest_probe(source: Path, dest: Path, *steps: str) -> None:
    work = dest.parent / ".manifest-probe-work"
    if work.exists():
        shutil.rmtree(work)
    work.mkdir(parents=True)
    with zipfile.ZipFile(source) as src:
        manifest = transform_manifest(src.read("AndroidManifest.xml"), work, list(steps))
    resign_patched(source, dest, replacements={"AndroidManifest.xml": manifest})
    shutil.rmtree(work)


def apply_zero_patch(source: Path, dest: Path, rules: dict[str, str]) -> None:
    def make_factory(rule: str):
        if rule == "zero":
            return zero_bytes
        if rule.startswith("zero_head:"):
            size = int(rule.split(":", 1)[1])
            return lambda data, n=size: zero_head(data, n)
        if rule.startswith("zero_tail:"):
            size = int(rule.split(":", 1)[1])
            return lambda data, n=size: zero_tail(data, n)
        raise ValueError(rule)

    with zipfile.ZipFile(source) as src:
        names = src.namelist()
    factories: dict[str, object] = {}
    for pattern, rule in rules.items():
        factory = make_factory(rule)
        if pattern.endswith("/**"):
            prefix = pattern.removesuffix("**")
            for name in names:
                if name.startswith(prefix):
                    factories[name] = factory
        else:
            if pattern not in names:
                raise FileNotFoundError(f"ZIP 内缺少条目：{pattern}")
            factories[pattern] = factory
    replacements = {}
    with zipfile.ZipFile(source) as src:
        for name, factory in factories.items():
            replacements[name] = factory(src.read(name))
    resign_patched(source, dest, replacements=replacements)


def _names_for_patterns(names: set[str], pattern: str) -> set[str]:
    if pattern.startswith("+"):
        return set()
    if pattern.endswith("/**"):
        prefix = pattern.removesuffix("**")
        return {name for name in names if name.startswith(prefix)}
    return {pattern} if pattern in names else set()


def restore_entries(donor: Path, base: Path, dest: Path, *patterns: str) -> None:
    with zipfile.ZipFile(donor) as dzip:
        donor_names = set(dzip.namelist())
    selected: set[str] = set()
    for pattern in patterns:
        selected |= _names_for_patterns(donor_names, pattern)
    if not selected:
        raise FileNotFoundError(f"捐赠 APK 无匹配条目：{list(patterns)}")
    replacements: dict[str, bytes] = {}
    with zipfile.ZipFile(donor) as dzip:
        for name in sorted(selected):
            replacements[name] = dzip.read(name)
    resign_patched(base, dest, replacements=replacements)


def omit_entries(source: Path, dest: Path, *patterns: str, keep_prefixes: tuple[str, ...] = ()) -> None:
    with zipfile.ZipFile(source) as src:
        names = set(src.namelist())
    omit: set[str] = set()
    for pattern in patterns:
        if pattern.startswith("+"):
            continue
        if pattern.endswith("/**"):
            prefix = pattern.removesuffix("**")
            omit.update(name for name in names if name.startswith(prefix))
        else:
            if pattern in names:
                omit.add(pattern)
    if keep_prefixes:
        omit = {name for name in omit if not any(name.startswith(prefix) for prefix in keep_prefixes)}
    resign_patched(source, dest, omit=omit)


def main(argv: list[str]) -> int:
    if len(argv) < 4:
        print("用法：scan_probe_patch.py <源.apk> <输出.apk> <模式> [参数...]", file=sys.stderr)
        return 1
    source, dest = Path(argv[1]).resolve(), Path(argv[2]).resolve()
    mode = argv[3]
    if mode == "strip_queries":
        manifest_probe(source, dest, "queries")
        return 0
    if mode == "strip_permissions":
        manifest_probe(source, dest, f"permissions:{argv[4] if len(argv) > 4 else 'remove_all'}")
        return 0
    if mode == "strip_accessibility":
        manifest_probe(source, dest, "accessibility")
        return 0
    if mode == "manifest_combo":
        manifest_probe(source, dest, *argv[4:])
        return 0
    if mode == "set_label":
        label = argv[4] if len(argv) > 4 else "Test"
        version = argv[5] if len(argv) > 5 else ""
        manifest_label(source, dest, label, version)
        return 0
    if mode == "restore":
        if len(argv) < 6:
            print("restore 用法：… restore <捐赠.apk> <条目或 res/**> …", file=sys.stderr)
            return 1
        restore_entries(Path(argv[4]), source, dest, *argv[5:])
        return 0
    if mode == "flip_byte":
        if len(argv) < 5:
            print("flip_byte 用法：… flip_byte <zip条目> [字节偏移，默认 -1=末字节]", file=sys.stderr)
            return 1
        entry = argv[4]
        offset = int(argv[5]) if len(argv) > 5 else -1
        with zipfile.ZipFile(source) as src:
            if entry not in src.namelist():
                raise FileNotFoundError(f"ZIP 内缺少条目：{entry}")
            data = bytearray(src.read(entry))
        off = offset if offset >= 0 else len(data) + offset
        if off < 0 or off >= len(data):
            raise ValueError(f"flip_byte 偏移越界：{off}（长度 {len(data)}）")
        data[off] ^= 0xFF
        resign_patched(source, dest, replacements={entry: bytes(data)})
        return 0
    if mode == "omit":
        keep = tuple(part[1:] for part in argv[4:] if part.startswith("+"))
        patterns = tuple(part for part in argv[4:] if not part.startswith("+"))
        omit_entries(source, dest, *patterns, keep_prefixes=keep)
        return 0
    rules = {entry: mode for entry in argv[4:]}
    apply_zero_patch(source, dest, rules)
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv))
