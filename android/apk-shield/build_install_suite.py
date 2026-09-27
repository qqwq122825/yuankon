#!/usr/bin/env python3
"""Install-test suite v2: 1–12 归因 arsc；13+ 不含样本 arsc 或可选新 arsc donor。"""
from __future__ import annotations

import shutil
import sys
from pathlib import Path

from build_install_matrix import (
    INPUT,
    OUT,
    Context,
    Probe,
    base_56,
    baseline_90,
    cache_path,
    ctx_get,
    dest,
    resigned,
    run_patch,
    run_restore,
    shield_minimal,
)

BASE = Path(__file__).resolve().parent
DONOR_ARSC_APK = BASE / "input" / "donor-arsc-source.apk"

SUITE_APP_LABEL = "Rivo TV"
SUITE_VERSION_NAME = "4.0"

SUITE_COUNT = 22

SUITE_PURPOSE: dict[int, str] = {
    1: "扫描引擎锚点；原包应报",
    2: "原包线「不报」基线（极瘦+Manifest 大剥+DEX 翻转）",
    3: "加壳 91 全资源对照",
    4: "2 + 名 + 样本 arsc；**已测：报毒**",
    5: "**已测：正常**（仅 Manifest 名）",
    6: "**已测：报毒**（样本 arsc alone）",
    7: "**已测：正常**（仅 res，无 arsc）",
    8: "**已测：正常**（名+res，无 arsc）",
    9: "**已测：报毒**（arsc+res）",
    10: "**已测：仍报毒**（arsc 末字节翻转）",
    11: "**已测：仍报毒**（arsc 首字节翻转）",
    12: "**已测：解析失败**（arsc 尾 4KiB 零）",
    13: "**不含样本 arsc**：2+名+res+assets+lib（963 个 res 文件在 91 捐回）；扫描优先，**功能未实机验证**",
    14: "加壳 91 **去掉 resources.arsc**（保留 payload/res 等）",
    15: "加壳 **56 瘦包**（无 arsc/res/业务 assets）",
    16: "2 + arsc 仅来自 **input/donor-arsc-source.apk**（须新构建；**无文件则跳过**）",
    17: "2 + **assets+lib**（无 arsc、无 res）；比 2 多 native/业务包",
    18: "原包重签仅删 arsc → **已测：仍报毒**（≠13；体积小于 17 因 assets 是原包小包）",
    19: "**已测：报毒**（91+arsc+stub 翻转；≠原包 #90 翻转）",
    20: "**已测：正常**；包名 **org.helper.scannertask**；**无 arsc、无 Manifest 权限/a11y 声明**",
    21: "**已测：正常**；同 15 + stub 翻转；**无 arsc、无 a11y 声明**",
    22: "**交付配方** = shield_minimal + 去样本 arsc + Rivo 名；等同 `build_delivery.py` / **14+label**",
}


