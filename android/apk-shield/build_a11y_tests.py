#!/usr/bin/env python3
"""无障碍 + 权限 测试包：对比「有无样本 resources.arsc」与 Manifest 档位。"""
from __future__ import annotations

import argparse
import shutil
import sys
from dataclasses import dataclass
from pathlib import Path

from build_install_matrix import (
    INPUT,
    NETWORK_PERMS,
    cache_path,
    ctx_get,
    run_engine,
    run_patch,
    shield_full,
    shield_perm_all,
)

BASE = Path(__file__).resolve().parent
OUT_DIR = BASE / "output" / "delivery" / "a11y-test"
DELIVERY_ALIAS = BASE / "output" / "delivery" / "5412ce7f-shield-a11y-full.apk"

APP_LABEL = "Rivo TV"
VERSION_NAME = "4.0"


@dataclass(frozen=True)
class A11yVariant:
    filename: str
    note: str


VARIANTS: tuple[A11yVariant, ...] = (
    A11yVariant(
        "01-a11y-no-arsc.apk",
        "有 a11y Service、0 uses-permission、**无 arsc**（≈92 去 arsc）",
    ),
    A11yVariant(
        "02-a11y-with-arsc.apk",
        "有 a11y、0 permission、**含样本 arsc**（≈92，预期报毒）",
    ),
    A11yVariant(
        "03-fullmanifest-no-arsc.apk",
        "**全权限 + a11y**、**无 arsc**（≈95 去 arsc）",
    ),
    A11yVariant(
        "04-fullmanifest-with-arsc.apk",
        "全 Manifest + **样本 arsc**（≈95/3，预期报毒）",
    ),
    A11yVariant(
        "05-network-a11y-no-arsc.apk",
        "仅 **INTERNET+NETWORK** + **a11y**、无 arsc（≈105 去 arsc）",
    ),
    A11yVariant(
        "06-network-a11y-with-arsc.apk",
        "网络权限 + a11y + **样本 arsc**（≈105，预期报毒）",
    ),
)


def shield_network_a11y(ctx: dict) -> Path:
    return ctx_get(
        ctx,
        "shield-network-a11y.apk",
        lambda: run_engine(
            [
                "--manifest-debug-mode",
                "keep_only",
                "--manifest-debug-permissions",
                NETWORK_PERMS,
            ]
        ),
    )


def finalize(base: Path, cache_name: str, *, omit_arsc: bool) -> Path:
    out = cache_path(cache_name)
    if out.is_file():
        return out
    mid = cache_path(cache_name.replace(".apk", "-mid.apk"))
    src = base
    if omit_arsc:
        run_patch(src, mid, "omit", "resources.arsc")
        src = mid
    else:
        mid = src
    run_patch(src, out, "set_label", APP_LABEL, VERSION_NAME)
    return out


def build_one(ctx: dict, variant: A11yVariant) -> Path:
    name = variant.filename
    if name.startswith("01-"):
        return finalize(shield_perm_all(ctx), "a11y-test-01.apk", omit_arsc=True)
    if name.startswith("02-"):
        return finalize(shield_perm_all(ctx), "a11y-test-02.apk", omit_arsc=False)
    if name.startswith("03-"):
        return finalize(shield_full(ctx), "a11y-test-03.apk", omit_arsc=True)
    if name.startswith("04-"):
        return finalize(shield_full(ctx), "a11y-test-04.apk", omit_arsc=False)
    if name.startswith("05-"):
        return finalize(shield_network_a11y(ctx), "a11y-test-05.apk", omit_arsc=True)
    if name.startswith("06-"):
        return finalize(shield_network_a11y(ctx), "a11y-test-06.apk", omit_arsc=False)
    raise ValueError(name)


def write_readme(rows: list[tuple[A11yVariant, Path]]) -> None:
    lines = [
        "# 无障碍 + 权限 测试包（5412ce7f 加壳）",
        "",
        "生成：`python3 build_a11y_tests.py`",
        "",
        "建议顺序：**01 → 03 → 05**（均无样本 arsc）→ 再对照 **02/04/06**（加回 arsc 看是否 alone 报毒）。",
        "",
        "| 文件 | 说明 | 大小 |",
        "|------|------|------|",
    ]
    for variant, path in rows:
        kb = path.stat().st_size // 1024 if path.is_file() else 0
        lines.append(f"| {variant.filename} | {variant.note} | {kb} KiB |")
    lines.extend(
        [
            "",
            "每步卸载 `org.helper.scannertask`。记录：报毒/正常、设置里是否出现 **无障碍**、权限列表。",
            "",
        ]
    )
    (OUT_DIR / "README.md").write_text("\n".join(lines), encoding="utf-8")


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--input", type=Path, default=INPUT)
    args = parser.parse_args()
    if not args.input.is_file():
        print(f"缺少 {args.input}", file=sys.stderr)
        return 1
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    ctx: dict = {}
    rows: list[tuple[A11yVariant, Path]] = []
    for variant in VARIANTS:
        src = build_one(ctx, variant)
        dst = OUT_DIR / variant.filename
        shutil.copy2(src, dst)
        rows.append((variant, dst))
        print(f"  {variant.filename}  {variant.note}")
    write_readme(rows)
    best = OUT_DIR / "03-fullmanifest-no-arsc.apk"
    if best.is_file():
        shutil.copy2(best, DELIVERY_ALIAS)
        print(f"\n推荐交付副本：{DELIVERY_ALIAS}  （同 03）")
    print(f"\n共 {len(rows)} 个 → {OUT_DIR}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
