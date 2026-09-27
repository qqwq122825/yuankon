#!/usr/bin/env python3
"""Read-only device diagnostics for APKShield's own Logcat tag.

Does not install/uninstall apps, launch them, clear logs, or change settings.
"""
from __future__ import annotations

import argparse
from datetime import datetime, timezone
import json
import os
from pathlib import Path
import re
import secrets
import subprocess
import sys

BASE = Path(__file__).resolve().parent
PACKAGE = re.compile(r"[A-Za-z][A-Za-z0-9_]*(?:\.[A-Za-z][A-Za-z0-9_]*)+")


def find_adb() -> Path:
    config = json.loads((BASE / "config.json").read_text(encoding="utf-8-sig"))
    if not isinstance(config, dict) or not isinstance(config.get("android_sdk", ""), str):
        raise ValueError("config.json 应为 JSON 对象，android_sdk 应为路径字符串。")
    roots = [config.get("android_sdk"), os.environ.get("ANDROID_HOME"), os.environ.get("ANDROID_SDK_ROOT"),
             str(BASE.parent / ".local-tools/android-sdk"), str(Path.home() / "Library/Android/sdk"),
             str(Path.home() / "Android/Sdk")]
    for root in filter(None, roots):
        candidate = Path(root).expanduser() / "platform-tools" / ("adb.exe" if os.name == "nt" else "adb")
        if candidate.is_file():
            return candidate
    raise ValueError("请先准备 SDK platform-tools/adb，并在 config.json 设置 android_sdk。")


def run(args: list[str | Path], allow_failure=False) -> subprocess.CompletedProcess:
    result = subprocess.run([str(arg) for arg in args], stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                            text=True, errors="replace", timeout=30)
    if result.returncode and not allow_failure:
        raise ValueError(f"ADB 读取失败（{result.returncode}）：{result.stderr.strip()}")
    return result


def main(argv=None) -> int:
    parser = argparse.ArgumentParser(description="只读采集 APKShield 自身日志，不安装/启动应用或更改手机设置。")
    parser.add_argument("--package", required=True, help="输出 APK 的安装包名")
    parser.add_argument("--serial", help="多个设备时明确指定 adb serial")
    args = parser.parse_args(argv)
    try:
        if not PACKAGE.fullmatch(args.package):
            raise ValueError("包名格式应为 com.example.app。")
        adb = find_adb()
        lines = run([adb, "devices"]).stdout.splitlines()
        devices = [line.split()[0] for line in lines if len(line.split()) >= 2 and line.split()[1] == "device"]
        if not devices:
            raise ValueError("未检测到已连接且已确认 USB 调试的 Android 设备；本次未生成设备测试结果。")
        serial = args.serial
        if serial is None:
            if len(devices) != 1:
                raise ValueError("检测到多个设备，请用 --serial 指定目标。")
            serial = devices[0]
        if serial not in devices:
            raise ValueError("指定设备不在当前可读取的设备列表。")
        prefix = [adb, "-s", serial]
        device = {}
        for key, prop in (("model", "ro.product.model"), ("android_release", "ro.build.version.release"),
                          ("android_api", "ro.build.version.sdk"), ("abi", "ro.product.cpu.abi")):
            device[key] = run(prefix + ["shell", "getprop", prop]).stdout.strip()
        pid_result = run(prefix + ["shell", "pidof", args.package], allow_failure=True)
        pids = pid_result.stdout.split()
        if any(not pid.isdecimal() for pid in pids):
            raise ValueError("设备返回的进程 ID 格式异常。")
        # Multiple PIDs are also handled independently instead of broadening the log scope.
        filters = [["--pid=" + pid] for pid in pids] or [[]]
        chunks = []
        for pid_filter in filters:
            chunks.append(run(prefix + ["logcat", "-d", "-v", "threadtime", "-t", "1200",
                                         *pid_filter, "APKShield:V", "*:S"]).stdout)
        output = BASE / "output"
        output.mkdir(exist_ok=True)
        stem = "device-" + datetime.now().strftime("%Y%m%d-%H%M%S-") + secrets.token_hex(4)
        log = output / (stem + ".log")
        fd = os.open(log, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
        with os.fdopen(fd, "w", encoding="utf-8") as stream:
            stream.write("\n".join(chunks))
        report = {"package": args.package, "device_serial": serial, "device": device, "pids": pids,
                  "log": str(log), "scope": "package-pids" if pids else "APKShield-tag-only",
                  "note": "进程未运行时，日志范围包括设备上使用 APKShield 标签的其他应用；请核对包名与时间。" if not pids else "",
                  "device_logs_collected": True, "runtime_verified": False,
                  "created_at": datetime.now(timezone.utc).isoformat()}
        report_path = log.with_suffix(".json")
        report_fd = os.open(report_path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
        with os.fdopen(report_fd, "w", encoding="utf-8") as stream:
            json.dump(report, stream, ensure_ascii=False, indent=2)
            stream.write("\n")
        print(f"已读取日志：{log}")
        if not pids:
            print(report["note"])
        print("日志收集不代表启动与功能验收通过；本工具没有更改设备或应用状态。")
        return 0
    except (OSError, ValueError, subprocess.TimeoutExpired) as exc:
        print(f"诊断未完成：{exc}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    sys.exit(main())
