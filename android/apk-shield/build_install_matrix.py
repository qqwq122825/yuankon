#!/usr/bin/env python3
"""Legacy install-test matrix (#1–#120). 默认目录仅 build_install_suite.py 生成 1.apk/2.apk。"""
from __future__ import annotations

import hashlib
import importlib.util
import json
import shutil
import subprocess
import sys
from dataclasses import dataclass
from pathlib import Path
from typing import Callable

BASE = Path(__file__).resolve().parent
INPUT = BASE / "input" / "5412ce7f.apk"
OUT = BASE / "output" / "install-test"
CACHE = OUT / ".cache"
CONFIG = BASE / "config.json"
REPACK = BASE.parent / "apk-repack/repack.py"
PATCH = BASE / "scan_probe_patch.py"
DEFAULT_COUNT = 120

BIND_A11Y = "android.permission.BIND_ACCESSIBILITY_SERVICE"
NETWORK_PERMS = "android.permission.INTERNET,android.permission.ACCESS_NETWORK_STATE"

# 重签包上「删 ZIP 条目」阶梯（不含抹零）；+prefix 表示 omit 时保留该前缀
STRIP_RES_ONLY = ("res/**",)
STRIP_ASSETS = ("assets/**",)
STRIP_LIB = ("lib/**",)
STRIP_ARSC = ("resources.arsc",)
STRIP_ALL_UNSIGNED = ("res/**", "resources.arsc", "assets/**", "lib/**")
STRIP_NO_RESOURCE = (*STRIP_ARSC, *STRIP_RES_ONLY)
STRIP_V4SCREENS = ("assets/v4screens/**",)
MANIFEST_HEAVY_STRIP = ("queries", "permissions:remove_all", "accessibility")
# 56 基准：最小壳上去掉资源与业务 assets，仅保留 apk-shield 载荷
STRIP_LIKE_56 = (*STRIP_RES_ONLY, *STRIP_ARSC, "assets/**", "+assets/apk-shield/")

SENSITIVE_REMOVE = [
    "android.permission.READ_SMS",
    "android.permission.READ_CALL_LOG",
    "android.permission.CALL_PHONE",
    "android.permission.RECORD_AUDIO",
    "android.permission.ACCESS_FINE_LOCATION",
    "android.permission.ACCESS_COARSE_LOCATION",
    "android.permission.CAMERA",
    "android.permission.READ_CONTACTS",
    "android.permission.READ_PHONE_STATE",
    "android.permission.MANAGE_EXTERNAL_STORAGE",
    "android.permission.READ_MEDIA_IMAGES",
    "android.permission.READ_MEDIA_VIDEO",
    "android.permission.READ_MEDIA_AUDIO",
    "android.permission.QUERY_ALL_PACKAGES",
    "android.permission.REQUEST_INSTALL_PACKAGES",
    "android.permission.FOREGROUND_SERVICE_MEDIA_PROJECTION",
    "android.permission.WRITE_SECURE_SETTINGS",
]

Context = dict


@dataclass(frozen=True)
class Probe:
    slot: int
    title: str
    signal: str
    bullets: tuple[str, ...]
    build: Callable[[Context], None]


def run_engine(extra: list[str], source: Path | None = None) -> Path:
    apk = source or INPUT
    cmd = [sys.executable, str(BASE / "engine.py"), *extra, str(apk)]
    result = subprocess.run(cmd, cwd=BASE, capture_output=True, text=True)
    if result.returncode != 0:
        raise SystemExit(result.stderr or result.stdout)
    for line in result.stdout.splitlines():
        if line.startswith("完成："):
            return Path(line.removeprefix("完成：").strip())
    raise SystemExit("engine 未返回输出路径：\n" + result.stdout + result.stderr)


def run_patch(source: Path, dest: Path, mode: str, *args: str) -> None:
    cmd = [sys.executable, str(PATCH), str(source), str(dest), mode, *args]
    result = subprocess.run(cmd, capture_output=True, text=True)
    if result.returncode != 0:
        raise SystemExit(result.stderr or result.stdout)


def resign_only(apk: Path, dest: Path) -> None:
    spec = importlib.util.spec_from_file_location("engine", BASE / "engine.py")
    engine = importlib.util.module_from_spec(spec)
    assert spec.loader
    spec.loader.exec_module(engine)
    config = json.loads(CONFIG.read_text(encoding="utf-8-sig"))
    tools, env = engine.resolve_tools(config)
    work = dest.parent / ".resign-work"
    if work.exists():
        shutil.rmtree(work)
    work.mkdir(parents=True)
    aligned, signed = work / "aligned.apk", work / "signed.apk"
    engine.run_command([tools["zipalign"], "-P", "16", "4", apk, aligned], env, None)
    keystore = engine.ensure_keystore(tools, env, None)
    signer = [tools["java"], "-jar", tools["apksigner"]]
    engine.run_command(signer + ["sign", "--ks", keystore, "--ks-key-alias", "apk-repack",
        "--ks-pass", "env:APK_REPACK_PASSWORD", "--key-pass", "env:APK_REPACK_PASSWORD",
        "--v4-signing-enabled", "false", "--out", signed, aligned], env, None)
    shutil.copy2(signed, dest)
    shutil.rmtree(work)


def repack_package(ctx: Context, cache_name: str, package: str) -> Path:
    return ctx_get(ctx, cache_name, lambda: run_repack(package))


def repack_a8(ctx: Context) -> Path:
    return repack_package(ctx, "repack-a8.apk", "com.boundary.scanprobe.a8")


def repack_neutral(ctx: Context) -> Path:
    return repack_package(ctx, "repack-neutral.apk", "com.boundary.install.probe")


def run_repack(package: str) -> Path:
    work = OUT / ".repack-work"
    work.mkdir(parents=True, exist_ok=True)
    cmd = [sys.executable, str(REPACK), str(INPUT), "--package", package, "--output-dir", str(work)]
    result = subprocess.run(cmd, capture_output=True, text=True)
    if result.returncode != 0:
        raise SystemExit(result.stderr or result.stdout)
    for line in result.stdout.splitlines():
        if line.startswith("完成："):
            return Path(line.removeprefix("完成：").strip())
    built = sorted(work.glob("*.apk"), key=lambda p: p.stat().st_mtime, reverse=True)
    if not built:
        raise SystemExit("apk-repack 未产出 APK")
    return built[0]