def build_suite_probes() -> list[Probe]:
    def b1(_ctx):
        shutil.copy2(INPUT, dest(1))

    def b2(ctx):
        shutil.copy2(baseline_90(ctx), dest(2))

    def donor91(ctx: Context) -> Path:
        return shield_minimal(ctx)

    def b3(ctx):
        shutil.copy2(donor91(ctx), dest(3))

    def line4(ctx: Context) -> Path:
        def make() -> Path:
            mid = cache_path("suite-line-4-mid.apk")
            out = cache_path("suite-line-4-build.apk")
            run_patch(
                baseline_90(ctx),
                mid,
                "set_label",
                SUITE_APP_LABEL,
                SUITE_VERSION_NAME,
            )
            run_restore(mid, out, INPUT, "resources.arsc")
            return out

        return ctx_get(ctx, "suite-line-4.apk", make)

    def only_label(ctx: Context) -> Path:
        def make() -> Path:
            out = cache_path("suite-5-label-only.apk")
            run_patch(
                baseline_90(ctx),
                out,
                "set_label",
                SUITE_APP_LABEL,
                SUITE_VERSION_NAME,
            )
            return out

        return ctx_get(ctx, "suite-5-label.apk", make)

    def only_arsc(ctx: Context) -> Path:
        def make() -> Path:
            out = cache_path("suite-6-arsc-only.apk")
            run_restore(baseline_90(ctx), out, INPUT, "resources.arsc")
            return out

        return ctx_get(ctx, "suite-6-arsc.apk", make)

    def only_res(ctx: Context) -> Path:
        def make() -> Path:
            out = cache_path("suite-7-res-only.apk")
            run_restore(baseline_90(ctx), out, donor91(ctx), "res/**")
            return out

        return ctx_get(ctx, "suite-7-res.apk", make)

    def label_and_res(ctx: Context) -> Path:
        out = cache_path("suite-8-label-res-build.apk")
        if not out.is_file():
            mid = cache_path("suite-8-mid.apk")
            run_patch(
                baseline_90(ctx),
                mid,
                "set_label",
                SUITE_APP_LABEL,
                SUITE_VERSION_NAME,
            )
            run_restore(mid, out, donor91(ctx), "res/**")
        return out

    def arsc_and_res(ctx: Context) -> Path:
        out = cache_path("suite-9-arsc-res-build.apk")
        if not out.is_file():
            mid = cache_path("suite-9-mid.apk")
            run_restore(baseline_90(ctx), mid, INPUT, "resources.arsc")
            run_restore(mid, out, donor91(ctx), "res/**")
        return out

    def no_sample_arsc_full(ctx: Context) -> Path:
        out = cache_path("suite-13-no-arsc-full-build.apk")
        if not out.is_file():
            mid = cache_path("suite-13-mid.apk")
            run_patch(
                baseline_90(ctx),
                mid,
                "set_label",
                SUITE_APP_LABEL,
                SUITE_VERSION_NAME,
            )
            run_restore(mid, out, donor91(ctx), "res/**", "assets/**", "lib/**")
        return out

    def b4(ctx):
        shutil.copy2(line4(ctx), dest(4))

    def b5(ctx):
        shutil.copy2(only_label(ctx), dest(5))

    def b6(ctx):
        shutil.copy2(only_arsc(ctx), dest(6))

    def b7(ctx):
        shutil.copy2(only_res(ctx), dest(7))

    def b8(ctx):
        shutil.copy2(label_and_res(ctx), dest(8))

    def b9(ctx):
        shutil.copy2(arsc_and_res(ctx), dest(9))

    def b10(ctx):
        run_patch(only_arsc(ctx), dest(10), "flip_byte", "resources.arsc", "-1")

    def b11(ctx):
        run_patch(only_arsc(ctx), dest(11), "flip_byte", "resources.arsc", "0")

    def b12(ctx):
        run_patch(only_arsc(ctx), dest(12), "zero_tail:4096", "resources.arsc")

    def b13(ctx):
        shutil.copy2(no_sample_arsc_full(ctx), dest(13))

    def b14(ctx):
        run_patch(donor91(ctx), dest(14), "omit", "resources.arsc")

    def b15(ctx):
        shutil.copy2(base_56(ctx), dest(15))

    def b16(ctx):
        if not DONOR_ARSC_APK.is_file():
            raise FileNotFoundError(
                f"16 需要新构建 donor：{DONOR_ARSC_APK}（Telegram/Gradle 产物，非 5412ce7f arsc）"
            )
        run_restore(baseline_90(ctx), dest(16), DONOR_ARSC_APK, "resources.arsc")

    def b17(ctx):
        out = cache_path("suite-17-assets-lib-build.apk")
        if not out.is_file():
            run_restore(baseline_90(ctx), out, donor91(ctx), "assets/**", "lib/**")
        shutil.copy2(out, dest(17))

    def b18(ctx):
        run_patch(resigned(ctx), dest(18), "omit", "resources.arsc")

    def shield_no_arsc(ctx: Context) -> Path:
        out = cache_path("suite-14-no-arsc-build.apk")
        if not out.is_file():
            run_patch(donor91(ctx), out, "omit", "resources.arsc")
        return out

    def b19(ctx):
        run_patch(donor91(ctx), dest(19), "flip_byte", "classes.dex", "-1")

    def b20(ctx):
        run_patch(shield_no_arsc(ctx), dest(20), "flip_byte", "classes.dex", "-1")

    def b21(ctx):
        run_patch(base_56(ctx), dest(21), "flip_byte", "classes.dex", "-1")

    def delivery_build(ctx: Context) -> Path:
        out = cache_path("suite-22-delivery-build.apk")
        if not out.is_file():
            mid = cache_path("suite-22-delivery-mid.apk")
            run_patch(donor91(ctx), mid, "omit", "resources.arsc")
            run_patch(mid, out, "set_label", SUITE_APP_LABEL, SUITE_VERSION_NAME)
        return out

    def b22(ctx):
        shutil.copy2(delivery_build(ctx), dest(22))

    return [
        Probe(1, "原包", "基线", ("5412ce7f 未改",), b1),
        Probe(2, "安全基线·原90", "极瘦", ("baseline_90",), b2),
        Probe(3, "加壳·91", "对照", ("shield_minimal",), b3),
        Probe(4, "2+名+样本arsc", "组合", ("用户测：报毒",), b4),
        Probe(5, "2+仅名", "单因子", (), b5),
        Probe(6, "2+样本arsc", "单因子", (), b6),
        Probe(7, "2+仅res", "单因子", (), b7),
        Probe(8, "2+名+res", "组合", ("无 arsc",), b8),
        Probe(9, "2+arsc+res", "组合", (), b9),
        Probe(10, "6+arsc末字节", "变异", (), b10),
        Probe(11, "6+arsc首字节", "变异", (), b11),
        Probe(12, "6+arsc尾4K零", "变异", (), b12),
        Probe(
            13,
            "2+名+res+assets+lib",
            "无样本arsc",
            ("不含 resources.arsc", "res 963 文件←91", "功能待实机"),
            b13,
        ),
        Probe(14, "91−arsc", "加壳", ("omit resources.arsc",), b14),
        Probe(15, "加壳·56瘦", "加壳", ("无 arsc/res/业务assets",), b15),
        Probe(
            16,
            "2+donor arsc",
            "新 arsc",
            (f"需 {DONOR_ARSC_APK.name}", "无文件则跳过"),
            b16,
        ),
        Probe(17, "2+assets+lib", "无arsc无res", (), b17),
        Probe(
            18,
            "原包−仅arsc",
            "原包线",
            ("重签", "保留 DEX/Manifest/res/assets/lib", "删 resources.arsc"),
            b18,
        ),
        Probe(19, "91+壳DEX翻转", "加壳+反转", ("全资源+arsc", "payload 不变", "对照 3"), b19),
        Probe(20, "14+壳DEX翻转", "加壳+反转", ("无 arsc", "对照 14"), b20),
        Probe(21, "15+壳DEX翻转", "加壳+反转", ("56 瘦", "对照 15"), b21),
        Probe(
            22,
            "交付·无样本arsc",
            "交付",
            ("= build_delivery.py", "全 res/payload/lib", "无 5412ce7f arsc"),
            b22,
        ),
    ]