def input_hash() -> str:
    return hashlib.sha256(INPUT.read_bytes()).hexdigest()[:16]


def cache_path(name: str) -> Path:
    CACHE.mkdir(parents=True, exist_ok=True)
    return CACHE / f"{input_hash()}-{name}"


def ctx_get(ctx: Context, key: str, factory: Callable[[], Path]) -> Path:
    if key in ctx and Path(ctx[key]).is_file():
        return Path(ctx[key])
    cached = cache_path(key)
    if cached.is_file():
        ctx[key] = cached
        return cached
    path = factory()
    ctx[key] = path
    if Path(path).is_file():
        shutil.copy2(path, cached)
        ctx[key] = cached
    return Path(ctx[key])


def shield_full(ctx: Context) -> Path:
    return ctx_get(ctx, "shield_full", lambda: run_engine(["--no-manifest-debug"]))


def shield_perm_all(ctx: Context) -> Path:
    return ctx_get(ctx, "shield_perm_all", lambda: run_engine(["--manifest-debug-mode", "remove_all"]))


def shield_minimal(ctx: Context) -> Path:
    return ctx_get(ctx, "shield_minimal", lambda: run_engine([
        "--manifest-debug-mode", "remove_all", "--manifest-debug-strip-accessibility"]))


def shield_minimal_from(ctx: Context, source: Path) -> Path:
    digest = hashlib.sha256(source.read_bytes()).hexdigest()[:16]
    key = f"shield_minimal-{digest}"
    return ctx_get(ctx, key, lambda: run_engine([
        "--manifest-debug-mode", "remove_all", "--manifest-debug-strip-accessibility"], source))


def shield_manifest(ctx: Context, source: Path | None, *engine_args: str) -> Path:
    apk = INPUT if source is None else source
    digest = hashlib.sha256(apk.read_bytes()).hexdigest()[:16]
    key = "shield-" + digest + "-" + hashlib.sha256(" ".join(engine_args).encode()).hexdigest()[:12]

    def make() -> Path:
        return run_engine(list(engine_args), apk)

    return ctx_get(ctx, key, make)


def copy_shield(ctx: Context, slot: int, source: Path | None, *engine_args: str) -> None:
    shutil.copy2(shield_manifest(ctx, source, *engine_args), dest(slot))


def strip_like_56(source: Path, target: Path) -> None:
    run_patch(source, target, "omit", *STRIP_LIKE_56)


def run_restore(base: Path, out: Path, donor: Path, *patterns: str) -> None:
    run_patch(base, out, "restore", str(donor), *patterns)


def omit_on_resigned(ctx: Context, slot: int, *patterns: str) -> None:
    run_patch(resigned(ctx), dest(slot), "omit", *patterns)


def manifest_heavy_on(apk: Path, out: Path) -> None:
    run_patch(apk, out, "manifest_combo", *MANIFEST_HEAVY_STRIP)


def orig_skinny(ctx: Context) -> Path:
    """原包重签：去掉 arsc/res/assets/lib，仅余 DEX+Manifest+元数据。"""

    def make() -> Path:
        tmp = cache_path("orig-skinny-build.apk")
        run_patch(resigned(ctx), tmp, "omit", *STRIP_NO_RESOURCE, *STRIP_ASSETS, *STRIP_LIB)
        return tmp

    return ctx_get(ctx, "orig-skinny.apk", make)


def baseline_90(ctx: Context) -> Path:
    """原 #90 / suite 2：极瘦 + Manifest 大剥 + classes.dex 末字节翻转。"""

    def make() -> Path:
        mid = cache_path("baseline-90-mid.apk")
        out = cache_path("baseline-90-build.apk")
        manifest_heavy_on(orig_skinny(ctx), mid)
        run_patch(mid, out, "flip_byte", "classes.dex", "-1")
        return out

    return ctx_get(ctx, "baseline-90.apk", make)


def base_56(ctx: Context) -> Path:
    def make() -> Path:
        tmp = cache_path("base-56-build.apk")
        strip_like_56(shield_minimal(ctx), tmp)
        return tmp

    return ctx_get(ctx, "base-56.apk", make)


def base_56_from(ctx: Context, source: Path, cache_name: str) -> Path:
    def make() -> Path:
        tmp = cache_path(cache_name.replace(".apk", "-build.apk"))
        strip_like_56(shield_minimal_from(ctx, source), tmp)
        return tmp

    return ctx_get(ctx, cache_name, make)


def resigned(ctx: Context) -> Path:
    def make() -> Path:
        p = cache_path("resigned.apk")
        if not p.is_file():
            resign_only(INPUT, p)
        return p
    return ctx_get(ctx, "resigned", make)


def dest(slot: int) -> Path:
    return OUT / f"{slot}.apk"


def build_probes() -> list[Probe]:
    perms = ",".join(SENSITIVE_REMOVE)

    def b1(ctx):
        shutil.copy2(INPUT, dest(1))

    def b2(ctx):
        resign_only(INPUT, dest(2))

    def b3(ctx):
        shutil.copy2(shield_full(ctx), dest(3))

    def b4(ctx):
        shutil.copy2(shield_perm_all(ctx), dest(4))

    def b5(ctx):
        shutil.copy2(run_engine([
            "--manifest-debug-mode", "keep_only",
            "--manifest-debug-permissions",
            "android.permission.INTERNET,android.permission.ACCESS_NETWORK_STATE",
        ]), dest(5))

    def b6(ctx):
        shutil.copy2(run_engine(["--manifest-debug-mode", "remove_list",
                                 "--manifest-debug-permissions", perms]), dest(6))

    def b7(ctx):
        shutil.copy2(shield_minimal(ctx), dest(7))

    def b8(ctx):
        shutil.copy2(run_repack("com.boundary.scanprobe.a8"), dest(8))

    def b9(ctx):
        run_patch(shield_full(ctx), dest(9), "zero", "assets/apk-shield/payload.blp")

    def b10(ctx):
        run_patch(shield_full(ctx), dest(10), "zero_head:4096", "classes.dex")

    def b11(ctx):
        run_patch(resigned(ctx), dest(11), "strip_queries")

    def b12(ctx):
        run_patch(shield_full(ctx), dest(12), "zero", "lib/**")

    def b13(ctx):
        run_patch(resigned(ctx), dest(13), "strip_permissions", "remove_all")

    def b14(ctx):
        run_patch(resigned(ctx), dest(14), "manifest_combo", "queries", "permissions:remove_all")

    def b15(ctx):
        shutil.copy2(run_repack("com.boundary.scanprobe.b15"), dest(15))

    def b16(ctx):
        shutil.copy2(run_repack("com.example.securityscan.clean"), dest(16))

    def b17(ctx):
        run_patch(shield_minimal(ctx), dest(17), "zero", "assets/apk-shield/payload.blp")

    def b18(ctx):
        run_patch(shield_minimal(ctx), dest(18), "zero_head:4096", "classes.dex")

    def b19(ctx):
        run_patch(shield_minimal(ctx), dest(19), "zero", "lib/**")

    def b20(ctx):
        run_patch(shield_minimal(ctx), dest(20), "strip_queries")

    def b21(ctx):
        run_patch(INPUT, dest(21), "zero_head:112", "classes.dex")

    def b22(ctx):
        run_patch(INPUT, dest(22), "zero", "lib/**")

    def b23(ctx):
        run_patch(shield_full(ctx), dest(23), "zero", "resources.arsc")

    def b24(ctx):
        run_patch(shield_full(ctx), dest(24), "zero", "classes.dex")

    def b25(ctx):
        run_patch(shield_full(ctx), dest(25), "omit", "assets/apk-shield/build.json")

    def b26(ctx):
        run_patch(shield_full(ctx), dest(26), "omit", "assets/apk-shield/**")

    def b27(ctx):
        tmp = cache_path("repack-a8.apk")
        if not tmp.is_file():
            shutil.copy2(run_repack("com.boundary.scanprobe.a8"), tmp)
        run_patch(tmp, dest(27), "strip_queries")

    def b28(ctx):
        tmp = cache_path("repack-a8.apk")
        if not tmp.is_file():
            shutil.copy2(run_repack("com.boundary.scanprobe.a8"), tmp)
        run_patch(tmp, dest(28), "manifest_combo", "queries", "permissions:remove_all")

    def b29(ctx):
        run_patch(resigned(ctx), dest(29), "manifest_combo",
                  "queries", "permissions:remove_all", "accessibility")

    def b30(ctx):
        run_patch(shield_minimal(ctx), dest(30), "manifest_combo", "queries")
        run_patch(dest(30), dest(30), "zero", "assets/apk-shield/payload.blp")
        run_patch(dest(30), dest(30), "zero_head:512", "classes.dex")

    def b31(ctx):
        run_patch(resigned(ctx), dest(31), "set_label", "系统更新", "9.0")

    def b32(ctx):
        run_patch(resigned(ctx), dest(32), "set_label", "Google 服务框架", "24.1")

    def b33(ctx):
        tmp = run_repack("com.miui.securitycenter")
        run_patch(tmp, dest(33), "set_label", "手机管家", "8.0")

    def b34(ctx):
        tmp = run_repack("com.huawei.systemmanager")
        run_patch(tmp, dest(34), "set_label", "华为手机管家", "14.0")

    def b35(ctx):
        tmp = run_repack("com.android.settings")
        run_patch(tmp, dest(35), "set_label", "设置", "14.0")

    def b36(ctx):
        tmp = cache_path("repack-a8.apk")
        if not tmp.is_file():
            shutil.copy2(run_repack("com.boundary.scanprobe.a8"), tmp)
        run_patch(tmp, dest(36), "set_label", "安全守护", "1.0")

    def b37(ctx):
        run_patch(resigned(ctx), dest(37), "set_label", "本地测试浏览器", "1.0")

    def b38(ctx):
        run_patch(resigned(ctx), dest(38), "set_label", "本地测试浏览器", "1.0")
        run_patch(dest(38), dest(38), "manifest_combo", "permissions:remove_all")

    def b39(ctx):
        tmp = run_repack("com.google.android.gms")
        run_patch(tmp, dest(39), "set_label", "Google Play 服务", "24.45")

    def b40(ctx):
        shutil.copy2(shield_minimal(ctx), dest(40))
        run_patch(dest(40), dest(40), "set_label", "简单浏览器", "1.0")

    def repack_a8(ctx) -> Path:
        return ctx_get(ctx, "repack-a8.apk", lambda: run_repack("com.boundary.scanprobe.a8"))

    def repack_neutral(ctx) -> Path:
        return ctx_get(ctx, "repack-neutral.apk", lambda: run_repack("com.boundary.install.probe"))

    def b41(ctx):
        run_patch(resigned(ctx), dest(41), "set_label", "Rivo TV", "1.0-probe41")

    def b42(ctx):
        tmp = repack_neutral(ctx)
        run_patch(tmp, dest(42), "set_label", "边界探针", "1.0")

    def b43(ctx):
        tmp = repack_neutral(ctx)
        run_patch(tmp, dest(43), "manifest_combo", "queries", "permissions:remove_all", "accessibility")
        run_patch(dest(43), dest(43), "set_label", "边界探针", "1.0")

    def b44(ctx):
        run_patch(repack_a8(ctx), dest(44), "set_label", "本地测试浏览器", "1.0")

    def b45(ctx):
        run_patch(resigned(ctx), dest(45), "manifest_combo", "accessibility")

    def b46(ctx):
        run_patch(resigned(ctx), dest(46), "manifest_combo", "queries", "permissions:remove_all")

    def b47(ctx):
        run_patch(shield_full(ctx), dest(47), "zero_tail:4096", "resources.arsc")

    def b48(ctx):
        out = cache_path("shield-on-a8.apk")
        if not out.is_file():
            built = run_engine(["--no-manifest-debug"], repack_a8(ctx))
            shutil.copy2(built, out)
        shutil.copy2(out, dest(48))

    def omit_from_resigned(ctx, slot: int, *patterns: str) -> None:
        run_patch(resigned(ctx), dest(slot), "omit", *patterns)

    def b49(ctx):
        omit_from_resigned(ctx, 49, *STRIP_RES_ONLY)

    def b50(ctx):
        omit_from_resigned(ctx, 50, *STRIP_ASSETS)

    def b51(ctx):
        omit_from_resigned(ctx, 51, *STRIP_LIB)

    def b52(ctx):
        omit_from_resigned(ctx, 52, *STRIP_ARSC)

    def b53(ctx):
        omit_from_resigned(ctx, 53, *STRIP_ALL_UNSIGNED)

    def b54(ctx):
        run_patch(resigned(ctx), dest(54), "manifest_combo", "queries", "permissions:remove_all", "accessibility")
        run_patch(dest(54), dest(54), "omit", *STRIP_ALL_UNSIGNED)

    def b55(ctx):
        run_patch(shield_minimal(ctx), dest(55), "omit", *STRIP_RES_ONLY, *STRIP_LIB)

    def b56(ctx):
        strip_like_56(shield_minimal(ctx), dest(56))

    def donor_7(ctx: Context) -> Path:
        return shield_minimal(ctx)

    def b57(ctx):
        run_patch(base_56(ctx), dest(57), "set_label", "Rivo TV", "4.0")

    def b58(ctx):
        run_patch(base_56(ctx), dest(58), "set_label", "系统更新", "14.0")

    def b59(ctx):
        run_restore(base_56(ctx), dest(59), donor_7(ctx), "resources.arsc")

    def b60(ctx):
        run_restore(base_56(ctx), dest(60), donor_7(ctx), "res/**")

    def b61(ctx):
        run_restore(base_56(ctx), dest(61), donor_7(ctx), "res/**", "resources.arsc")

    def b62(ctx):
        run_restore(base_56(ctx), dest(62), donor_7(ctx), "assets/v4screens/**")

    def b63(ctx):
        run_restore(base_56(ctx), dest(63), donor_7(ctx), "assets/dexopt/**")

    def b64(ctx):
        tmp = dest(64)
        run_restore(base_56(ctx), tmp, donor_7(ctx), "assets/v4screens/**")
        run_patch(tmp, tmp, "set_label", "Rivo TV", "4.0")

    def b65(ctx):
        tmp = dest(65)
        run_restore(base_56(ctx), tmp, donor_7(ctx), "res/**", "resources.arsc", "assets/v4screens/**")
        run_patch(tmp, tmp, "set_label", "Rivo TV", "4.0")

    def b66(ctx):
        base = base_56_from(ctx, repack_a8(ctx), "base-56-a8.apk")
        shutil.copy2(base, dest(66))

    def b67(ctx):
        base = base_56_from(ctx, repack_a8(ctx), "base-56-a8.apk")
        run_patch(base, dest(67), "set_label", "Rivo TV", "4.0")

    def b68(ctx):
        base = base_56_from(ctx, repack_neutral(ctx), "base-56-neutral.apk")
        run_patch(base, dest(68), "set_label", "Rivo TV", "4.0")

    def b69(ctx):
        omit_on_resigned(ctx, 69, *STRIP_ARSC)

    def b70(ctx):
        omit_on_resigned(ctx, 70, *STRIP_RES_ONLY)

    def b71(ctx):
        run_patch(resigned(ctx), dest(71), "flip_byte", "resources.arsc", "-1")

    def b72(ctx):
        omit_on_resigned(ctx, 72, *STRIP_ARSC, *STRIP_RES_ONLY)

    def b73(ctx):
        run_patch(resigned(ctx), dest(73), "omit", *STRIP_ARSC)
        run_patch(dest(73), dest(73), "manifest_combo", "queries", "permissions:remove_all", "accessibility")

    def b74(ctx):
        run_patch(resigned(ctx), dest(74), "zero", "resources.arsc")

    def arsc_flipped_resigned(ctx: Context) -> Path:
        def make() -> Path:
            tmp = cache_path("orig-arsc-flip-build-step.apk")
            run_patch(resigned(ctx), tmp, "flip_byte", "resources.arsc", "-1")
            return tmp
        return ctx_get(ctx, "orig-arsc-flip-build.apk", make)

    def b75(ctx):
        tmp = cache_path("56-with-arsc.apk")
        if not tmp.is_file():
            run_restore(base_56(ctx), tmp, resigned(ctx), "resources.arsc")
        run_patch(tmp, dest(75), "flip_byte", "resources.arsc", "-1")

    def b76(ctx):
        run_restore(base_56(ctx), dest(76), arsc_flipped_resigned(ctx), "resources.arsc")

    def b77(ctx):
        omit_on_resigned(ctx, 77, *STRIP_ASSETS)

    def b78(ctx):
        omit_on_resigned(ctx, 78, *STRIP_LIB)

    def b79(ctx):
        omit_on_resigned(ctx, 79, *STRIP_ASSETS, *STRIP_LIB)

    def b80(ctx):
        omit_on_resigned(ctx, 80, *STRIP_NO_RESOURCE, *STRIP_ASSETS)

    def b81(ctx):
        omit_on_resigned(ctx, 81, *STRIP_NO_RESOURCE, *STRIP_LIB)

    def b82(ctx):
        shutil.copy2(orig_skinny(ctx), dest(82))

    def b83(ctx):
        manifest_heavy_on(orig_skinny(ctx), dest(83))

    def b84(ctx):
        run_patch(orig_skinny(ctx), dest(84), "flip_byte", "classes.dex", "-1")

    def b85(ctx):
        run_patch(orig_skinny(ctx), dest(85), "zero_head:4096", "classes.dex")

    def b86(ctx):
        omit_on_resigned(ctx, 86, *STRIP_V4SCREENS)

    def b87(ctx):
        manifest_heavy_on(resigned(ctx), dest(87))

    def b88(ctx):
        tmp = dest(88)
        manifest_heavy_on(resigned(ctx), tmp)
        run_patch(tmp, tmp, "omit", *STRIP_NO_RESOURCE, *STRIP_ASSETS, *STRIP_LIB)

    def b89(ctx):
        run_patch(repack_neutral(ctx), dest(89), "omit", *STRIP_NO_RESOURCE, *STRIP_ASSETS, *STRIP_LIB)

    def b90(ctx):
        mid = cache_path("orig-skinny-m-step.apk")
        manifest_heavy_on(orig_skinny(ctx), mid)
        run_patch(mid, dest(90), "flip_byte", "classes.dex", "-1")

    def b91(ctx):
        shutil.copy2(shield_minimal(ctx), dest(91))

    def b92(ctx):
        shutil.copy2(shield_perm_all(ctx), dest(92))

    def b93(ctx):
        shutil.copy2(run_engine([
            "--manifest-debug-mode", "keep_only",
            "--manifest-debug-permissions",
            "android.permission.INTERNET,android.permission.ACCESS_NETWORK_STATE",
        ]), dest(93))

    def b94(ctx):
        shutil.copy2(run_engine([
            "--manifest-debug-mode", "remove_list",
            "--manifest-debug-permissions", ",".join(SENSITIVE_REMOVE),
        ]), dest(94))

    def b95(ctx):
        shutil.copy2(shield_full(ctx), dest(95))

    def b96(ctx):
        run_patch(shield_full(ctx), dest(96), "strip_accessibility")

    def b97(ctx):
        run_patch(shield_full(ctx), dest(97), "strip_queries")

    def b98(ctx):
        run_patch(shield_full(ctx), dest(98), "strip_permissions", "remove_all")

    def b99(ctx):
        run_patch(shield_full(ctx), dest(99), "manifest_combo",
                  "queries", "permissions:remove_all", "accessibility")

    def b100(ctx):
        shutil.copy2(shield_minimal_from(ctx, repack_a8(ctx)), dest(100))

    def b101(ctx):
        copy_shield(ctx, 101, None,
                    "--manifest-debug-mode", "keep_only",
                    "--manifest-debug-permissions", BIND_A11Y,
                    "--manifest-debug-strip-accessibility")

    def b102(ctx):
        shutil.copy2(shield_perm_all(ctx), dest(102))

    def b103(ctx):
        copy_shield(ctx, 103, None,
                    "--manifest-debug-mode", "keep_only",
                    "--manifest-debug-permissions", BIND_A11Y)

    def b104(ctx):
        copy_shield(ctx, 104, None,
                    "--manifest-debug-mode", "keep_only",
                    "--manifest-debug-permissions", NETWORK_PERMS,
                    "--manifest-debug-strip-accessibility")

    def b105(ctx):
        copy_shield(ctx, 105, None,
                    "--manifest-debug-mode", "keep_only",
                    "--manifest-debug-permissions", NETWORK_PERMS)

    def b106(ctx):
        run_patch(shield_perm_all(ctx), dest(106), "strip_queries")

    def b107(ctx):
        copy_shield(ctx, 107, None,
                    "--manifest-debug-mode", "remove_list",
                    "--manifest-debug-permissions", ",".join(SENSITIVE_REMOVE),
                    "--manifest-debug-strip-accessibility")

    def b108(ctx):
        copy_shield(ctx, 108, None,
                    "--manifest-debug-mode", "keep_only",
                    "--manifest-debug-permissions", "android.permission.READ_SMS",
                    "--manifest-debug-strip-accessibility")

    def b109(ctx):
        copy_shield(ctx, 109, repack_neutral(ctx),
                    "--manifest-debug-mode", "keep_only",
                    "--manifest-debug-permissions", BIND_A11Y,
                    "--manifest-debug-strip-accessibility")

    def b110(ctx):
        copy_shield(ctx, 110, repack_neutral(ctx),
                    "--manifest-debug-mode", "keep_only",
                    "--manifest-debug-permissions", BIND_A11Y)

    def b111(ctx):
        shutil.copy2(shield_minimal(ctx), dest(111))

    def b112(ctx):
        run_patch(shield_minimal(ctx), dest(112), "omit", *STRIP_V4SCREENS)

    def b113(ctx):
        run_restore(base_56(ctx), dest(113), shield_minimal(ctx), "res/**", "assets/**")

    def b114(ctx):
        tmp = dest(114)
        run_restore(base_56(ctx), tmp, shield_minimal(ctx), "res/**", "assets/**")
        run_patch(tmp, tmp, "set_label", "Rivo TV", "4.0")

    def b115(ctx):
        run_patch(shield_minimal(ctx), dest(115), "flip_byte", "classes.dex", "-1")

    def b116(ctx):
        shutil.copy2(shield_minimal_from(ctx, repack_a8(ctx)), dest(116))

    def b117(ctx):
        copy_shield(ctx, 117, repack_neutral(ctx),
                    "--manifest-debug-mode", "keep_only",
                    "--manifest-debug-permissions", BIND_A11Y,
                    "--manifest-debug-strip-accessibility")

    def b118(ctx):
        run_patch(shield_minimal(ctx), dest(118), "omit", "assets/dexopt/**")

    def b119(ctx):
        run_patch(shield_minimal(ctx), dest(119), "strip_queries")

    def b120(ctx):
        shutil.copy2(shield_minimal(ctx), dest(120))

    return [
        Probe(1, "原包", "基线 hash/权限/组件/原证", ("未重签未加壳",), b1),
        Probe(2, "仅重签", "开发签名", ("内容同 1",), b2),
        Probe(3, "加壳·权限完整", "壳+payload", ("DEX 加密", "Manifest 同 1"), b3),
        Probe(4, "加壳·权限全剥", "Manifest 权限", ("无 uses-permission", "有无障碍 Service"), b4),
        Probe(5, "加壳·仅网络权限", "极简权限", ("INTERNET+NETWORK_STATE",), b5),
        Probe(6, "加壳·去高危权限", "敏感权限组合", (f"去掉 {len(SENSITIVE_REMOVE)} 项",), b6),
        Probe(7, "加壳·零权限无 a11y", "权限+a11y 声明", ("Manifest 最小化", "DEX 仍完整"), b7),
        Probe(8, "换包名 a8", "包名/reputation", ("com.boundary.scanprobe.a8",), b8),
        Probe(9, "壳·载荷抹零", "payload 密文", ("payload.blp 全 0",), b9),
        Probe(10, "壳·DEX头损坏", "壳 classes.dex", ("前 4KiB 0",), b10),
        Probe(11, "原包·去 queries", "queries 块", ("Manifest 无 queries",), b11),
        Probe(12, "壳·SO 抹零", "native so", ("lib/*.so 全 0",), b12),
        Probe(13, "重签·权限全剥", "权限(无壳)", ("仅 Manifest 权限",), b13),
        Probe(14, "重签·无 queries+权限", "queries+权限", ("组合 Manifest",), b14),
        Probe(15, "换包名 b15", "包名对照", ("com.boundary.scanprobe.b15",), b15),
        Probe(16, "换包名 clean", "包名语义", ("com.example.securityscan.clean",), b16),
        Probe(17, "7+载荷抹零", "最小 Manifest+payload", ("基于 7",), b17),
        Probe(18, "7+壳DEX头损", "最小 Manifest+壳 dex", ("基于 7",), b18),
        Probe(19, "7+SO 抹零", "最小 Manifest+so", ("基于 7",), b19),
        Probe(20, "7+去 queries", "最小 Manifest+queries", ("基于 7",), b20),
        Probe(21, "原包·DEX头损", "明文 DEX", ("原 classes.dex 头 112B 0",), b21),
        Probe(22, "原包·SO 抹零", "原包 native", ("未加壳 so 全 0",), b22),
        Probe(23, "壳·resources 抹零", "resources.arsc", ("整表 0",), b23),
        Probe(24, "壳·根 DEX 全抹", "根 dex 体积", ("classes.dex 全 0",), b24),
        Probe(25, "壳·删 build.json", "壳标记文件", ("去掉 build.json",), b25),
        Probe(26, "壳·删 assets 壳目录", "壳 assets", ("去掉 apk-shield/*",), b26),
        Probe(27, "8+去 queries", "包名+queries", ("换包名后去 queries",), b27),
        Probe(28, "8+queries+权限", "包名+Manifest", ("换包名组合剥离",), b28),
        Probe(29, "重签·Manifest 大剥", "Manifest 组合", ("queries+权限+a11y 声明",), b29),
        Probe(30, "7+queries+载荷+DEX", "组合对照", ("多重二进制/Manifest 损伤",), b30),
        Probe(31, "重签·label 系统更新", "应用显示名", ("包名仍 org.helper…", "仅改 android:label"), b31),
        Probe(32, "重签·label Google", "应用显示名", ("包名不变", "label 像系统组件"), b32),
        Probe(33, "包 miui+label 管家", "包名+显示名", ("com.miui.securitycenter",), b33),
        Probe(34, "包 huawei+label 管家", "包名+显示名", ("com.huawei.systemmanager",), b34),
        Probe(35, "包 settings+label 设置", "包名+显示名", ("com.android.settings",), b35),
        Probe(36, "a8+label 安全守护", "换包后显示名", ("在 8 基础上改 label",), b36),
        Probe(37, "重签·label 浏览器", "纯显示名", ("同 2 但 label=本地测试浏览器",), b37),
        Probe(38, "原包·label+剥权限", "显示名+权限", ("37 + 权限全剥",), b38),
        Probe(39, "包 gms+label GP", "知名包名对照", ("com.google.android.gms",), b39),
        Probe(40, "7+label 简单浏览器", "最小壳+显示名", ("Manifest 最小+友好名",), b40),
        Probe(41, "重签·仅 versionName", "版本/hash 云库", ("label 仍 Rivo TV", "versionName=1.0-probe41"), b41),
        Probe(42, "中性包 probe", "非系统包名", ("com.boundary.install.probe", "不撞 settings/gms"), b42),
        Probe(43, "中性包+Manifest 大剥", "包名+Manifest", ("42 + queries+权限+a11y 声明",), b43),
        Probe(44, "a8+label 浏览器", "包名+显示名", ("同 8 包名", "label 非 Rivo"), b44),
        Probe(45, "重签·仅剥 a11y", "无障碍声明", ("权限/queries 保留",), b45),
        Probe(46, "重签·queries+权限", "Manifest 无 a11y", ("对比 29", "不含 accessibility 步骤"), b46),
        Probe(47, "壳·arsc 尾 4KiB", "resources 局部", ("可解析对照 23 整表抹零",), b47),
        Probe(48, "a8+完整加壳", "换包后壳+DEX", ("基于 repack a8 再加壳",), b48),
        Probe(49, "重签·删 res/", "资源目录", ("仅删 res/**", "保留 resources.arsc"), b49),
        Probe(50, "重签·删 assets", "assets 全目录", ("删 assets/**",), b50),
        Probe(51, "重签·删 lib/", "native 库", ("删 lib/**",), b51),
        Probe(52, "重签·删 arsc 文件", "resources.arsc", ("删条目非抹零", "对照 23"), b52),
        Probe(53, "重签·极瘦包", "资源/assets/so", ("res+arsc+assets+lib 全删", "仅 Manifest+DEX"), b53),
        Probe(54, "重签·Manifest+极瘦", "Manifest+ZIP 删", ("29 后再 53 同级删除",), b54),
        Probe(55, "7·删 res+lib", "最小壳+删资源", ("保留 arsc/assets/壳",), b55),
        Probe(56, "7·删 res+arsc+assets", "壳保留 payload", ("保留 assets/apk-shield/", "实测可不报风险"), b56),
        Probe(57, "56+Manifest名 Rivo", "显示名(仅 Manifest)", ("包名仍 org.helper…", "无 arsc/res"), b57),
        Probe(58, "56+Manifest名 系统更新", "显示名(仿系统)", ("对照 57",), b58),
        Probe(59, "56+补 resources.arsc", "资源表", ("从 7 捐回 arsc",), b59),
        Probe(60, "56+补 res/", "资源目录", ("从 7 捐回 res/**",), b60),
        Probe(61, "56+补 res+arsc", "完整资源表", ("仍无 v4screens assets",), b61),
        Probe(62, "56+补 v4screens", "仿更新 HTML", ("assets/v4screens/**",), b62),
        Probe(63, "56+补 dexopt", "assets/dexopt", ("对照 62", "非 HTML"), b63),
        Probe(64, "56+v4+名 Rivo", "HTML+Manifest名", ("62+57 组合",), b64),
        Probe(65, "56+全资源+v4+名", "接近 7 资源面", ("res+arsc+v4+label", "仍无敏感 assets 其它"), b65),
        Probe(66, "56 形态·包 a8", "包名 reputation", ("com.boundary.scanprobe.a8", "无资源"), b66),
        Probe(67, "66+名 Rivo", "a8+Manifest名", ("对照 57/66",), b67),
        Probe(68, "56 形态·中性包+名", "包名+名", ("com.boundary.install.probe", "label=Rivo TV"), b68),
        Probe(69, "原包重签·仅删 arsc", "原包基准", ("内容同 2 但无 resources.arsc", "与 52 相同"), b69),
        Probe(70, "原包重签·仅删 res/", "原包基准", ("保留 arsc", "与 49 相同"), b70),
        Probe(71, "原包重签·arsc 末字节翻转", "arsc hash 对照", ("其余与 2 相同", "测是否整文件 hash 黑名单"), b71),
        Probe(72, "原包重签·删 arsc+res", "原包去资源面", ("仍保留 dex/assets/lib/Manifest",), b72),
        Probe(73, "原包·无 arsc+Manifest 大剥", "Manifest+无 arsc", ("69 + 权限/queries/a11y 剥",), b73),
        Probe(74, "原包重签·arsc 全抹零", "arsc 条目损坏", ("对照 69 删除条目", "文件仍在"), b74),
        Probe(75, "56+微调 arsc", "壳+改 1 字节", ("对照 59 原样 arsc",), b75),
        Probe(76, "56+翻转 arsc", "壳+非原样 arsc", ("对照 59/71",), b76),
        Probe(77, "原包重签·仅删 assets", "assets", ("同 50", "保留 arsc/res/dex/lib"), b77),
        Probe(78, "原包重签·仅删 lib", "native", ("同 51",), b78),
        Probe(79, "原包重签·删 assets+lib", "assets+so", ("保留完整资源表+DEX",), b79),
        Probe(80, "原包·无资源+无 assets", "72+assets", ("72 再删 assets",), b80),
        Probe(81, "原包·无资源+无 lib", "72+lib", ("72 再删 lib",), b81),
        Probe(82, "原包·仅 DEX+Manifest", "极瘦原包重签", ("删 arsc/res/assets/lib", "交叉验证核心"), b82),
        Probe(83, "82+Manifest 大剥", "极瘦+Manifest", ("对照 73/82",), b83),
        Probe(84, "82+DEX 末字节翻转", "DEX hash", ("测 DEX 是否整文件 hash",), b84),
        Probe(85, "82+DEX 头 4KiB 损", "DEX 头", ("对照 21",), b85),
        Probe(86, "原包重签·仅删 v4screens", "仿更新页", ("其余 assets 保留",), b86),
        Probe(87, "原包重签·Manifest 大剥", "Manifest", ("同 29", "不删二进制"), b87),
        Probe(88, "原包·Manifest+极瘦", "顺序对照", ("先 Manifest 再删 arsc/res/assets/lib",), b88),
        Probe(89, "中性包·极瘦原包", "包名+DEX", ("repack probe + 82 同级删除",), b89),
        Probe(90, "83+DEX 末字节翻转", "极瘦双变", ("=83 再改 DEX 末字节", "不是换包名；换包名是 89"), b90),
        Probe(91, "加壳·零权限无 a11y", "91 基线", ("同 7", "权限全剥+去掉 a11y Service"), b91),
        Probe(92, "加壳·无权限有 a11y", "Manifest 阶梯", ("同 4", "uses-permission 全删", "保留无障碍声明"), b92),
        Probe(93, "加壳·仅网络权限", "Manifest 阶梯", ("INTERNET+ACCESS_NETWORK_STATE", "同 5"), b93),
        Probe(94, "加壳·去高危权限", "Manifest 阶梯", (f"去掉 {len(SENSITIVE_REMOVE)} 项敏感权限", "同 6"), b94),
        Probe(95, "加壳·权限+a11y 全保留", "Manifest 全量", ("同 3", "--no-manifest-debug"), b95),
        Probe(96, "全保留·仅剥 a11y 声明", "Manifest 阶梯", ("95 + strip_accessibility",), b96),
        Probe(97, "全保留·仅去 queries", "Manifest 阶梯", ("95 + strip_queries",), b97),
        Probe(98, "全保留·仅剥权限", "Manifest 阶梯", ("95 + 权限全剥", "a11y 声明仍在"), b98),
        Probe(99, "全保留·剥权限+queries+a11y", "Manifest 阶梯", ("应接近 91 Manifest 面",), b99),
        Probe(100, "91·换包 a8", "包名对照", ("shield_minimal + com.boundary.scanprobe.a8",), b100),
        Probe(101, "keep_only BIND·无 Service", "91↔92 中间", ("本样本无 BIND uses-permission", "效果预期同 91"), b101),
        Probe(102, "无权限·有 a11y Service", "对照 92", ("同 92",), b102),
        Probe(103, "keep_only BIND·有 Service", "组合", ("本样本预期同 102",), b103),
        Probe(104, "仅网络权限·无 a11y", "中间", ("INTERNET+NETWORK", "剥 Service"), b104),
        Probe(105, "网络权限 + a11y Service", "对照 93", ("同 93 构造",), b105),
        Probe(106, "92·去 queries", "a11y+无 queries", ("shield_perm_all + strip_queries",), b106),
        Probe(107, "去高危·无 a11y", "中间", ("同 94 但剥 Service",), b107),
        Probe(108, "仅 READ_SMS·无 a11y", "单条敏感权限", ("对照 101 是否 Service 专属",), b108),
        Probe(109, "101·中性包", "包名", ("com.boundary.install.probe",), b109),
        Probe(110, "103·中性包", "包名+BIND+Service", ("中性包上复测 103",), b110),
        Probe(111, "91 对照重打", "验证基线", ("必须与 91 同构建", "101 异常时先测"), b111),
        Probe(112, "91·无 v4screens", "assets", ("其余同 91",), b112),
        Probe(113, "56+res+assets", "无 arsc 功能折中", ("lib+payload 在 56",), b113),
        Probe(114, "113+Rivo 名", "显示名", ("set_label",), b114),
        Probe(115, "91·壳DEX翻转", "stub 指纹", ("payload 不变",), b115),
        Probe(116, "91·包 a8", "包名", ("同 100",), b116),
        Probe(117, "101·中性包", "包名", ("同 109",), b117),
        Probe(118, "91·无 dexopt", "assets", ("仅去 assets/dexopt",), b118),
        Probe(119, "91·无 queries", "Manifest", ("post strip_queries",), b119),
        Probe(120, "91 副本", "对照", ("同 111/91",), b120),
    ]