def write_suite_index(probes: list[Probe]) -> None:
    index = OUT / "说明.md"
    lines = [
        "# 安装测试套件 v2",
        "",
        "资源表说明：**docs/RESOURCES_ARSC.md**。arsc 报告：**docs/ARSC_SCAN_REPORT.md**。",
        "",
        "**13+ 原则**：默认**不加入 5412ce7f 的 resources.arsc**；需要 arsc 时用 **16 + donor-arsc-source.apk**（新构建）。",
        "",
        "| # | 简称 | 测试用途 | 构造要点 |",
        "|---|------|----------|----------|",
    ]
    for p in sorted(probes, key=lambda x: x.slot):
        if p.slot > SUITE_COUNT:
            continue
        purpose = SUITE_PURPOSE.get(p.slot, "")
        detail = "；".join(p.bullets) if p.bullets else p.signal
        lines.append(f"| [{p.slot}.apk]({p.slot}.apk) | {p.title} | {purpose} | {detail} |")
    if not DONOR_ARSC_APK.is_file():
        lines.extend(
            [
                "",
                f"> **16.apk 未生成**：请放入 `{DONOR_ARSC_APK.relative_to(BASE)}`（Telegram/Gradle 新图标新名构建）。",
                "",
            ]
        )
    lines.extend(
        [
            "",
            "## 推荐（13 起 / 加壳反转 19 起）",
            "",
            "**交付：22** 或 `python3 build_delivery.py`。实验对照见 **docs/SHIELD_DELIVERY.md**.",
            "",
            "```bash",
            "python3 build_install_suite.py 19 20 21",
            "```",
            "",
        ]
    )
    index.write_text("\n".join(lines), encoding="utf-8")


def purge_old_apks() -> None:
    for path in OUT.glob("*.apk"):
        path.unlink()


def purge_obsolete_slots(active_slots: set[int]) -> None:
    for path in OUT.glob("*.apk"):
        stem = path.stem
        if stem.isdigit() and int(stem) not in active_slots:
            path.unlink()


def main() -> int:
    if not INPUT.is_file():
        print(f"缺少 {INPUT}", file=sys.stderr)
        return 1
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    only = {int(a) for a in args if a.isdigit()}
    probes = build_suite_probes()
    active = {p.slot for p in probes if p.slot <= SUITE_COUNT}
    targets = [p for p in probes if p.slot <= SUITE_COUNT and (not only or p.slot in only)]
    OUT.mkdir(parents=True, exist_ok=True)
    if not only:
        purge_old_apks()
    else:
        for p in targets:
            dest(p.slot).unlink(missing_ok=True)
        purge_obsolete_slots(active)
    ctx: Context = {}
    built: list[int] = []
    skipped: list[int] = []
    for probe in targets:
        print(f"生成 {probe.slot}.apk … {probe.title}", flush=True)
        try:
            probe.build(ctx)
            built.append(probe.slot)
        except FileNotFoundError as exc:
            if probe.slot == 16:
                print(f"  跳过：{exc}", flush=True)
                skipped.append(probe.slot)
                dest(16).unlink(missing_ok=True)
                continue
            raise
    write_suite_index(probes)
    msg = f"\n完成 {len(built)} 个 APK → {OUT}"
    if skipped:
        msg += f"（跳过 {skipped}）"
    print(msg)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