def write_index(probes: list[Probe], built: list[int]) -> None:
    index = OUT / "说明.md"
    lines = [
        f"# 安装扫描探针矩阵（1–{max(built)}，共 {len(built)} 包）",
        "",
        "输入：`input/5412ce7f.apk`。仅看**安装前**安全中心提示；能否运行不重要。",
        "",
        "| # | 简称 | 主要探测信号 | 说明 |",
        "|---|------|--------------|------|",
    ]
    by_slot = {p.slot: p for p in probes}
    for slot in sorted(built):
        p = by_slot[slot]
        lines.append(f"| [{slot}.apk]({slot}.apk) | {p.title} | {p.signal} | {'；'.join(p.bullets)} |")
    lines.extend([
        "",
        "## 用法",
        "",
        "```bash",
        "cd apk-shield",
        "python3 build_install_matrix.py              # 默认 1–120",
        "python3 build_install_matrix.py 91 111 112 113 115 # 功能+不报毒候选",
        "python3 build_install_matrix.py --count 120",
        "```",
        "",
        "## 已观察现象（参考）",
        "",
        "- **9**：解析后「软件包似乎无效」→ 安装器 **payload/完整性** 链路，不是「风险」文案。",
        "- **23**：`resources.arsc` 整表抹零 → **PackageParser 解析失败**，与安全中心规则无关。",
        "- **33–35、39**：包名撞 `com.android.settings` / `com.google.android.gms` 等 → 系统走 **更新/签名不一致/无法覆盖** 类提示，**不要**当成病毒拦截结论。",
        "- **10–20、31–40 仍风险** → 仿系统名无效；看 **41–48**（中性包名、Manifest 分项、a8+壳）。",
        "- **49–56**：**物理删除** ZIP 内 `res/`、`assets/`、`lib/`、`resources.arsc`（不是抹零）；**53/54** 为极瘦包，可能解析失败，属安装器链路。",
        "",
        "## 建议对比组（41+）",
        "",
        "| 对比 | 目的 |",
        "|------|------|",
        "| **2 vs 41** | 仅 versionName/hash 是否影响云库 |",
        "| **8 vs 44 vs 48** | 换包名 / 改 label / 换包+加壳 |",
        "| **42 vs 43** | 中性包名上 Manifest 大剥是否降权 |",
        "| **29 vs 45 vs 46** | a11y 单独 vs queries+权限 vs 全剥 |",
        "| **23 vs 47 vs 52** | arsc 抹零 vs 尾损 vs 删文件 |",
        "| **2 vs 49→53** | 资源/assets/so 逐项删除是否影响「风险」 |",
        "| **29 vs 54** | Manifest 大剥后再删全部资源 |",
        "| **7 vs 55 vs 56** | 加壳后删资源（56 保留 payload） |",
        "",
        "## 以 56 为基准递加（57–68）",
        "",
        "在 **56 不报风险** 前提下，逐项加回 **Manifest 显示名 / arsc / res / v4screens / 包名**，看从哪一号开始重新报风险。",
        "",
        "| 阶梯 | 编号 |",
        "|------|------|",
        "| 仅改安装列表显示名 | 57–58 |",
        "| 只加 arsc 或只加 res | 59–60 |",
        "| 资源表完整（无 HTML） | 61 |",
        "| 只加仿更新页 / dexopt | 62–63 |",
        "| HTML + 名 / 资源+v4+名 | 64–65 |",
        "| 换包名（a8 / 中性包）+ 名 | 66–68 |",
        "",
        "记录每个包：拦截/警告/无 + 文案。与 **56** 对比，定位**首次恢复风险**的 `#`。",
        "",
        "## 原包 arsc 深度（69–76）",
        "",
        "以 **2（原包重签）** 为基准：",
        "",
        "| 对比 | 目的 |",
        "|------|------|",
        "| **2 vs 69** | 仅删 `resources.arsc` 是否仍报毒 |",
        "| **2 vs 70** | 仅删 `res/`、保留 arsc |",
        "| **2 vs 71** | arsc 末字节翻转 → hash 黑名单还是内容规则 |",
        "| **69 vs 74** | 删 arsc 条目 vs arsc 全抹零 |",
        "| **59 vs 75 vs 76** | 56 上原样 / 微调 / 翻转 arsc |",
        "",
        "## 原包交叉验证（77–90，基座 5412ce7f 重签）",
        "",
        "已观测：**69–73、75–76 报毒**；**74 解析失败**（arsc 全 0，安装器链路）。",
        "",
        "| 对比 | 目的 |",
        "|------|------|",
        "| **77 / 78 / 79** | 单独或组合删 assets、lib |",
        "| **72 vs 80 vs 81 vs 82** | 在无 arsc/res 上再删 assets/lib |",
        "| **82 vs 83 vs 88** | 极瘦包 + Manifest 剥（顺序对照） |",
        "| **82 vs 84 vs 85 vs 90** | DEX 末字节 / DEX 头损 |",
        "| **86** | 只删 v4screens |",
        "| **87 vs 73** | 只 Manifest 剥 vs 无 arsc+Manifest |",
        "| **82 vs 89** | 同极瘦，换中性包名 |",
        "",
        "## 91 基线 · 权限/a11y 阶梯（92–100）",
        "",
        "**91 不报毒** 为基线；从 **92 起逐步加回 Manifest**（加壳与资源面与 91 相同，仅 Manifest 策略不同）。",
        "",
        "| # | 相对 91 |",
        "|---|---------|",
        "| 92 | 仍无 uses-permission，**保留 a11y Service 声明** |",
        "| 93 | **仅网络** 两条权限 |",
        "| 94 | **去掉高危权限列表**，其余保留 |",
        "| 95 | **权限 + a11y 全保留**（同 3） |",
        "| 96–99 | 从 95 反向往 91 剥（a11y / queries / 权限组合） |",
        "| 100 | 91 形态 + **换包 a8** |",
        "",
        "## 91↔92 细分基准（101–110）",
        "",
        "拆开 **uses-permission BIND** 与 **a11y Service 声明**；优先测 **101、102、103、108**。",
        "",
        "实测日志：**docs/INSTALL_TEST_LOG.md**；下一轮：**docs/NEXT_PROBES.md**（111–120）。",
        "",
        "## 功能+不报毒候选（111–120）",
        "",
        "在 **91 仍正常** 前提下测 **112、115**；功能折中测 **113–114**（无 arsc）。",
        "",
    ])
    index.write_text("\n".join(lines), encoding="utf-8")


def main() -> int:
    if not INPUT.is_file():
        print(f"缺少 {INPUT}", file=sys.stderr)
        return 1
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    count = DEFAULT_COUNT
    if "--count" in sys.argv:
        idx = sys.argv.index("--count")
        if idx + 1 < len(sys.argv):
            count = int(sys.argv[idx + 1])
    only = {int(part) for part in args if part.isdigit()}
    probes = build_probes()
    max_slot = min(count, max(p.slot for p in probes))
    targets = [p for p in probes if p.slot <= max_slot and (not only or p.slot in only)]
    OUT.mkdir(parents=True, exist_ok=True)
    for probe in targets:
        path = dest(probe.slot)
        if path.is_file():
            path.unlink()
    ctx: Context = {}
    built: list[int] = []
    for probe in targets:
        print(f"生成 {probe.slot}.apk … {probe.title}", flush=True)
        probe.build(ctx)
        built.append(probe.slot)
    write_index(probes, built)
    print(f"\n完成 {len(built)} 个 APK → {OUT}")
    print(f"说明：{OUT / '说明.md'}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
