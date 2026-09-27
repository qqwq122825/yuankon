#!/usr/bin/env python3
"""Offline post-build APK shell prototype, using public Android 10+ APIs.

The CLI reuses sibling apk-repack's ZIP checks, toolchain, signing and logging.
No network calls are made. Unsupported layouts fail before an APK is published.
"""
from __future__ import annotations

import argparse
import base64
import copy
from contextlib import contextmanager
from datetime import datetime, timezone
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import re
import secrets
import shutil
import struct
import subprocess
import sys
import tempfile
import time
import traceback
import xml.etree.ElementTree as ET
import zipfile
import zlib

BASE = Path(__file__).resolve().parent
CORE_PATH = BASE.parent / "apk-repack/repack.py"
spec = importlib.util.spec_from_file_location("shield_repack_core", CORE_PATH)
if not CORE_PATH.is_file() or spec is None or spec.loader is None:
    raise SystemExit("请保留同级 apk-repack/repack.py；本工具复用其签名与工具链代码。")
core = importlib.util.module_from_spec(spec)
spec.loader.exec_module(core)
# This is a separate module instance: keep shield locks/keys in its own directory.
core.BASE = BASE
Error = core.RepackError
ANDROID = "{http://schemas.android.com/apk/res/android}"
FACTORY = "local.apkshield.runtime.ShieldFactory"
PAYLOAD = "assets/apk-shield/payload.blp"
MARKER = "assets/apk-shield/build.json"
MIN_SDK = 29
MAX_BYTES = 64 * 1024 * 1024
MAX_DEX_BYTES = 32 * 1024 * 1024
MAX_DEX_COUNT = 16
DEX_RE = re.compile(r"classes(?:[2-9]|[1-9][0-9]+)?\.dex")
SUPPORTED_FACTORIES = {"", "android.app.AppComponentFactory", "androidx.core.app.CoreComponentFactory"}
COMPAT_PROFILES = frozenset({"browser", "embedded-native"})
DEFAULT_COMPAT_PROFILE = "browser"
CLASS_RE = re.compile(r"[A-Za-z_$][A-Za-z0-9_$]*(?:\.[A-Za-z_$][A-Za-z0-9_$]*)*")
CAPABILITY_ATTRS = {"canRetrieveWindowContent", "canTakeScreenshot", "canPerformGestures",
                    "canRequestFilterKeyEvents", "canRequestTouchExplorationMode",
                    "canRequestEnhancedWebAccessibility", "canControlMagnification",
                    "canRequestFingerprintGestures"}


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat()


class RunLog:
    """One JSON object per line, with bounded command output and no secret values."""

    def __init__(self, output: Path, run_id: str):
        self.run_id = run_id
        self.path = output / (run_id + ".log")
        self.stream = self.path.open("x", encoding="utf-8")
        self.path.chmod(0o600)
        self.current_stage = "initialize"
        self.stages: list[dict] = []
        self.commands: list[dict] = []
        self.secrets: set[str] = set()
        self.event("run_started")

    def redact(self, value: str) -> str:
        for secret in sorted(self.secrets, key=len, reverse=True):
            if secret:
                value = value.replace(secret, "[REDACTED]")
        value = re.sub(r"(?i)(pass:)[^\s\"']+", r"\1[REDACTED]", value)
        return value

    def register_key(self, key: bytes) -> None:
        self.secrets.update({key.hex(), base64.b64encode(key).decode(),
            ",".join(str(b if b < 128 else b - 256) for b in key)})

    def event(self, kind: str, **fields) -> None:
        record = {"time": utc_now(), "run_id": self.run_id, "stage": self.current_stage,
                  "event": kind, **fields}
        self.stream.write(self.redact(json.dumps(record, ensure_ascii=False)) + "\n")
        self.stream.flush()

    @contextmanager
    def stage(self, name: str):
        self.current_stage = name
        start = time.monotonic()
        item = {"name": name, "started_at": utc_now(), "status": "running"}
        self.stages.append(item)
        self.event("stage_started")
        try:
            yield
        except BaseException:
            item["status"] = "failed"
            raise
        else:
            item["status"] = "passed"
        finally:
            item["duration_ms"] = round((time.monotonic() - start) * 1000, 2)
            self.event("stage_finished", **item)

    def close(self) -> None:
        self.stream.close()


def run_command(command: list, env: dict, log, timeout: int = 300, log_stdout: bool = True) -> str:
    """Do not modify the sibling repacker's runner or merge stderr with stdout."""
    command = [str(arg) for arg in command]
    started = time.monotonic()
    public_command = command.copy()
    for index, argument in enumerate(command[:-1]):
        if argument in ("--ks-pass", "--key-pass", "-storepass", "-keypass"):
            if not command[index + 1].startswith("env:"):
                public_command[index + 1] = "[REDACTED]"
                if isinstance(log, RunLog):
                    log.secrets.add(command[index + 1].removeprefix("pass:"))
    if isinstance(log, RunLog) and env.get("APK_REPACK_PASSWORD") not in (None, "", "android"):
        log.secrets.add(env["APK_REPACK_PASSWORD"])
    item = {"executable": Path(command[0]).name, "argv": public_command, "timeout_seconds": timeout}
    if isinstance(log, RunLog):
        item["stage"] = log.current_stage
        log.event("command_started", **item)
    result = None
    failure = None
    try:
        result = subprocess.run(command, env=env, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                                text=True, errors="replace", timeout=timeout, check=False)
        stdout, stderr = result.stdout, result.stderr
        item["exit_code"] = result.returncode
    except subprocess.TimeoutExpired as exc:
        stdout, stderr = exc.stdout or "", exc.stderr or ""
        if isinstance(stdout, bytes):
            stdout = stdout.decode("utf-8", errors="replace")
        if isinstance(stderr, bytes):
            stderr = stderr.decode("utf-8", errors="replace")
        item.update(exit_code=None, timed_out=True)
        failure = Error(f"命令超时（{timeout} 秒）：{Path(command[0]).name}")
    except OSError as exc:
        stdout, stderr = "", str(exc)
        item.update(exit_code=None, launch_failed=True)
        failure = Error(f"命令启动失败：{Path(command[0]).name}；详情见日志。")
    item["duration_ms"] = round((time.monotonic() - started) * 1000, 2)
    # Full output is returned to parsers; only bounded sanitized diagnostics are persisted.
    for label, value in (("stdout", stdout), ("stderr", stderr)):
        item[label + "_characters"] = len(value)
        item[label + "_truncated"] = len(value) > 65536
        item[label] = value[:65536]
    if not log_stdout:
        item["stdout"] = "[omitted: decoded manifest/resource contents; see structured profile metadata]"
        item["stdout_omitted"] = True
    if isinstance(log, RunLog):
        item = json.loads(log.redact(json.dumps(item, ensure_ascii=False)))
        log.commands.append({k: v for k, v in item.items() if k not in ("stdout", "stderr")})
        log.event("command_finished", **item)
    elif log is not None:
        log.write(json.dumps(item, ensure_ascii=False) + "\n")
        log.flush()
    if failure:
        raise failure
    if result.returncode:
        raise Error(f"{Path(command[0]).name} 执行失败，退出码 {result.returncode}；详情见日志。")
    return stdout


def class_name(value: str, package: str) -> str:
    expanded = package + value if value.startswith(".") else (package + "." + value if "." not in value else value)
    if not value or not CLASS_RE.fullmatch(expanded):
        raise Error("Manifest 组件类名格式异常。")
    return expanded


def inspect_service_config(xml: str, package: str) -> dict:
    try:
        root = ET.fromstring(xml)
    except ET.ParseError as exc:
        raise Error("无障碍服务 XML 解析失败。") from exc
    if root.tag != "accessibility-service" or list(root):
        raise Error("需要单一 accessibility-service XML 根节点，且无嵌套配置。")
    allowed = CAPABILITY_ATTRS | {"description", "summary", "settingsActivity", "accessibilityEventTypes",
        "accessibilityFeedbackType", "accessibilityFlags", "notificationTimeout", "packageNames",
        "isAccessibilityTool"}
    unknown = set(root.attrib) - {ANDROID + name for name in allowed}
    if unknown:
        raise Error("无障碍服务配置含待适配属性：" + ", ".join(sorted(unknown)))
    for name in CAPABILITY_ATTRS | {"isAccessibilityTool"}:
        if root.get(ANDROID + name, "false") not in ("false", "0", "0x0"):
            raise Error(f"状态验证服务要求 {name}=false。")
    for name in ("accessibilityEventTypes", "accessibilityFlags"):
        if root.get(ANDROID + name, "0") not in ("0", "0x0", "0x00000000"):
            raise Error(f"状态验证服务要求 {name}=0。")
    feedback = root.get(ANDROID + "accessibilityFeedbackType", "0")
    if feedback not in ("0", "0x0", "16", "0x10", "feedbackGeneric"):
        raise Error("状态验证服务只适配默认反馈或 feedbackGeneric。")
    package_names = root.get(ANDROID + "packageNames")
    if package_names is not None and package_names != package:
        raise Error("服务 packageNames 仅适配当前应用包名。")
    settings = root.get(ANDROID + "settingsActivity")
    if settings is not None:
        class_name(settings, package)
    timeout = root.get(ANDROID + "notificationTimeout", "0")
    if not re.fullmatch(r"[0-9]+", timeout):
        raise Error("服务 notificationTimeout 应为非负整数。")
    return {"event_types": 0, "event_types_defaulted": ANDROID + "accessibilityEventTypes" not in root.attrib,
            "flags": 0, "capabilities": {name: False for name in sorted(CAPABILITY_ATTRS)},
            "static_declaration_only": True}


def inspect_services(app: ET.Element, package: str, configs: dict | None) -> list[dict]:
    result = []
    for service in app.findall("service"):
        allowed = {ANDROID + name for name in ("name", "label", "description", "exported", "permission", "enabled")}
        if set(service.attrib) - allowed:
            raise Error("无障碍状态服务含待适配的 Manifest 属性。")
        name = class_name(service.get(ANDROID + "name", ""), package)
        if service.get(ANDROID + "permission") != "android.permission.BIND_ACCESSIBILITY_SERVICE":
            raise Error("仅适配绑定 BIND_ACCESSIBILITY_SERVICE 的无障碍状态服务，其他服务待适配。")
        if service.get(ANDROID + "exported") != "true" or service.get(ANDROID + "enabled", "true") not in ("true", "false"):
            raise Error("无障碍状态服务要求 exported=true，enabled 为布尔值。")
        intents, metadata = service.findall("intent-filter"), service.findall("meta-data")
        if len(intents) != 1 or len(metadata) != 1 or len(service) != 2:
            raise Error("状态服务需要唯一的 intent-filter 与无障碍 meta-data。")
        actions = intents[0].findall("action")
        if (len(actions) != 1 or len(intents[0]) != 1 or intents[0].attrib
                or actions[0].attrib != {ANDROID + "name": "android.accessibilityservice.AccessibilityService"}):
            raise Error("状态服务只适配 AccessibilityService action。")
        resource = metadata[0].get(ANDROID + "resource", "")
        if (metadata[0].get(ANDROID + "name") != "android.accessibilityservice"
                or set(metadata[0].attrib) != {ANDROID + "name", ANDROID + "resource"}):
            raise Error("缺少明确的 android.accessibilityservice XML 资源引用。")
        if not re.fullmatch(r"@(?:xml/[A-Za-z0-9_]+|(?:ref/)?0x[0-9a-fA-F]+)", resource):
            raise Error("无障碍服务 XML 资源引用形式待适配。")
        if configs is None or resource not in configs:
            raise Error(f"缺少已解码的无障碍服务 XML：{resource}")
        variants = configs[resource] if isinstance(configs[resource], list) else [configs[resource]]
        if not variants:
            raise Error("无障碍服务 XML 资源没有可验证的配置变体。")
        checks = [inspect_service_config(xml, package) for xml in variants]
        result.append({"name": name, "resource": resource, "variant_count": len(checks),
                       "configurations": checks, "automatic_activation": False,
                       "scope": "static status-only declaration; runtime changes are not verified"})
    return result


def validate_dex(data: bytes) -> None:
    if (len(data) < 112 or len(data) > MAX_DEX_BYTES or data[:4] != b"dex\n"
            or data[4:8] not in (b"035\0", b"037\0", b"038\0", b"039\0")):
        raise Error("DEX 头或版本超出原型范围（035/037/038/039）。")
    if struct.unpack_from("<III", data, 32) != (len(data), 112, 0x12345678):
        raise Error("DEX 文件长度、头长度或字节序异常。")
    if data[12:32] != hashlib.sha1(data[32:]).digest():
        raise Error("DEX SHA-1 校验异常。")
    if struct.unpack_from("<I", data, 8)[0] != zlib.adler32(data[12:]):
        raise Error("DEX Adler32 校验异常。")


def dex_names(archive: zipfile.ZipFile) -> list[str]:
    names = [name for name in archive.namelist() if DEX_RE.fullmatch(name)]
    names.sort(key=lambda name: 1 if name == "classes.dex" else int(name[7:-4]))
    expected = ["classes.dex"] + [f"classes{i}.dex" for i in range(2, len(names) + 1)]
    if not names or len(names) > MAX_DEX_COUNT or names != expected:
        raise Error("需要连续的 classes.dex、classes2.dex…，最多 16 个。")
    if any(name.endswith(".dex") and name not in names for name in archive.namelist()):
        raise Error("存在非根目录或非标准命名的 DEX，当前原型暂不支持。")
    total = 0
    for name in names:
        size = archive.getinfo(name).file_size
        total += size
        if size > MAX_DEX_BYTES or total > MAX_BYTES - 65536:
            raise Error("DEX 体积超过原型上限：单文件 32 MiB，总计接近 64 MiB。")
        validate_dex(archive.read(name))
    return names


def integer_attr(element: ET.Element, name: str, default: int) -> int:
    value = element.get(ANDROID + name, str(default))
    if not re.fullmatch(r"[0-9]+", value):
        raise Error(f"{name} 应为十进制整数，当前值：{value}")
    return int(value)


def blocked_zip_entry(name: str, profile: str) -> bool:
    if name.startswith("assets/apk-shield/"):
        return False
    if name.endswith((".apk", ".jar")):
        return True
    if profile == "embedded-native":
        return name.endswith(".so") and not name.startswith("lib/")
    return name.startswith("lib/") or name.endswith((".so", ".apk", ".jar"))


def inspect_manifest(xml: str, entries: list[str], allow_raise: bool, service_configs: dict | None = None,
                     profile: str = DEFAULT_COMPAT_PROFILE) -> dict:
    if profile not in COMPAT_PROFILES:
        raise Error(f"未知 compatibility_profile：{profile}")
    embedded_native = profile == "embedded-native"
    try:
        root = ET.fromstring(xml)
    except ET.ParseError as exc:
        raise Error("Manifest XML 解析失败。") from exc
    if root.tag != "manifest" or len(root.findall("application")) != 1:
        raise Error("需要单个 application 的 Android Manifest。")
    package = root.get("package", "")
    if not core.PACKAGE_RE.fullmatch(package):
        raise Error("安装包名格式异常。")
    if ("split" in root.attrib or root.get(ANDROID + "sharedUserId")
            or root.find("uses-split") is not None
            or any("split" in key.lower() for key in root.attrib)
            or root.find("instrumentation") is not None):
        raise Error("暂不支持 split、共享 UID 或 instrumentation APK。")
    sdk = root.find("uses-sdk")
    if sdk is None:
        raise Error("Manifest 缺少 uses-sdk。")
    minimum, target = integer_attr(sdk, "minSdkVersion", 1), integer_attr(sdk, "targetSdkVersion", 1)
    if target < MIN_SDK:
        raise Error("原型要求 targetSdkVersion 至少为 29，保留输入值。")
    if minimum < MIN_SDK and not allow_raise:
        raise Error(f"当前 minSdk={minimum}；本原型需要 Android 10+。确认后用 --allow-min-sdk-raise 提升输出最低版本。")
    if ANDROID + "maxSdkVersion" in sdk.attrib:
        raise Error("带 maxSdkVersion 的 APK 暂不支持。")
    app = root.find("application")
    assert app is not None
    original_application = app.get(ANDROID + "name")
    original_application = class_name(original_application, package) if original_application is not None else ""
    original_factory = app.get(ANDROID + "appComponentFactory")
    original_factory = class_name(original_factory, package) if original_factory is not None else ""
    if original_factory not in SUPPORTED_FACTORIES:
        raise Error(f"自定义 appComponentFactory 待适配：{original_factory}")
    for name in ("classLoader", "backupAgent", "zygotePreloadName",
                 "manageSpaceActivity", "process", "isSplitRequired", "hasCode", "useEmbeddedDex",
                 "isolatedSplits", "extractNativeLibs"):
        value = app.get(ANDROID + name)
        if name == "extractNativeLibs":
            continue  # No native libraries are admitted below; preserve this flag unchanged.
        if name == "hasCode" and value in (None, "true"):
            continue
        if value is not None:
            raise Error(f"当前原型暂不支持 application 的 {name} 属性。")
    if app.get(ANDROID + "debuggable", "false") != "false":
        raise Error("请使用非 debuggable 的 Release APK。")
    if not embedded_native and any(app.find(tag) is not None
                                   for tag in ("receiver", "provider", "uses-library", "uses-native-library")):
        raise Error("接收器、Provider 和共享库待适配。")
    permissions = sorted({node.get(ANDROID + "name", "") for node in root
                          if node.tag.startswith("uses-permission")})
    if not embedded_native and set(permissions) - {"android.permission.INTERNET"}:
        raise Error("首版浏览器配置只接受 INTERNET 权限，输入权限集合超出范围。")
    if not embedded_native and root.find("permission") is not None:
        raise Error("自定义权限应用待适配。")
    accessibility_services = [] if embedded_native else inspect_services(app, package, service_configs)
    if not embedded_native:
        for node in root.iter():
            if any(key in node.attrib for key in (ANDROID + "process", ANDROID + "classLoader", ANDROID + "splitName")):
                raise Error("多进程或组件自定义类加载配置待适配。")
    activities = app.findall("activity")
    if not activities:
        raise Error("原型需要一个可见的启动 Activity。")
    launchable = False
    for component in activities + app.findall("activity-alias"):
        for intent in component.findall("intent-filter"):
            actions = {n.get(ANDROID + "name") for n in intent.findall("action")}
            categories = {n.get(ANDROID + "name") for n in intent.findall("category")}
            if "android.intent.action.MAIN" not in actions:
                continue
            if embedded_native or "android.intent.category.LAUNCHER" in categories:
                launchable = True
    if not launchable:
        raise Error("缺少 MAIN/LAUNCHER 启动入口。" if not embedded_native else "缺少带 MAIN action 的 Activity 或 alias 入口。")
    if any(blocked_zip_entry(name, profile) for name in entries):
        raise Error("原生库、嵌套 APK/JAR 和动态插件应用待适配。" if not embedded_native
                    else "嵌套 APK/JAR 或非 lib/ 下的 .so 暂不支持。")
    if any(name.startswith("assets/apk-shield/") for name in entries):
        raise Error("已存在本引擎产物标记，请使用原始 APK，避免重复加壳。")
    return {"package_name": package, "version_name": root.get(ANDROID + "versionName", ""),
            "version_code": integer_attr(root, "versionCode", 0), "min_sdk_before": minimum,
            "min_sdk_after": max(minimum, MIN_SDK), "target_sdk": target, "permissions": permissions,
            "original_application": original_application, "original_factory": original_factory,
            "accessibility_services": accessibility_services, "compatibility_profile": profile,
            "profile": profile if embedded_native else (
                "status-accessibility" if accessibility_services else "visible-activity")}


def resource_xml_paths(table: str, references: set[str], entries: list[str]) -> dict[str, list[str]]:
    """Resolve every resource configuration, rejecting aliases or opaque mappings."""
    resources: dict[str, dict] = {}
    names: dict[str, str] = {}
    current = None
    for line in table.splitlines():
        match = re.search(r"^\s+resource (0x[0-9a-fA-F]+) \S+:xml/([A-Za-z0-9_]+):\s+t=(0x[0-9a-fA-F]+)", line)
        if match:
            current = "@0x" + format(int(match[1], 16), "x")
            item = resources.setdefault(current, {"count": 0, "paths": [], "indirect": False})
            item["count"] += 1
            item["indirect"] |= int(match[3], 16) != 3
            named = "@xml/" + match[2]
            if named in names and names[named] != current:
                raise Error("XML 资源表出现重名映射。")
            names[named] = current
        elif re.match(r"\s+(?:resource |config |Package |type )", line):
            current = None
        elif current and re.match(r"\s+\(string(?:8|16)?\) ", line):
            quoted = line[line.index('"'):]
            try:
                path = json.loads(quoted)
            except (ValueError, TypeError) as exc:
                raise Error("XML 资源路径解码失败。") from exc
            resources[current]["paths"].append(path)
    resolved = {}
    for reference in references:
        numeric = reference.replace("@ref/", "@")
        if re.fullmatch(r"@0x[0-9a-fA-F]+", numeric):
            numeric = "@0x" + format(int(numeric[1:], 16), "x")
        key = names.get(reference, numeric)
        item = resources.get(key)
        if not item or item["indirect"] or len(item["paths"]) != item["count"]:
            raise Error(f"XML 资源存在未解析变体或引用别名：{reference}")
        paths = sorted(set(item["paths"]))
        if not paths or len(paths) > 32:
            raise Error("无障碍 XML 资源配置变体数量超出范围。")
        if any(not isinstance(path, str) or not path.startswith("res/") or not path.endswith(".xml")
               or "\\" in path or any(part in ("", ".", "..") for part in path.split("/"))
               or path not in entries for path in paths):
            raise Error(f"XML 资源引用不是 APK 内已有的 res 资源文件：{reference}")
        resolved[reference] = paths
    return resolved


def load_service_configs(xml: str, entries: list[str], apk: Path, tools: dict, env: dict, log) -> dict:
    root = ET.fromstring(xml)
    references = {item.get(ANDROID + "resource", "") for item in root.findall("application/service/meta-data")
                  if item.get(ANDROID + "name") == "android.accessibilityservice"}
    if not references:
        return {}
    if len(references) > 16:
        raise Error("无障碍服务 XML 资源数量超出范围。")
    table = run_command([tools["aapt"], "dump", "--values", "resources", apk], env, log, log_stdout=False)
    paths = resource_xml_paths(table, references, entries)
    decoded = {}
    for reference, variants in paths.items():
        decoded[reference] = [run_command([tools["analyzer"], "resources", "xml", "--file", path, apk], env, log, log_stdout=False)
                              for path in variants]
    if isinstance(log, RunLog):
        log.event("service_resources_resolved", resources=paths)
    return decoded


def canonical(element: ET.Element):
    return (element.tag, tuple(sorted(element.attrib.items())), tuple(canonical(child) for child in element))


def _permission_tag(tag: str) -> bool:
    local = tag.rsplit("}", 1)[-1]
    return local in ("uses-permission", "uses-permission-sdk-23")


def permission_debug_policy(mode: str, permissions: list[str], remove_declarations: bool,
                            strip_accessibility: bool = False) -> dict:
    allowed = {"keep_only", "remove_list", "remove_all"}
    if mode not in allowed:
        raise Error(f"manifest_debug.mode 应为 {', '.join(sorted(allowed))} 之一。")
    cleaned = sorted({name for name in permissions if name})
    return {"mode": mode, "permissions": cleaned, "remove_permission_declarations": remove_declarations,
            "strip_accessibility_services": strip_accessibility}


def apply_accessibility_service_strip(app: ET.Element) -> list[str]:
    removed = []
    bind = "android.permission.BIND_ACCESSIBILITY_SERVICE"
    for service in list(app.findall("service")):
        name = service.get(ANDROID + "name", "")
        drop = service.get(ANDROID + "permission") == bind
        if not drop:
            for metadata in service.findall("meta-data"):
                if metadata.get(ANDROID + "name") == "android.accessibilityservice":
                    drop = True
                    break
        if drop:
            removed.append(name)
            app.remove(service)
    return removed


def resolve_manifest_debug(config: dict, apk: Path, cli: dict | None = None) -> dict | None:
    cli = cli or {}
    if cli.get("disabled"):
        return None
    block = config.get("manifest_debug") if isinstance(config.get("manifest_debug"), dict) else {}
    needle = str(block.get("input_contains", ""))
    strip = bool(cli.get("strip_accessibility_services"))
    if cli.get("mode") or strip:
        mode = cli.get("mode") or "remove_all"
        return permission_debug_policy(mode, cli.get("permissions", []),
                                       cli.get("remove_permission_declarations", True), strip)
    if not block.get("enabled", False):
        return None
    if needle and needle not in apk.name:
        return None
    strip = strip or bool(block.get("strip_accessibility_services", False))
    return permission_debug_policy(str(block.get("mode", "remove_all")),
                                   block.get("permissions") if isinstance(block.get("permissions"), list) else [],
                                   bool(block.get("remove_permission_declarations", True)), strip)


def apply_manifest_debug(root: ET.Element, policy: dict) -> dict:
    mode, keep = policy["mode"], set(policy["permissions"])
    removed, kept = [], []
    for node in list(root):
        if _permission_tag(node.tag):
            name = node.get(ANDROID + "name", "")
            drop = ((mode == "remove_all")
                    or (mode == "keep_only" and name not in keep)
                    or (mode == "remove_list" and name in keep))
            if drop:
                removed.append(name)
                root.remove(node)
            else:
                kept.append(name)
        elif policy.get("remove_permission_declarations") and node.tag.rsplit("}", 1)[-1] == "permission":
            removed.append(node.get(ANDROID + "name", ""))
            root.remove(node)
    services_removed: list[str] = []
    if policy.get("strip_accessibility_services"):
        app = root.find("application")
        if app is not None:
            services_removed = apply_accessibility_service_strip(app)
    return {"removed": removed, "kept": sorted(set(kept)), "accessibility_services_removed": services_removed}


def assert_manifest_has_no_empty_permission_nodes(xml: str) -> None:
    root = ET.fromstring(xml)
    for node in root.iter():
        local = node.tag.rsplit("}", 1)[-1]
        if local in ("uses-permission", "uses-permission-sdk-23", "permission"):
            if not node.get(ANDROID + "name"):
                raise Error(f"Manifest 含无 android:name 的空节点：<{local}/>。")


def manifest_permission_names(root: ET.Element) -> set[str]:
    names = set()
    for node in root.iter():
        if _permission_tag(node.tag):
            name = node.get(ANDROID + "name")
            if name:
                names.add(name)
        elif node.tag.rsplit("}", 1)[-1] == "permission":
            name = node.get(ANDROID + "name")
            if name:
                names.add(name)
    return names


def verify_manifest(before: str, after: str, min_sdk: int, debug_policy: dict | None = None) -> None:
    expected = ET.fromstring(before)
    if debug_policy:
        apply_manifest_debug(expected, debug_policy)
    expected.find("application").set(ANDROID + "appComponentFactory", FACTORY)
    expected.find("uses-sdk").set(ANDROID + "minSdkVersion", str(min_sdk))
    actual = ET.fromstring(after)
    expected_app = expected.find("application")
    actual_app = actual.find("application")
    if (expected_app is None or actual_app is None
            or expected_app.get(ANDROID + "appComponentFactory") != FACTORY
            or actual_app.get(ANDROID + "appComponentFactory") != FACTORY):
        raise Error("Manifest 的 appComponentFactory 校验失败。")
    expected_sdk = expected.find("uses-sdk")
    actual_sdk = actual.find("uses-sdk")
    if (expected_sdk is None or actual_sdk is None
            or expected_sdk.get(ANDROID + "minSdkVersion") != str(min_sdk)
            or actual_sdk.get(ANDROID + "minSdkVersion") != str(min_sdk)):
        raise Error("Manifest 的 minSdkVersion 校验失败。")
    if debug_policy:
        if manifest_permission_names(expected) != manifest_permission_names(actual):
            still = sorted(manifest_permission_names(actual) - manifest_permission_names(expected))
            raise Error(f"Manifest 权限调试后集合不一致；安装包中仍保留 {still[:12]}。")
        return
    if canonical(expected) != canonical(actual):
        raise Error("Manifest 差异超出 appComponentFactory / minSdkVersion 两项。")


def resolve_tools(config: dict) -> tuple[dict, dict]:
    tools, env = core.toolchain(config)
    sdk = tools["aapt"].parents[2]
    tools["android_jar"] = sdk / "platforms/android-35/android.jar"
    tools["d8"] = tools["aapt"].parent / "lib/d8.jar"
    tools["analyzer"] = sdk / "cmdline-tools/latest/bin/apkanalyzer"
    candidates = [BASE / ".tools/ManifestEditor-2.0.jar",
                  BASE.parent / "apk-repack/.tools/ManifestEditor-2.0.jar"]
    editor = next((p for p in candidates if p.is_file()), None)
    if editor is None:
        raise Error("请先准备 ManifestEditor 2.0 JAR（见 README）；处理过程不联网下载。")
    if core.sha256(editor) != core.MANIFEST_EDITOR_SHA256:
        raise Error("ManifestEditor JAR 的固定 SHA-256 校验失败。")
    tools["editor"] = editor
    for name in ("android_jar", "d8", "analyzer"):
        if not tools[name].is_file():
            raise Error(f"缺少本地工具 {name}：{tools[name]}")
    return tools, env


def compile_helpers(tools: dict, env: dict, work: Path, log) -> Path:
    dest = work / "host-classes"
    dest.mkdir()
    sources = [BASE / "java/ShieldManifest.java", BASE / "java/ManifestPermissionStrip.java",
               BASE / "java/ManifestServiceStrip.java", BASE / "java/ManifestQueriesStrip.java",
               BASE / "java/ManifestApplicationPatch.java", BASE / "java/PayloadTool.java",
               BASE / "java/local/apkshield/runtime/PayloadCodec.java"]
    run_command([tools["javac"], "-encoding", "UTF-8", "-cp", tools["editor"], "-d", dest, *sources], env, log)
    return dest


def build_shell(tools: dict, env: dict, work: Path, key: bytes, log, info: dict | None = None) -> Path:
    if isinstance(log, RunLog):
        log.register_key(key)
    sources = work / "generated"
    classes, dex = work / "shell-classes", work / "shell-dex"
    for folder in (sources, classes, dex):
        folder.mkdir()
    key_source = sources / "PayloadConfig.java"
    values = ",".join(str(b if b < 128 else b - 256) for b in key)
    original_factory = (info or {}).get("original_factory", "")
    if original_factory not in SUPPORTED_FACTORIES:
        raise Error("启动代码的 original_factory 超出适配集合。")
    if original_factory == "android.app.AppComponentFactory":
        original_factory = ""
    key_source.write_text("package local.apkshield.runtime;\n"
                          "final class PayloadConfig {\n"
                          "  static byte[] key() { return new byte[]{" + values + "}; }\n"
                          "  static String originalFactory() { return " + json.dumps(original_factory) + "; }\n}\n",
                          encoding="utf-8")
    runtime = BASE / "java/local/apkshield/runtime"
    run_command([tools["javac"], "-encoding", "UTF-8", "-source", "8", "-target", "8", "-Xlint:-options",
              "-classpath", tools["android_jar"], "-d", classes, runtime / "PayloadCodec.java",
              runtime / "ShieldFactory.java", key_source], env, log)
    run_command([tools["java"], "-cp", tools["d8"], "com.android.tools.r8.D8", "--release",
              "--min-api", MIN_SDK, "--lib", tools["android_jar"], "--output", dex,
              *sorted(classes.rglob("*.class"))], env, log)
    result = dex / "classes.dex"
    validate_dex(result.read_bytes())
    if len(list(dex.glob("*.dex"))) != 1:
        raise Error("引擎启动代码生成了多个 DEX，超出当前设计。")
    return result


def rewrite_archive(source: Path, output: Path, manifest: Path, shell: Path,
                    payload: Path, names: list[str]) -> None:
    with zipfile.ZipFile(source) as src, zipfile.ZipFile(output, "x") as dest:
        for info in src.infolist():
            if info.filename in names or core.is_v1_signature(info.filename):
                continue
            cloned = copy.copy(info)
            cloned.extra, cloned.flag_bits = b"", 0
            if info.filename == "AndroidManifest.xml":
                dest.writestr(cloned, manifest.read_bytes())
            else:
                with src.open(info) as incoming, dest.open(cloned, "w") as outgoing:
                    shutil.copyfileobj(incoming, outgoing, 1024 * 1024)
        dest.write(shell, "classes.dex", compress_type=zipfile.ZIP_STORED)
        dest.write(payload, PAYLOAD, compress_type=zipfile.ZIP_STORED)
        dest.writestr(MARKER, json.dumps({"engine": "apk-shield", "version": "0.1.0",
                                       "experimental": True, "minimum_android_api": MIN_SDK}))


def verify_entries(original: Path, output: Path, names: list[str], manifest: Path,
                   shell: Path, payload: Path) -> int:
    before, after = core.payload_hashes(original), core.payload_hashes(output)
    for name in names:
        before.pop(name)
    expected = dict(before)
    expected.update({"classes.dex": core.sha256(shell), PAYLOAD: core.sha256(payload),
                     MARKER: hashlib.sha256(json.dumps({"engine": "apk-shield", "version": "0.1.0",
                         "experimental": True, "minimum_android_api": MIN_SDK}).encode()).hexdigest()})
    if expected != after:
        raise Error("原始资源保持校验或加壳载荷校验异常。")
    with zipfile.ZipFile(output) as apk:
        if apk.read("AndroidManifest.xml") != manifest.read_bytes():
            raise Error("最终 Manifest 字节校验异常。")
    return len(before)


def ensure_keystore(tools: dict, env: dict, log) -> Path:
    # Same persistent certificate format as apk-repack, with the local diagnostic runner.
    path = BASE / ".private/development.p12"
    if not path.is_file():
        run_command([tools["keytool"], "-genkeypair", "-keystore", path, "-storetype", "PKCS12",
            "-storepass:env", "APK_REPACK_PASSWORD", "-keypass:env", "APK_REPACK_PASSWORD",
            "-alias", "apk-repack", "-keyalg", "RSA", "-keysize", "2048", "-validity", "10000",
            "-dname", "CN=APK Repack Development,O=Local Development,C=US"], env, log)
        path.chmod(0o600)
    return path


def write_json_exclusive(path: Path, data: dict) -> None:
    with os.fdopen(os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600), "w", encoding="utf-8") as stream:
        json.dump(data, stream, ensure_ascii=False, indent=2)
        stream.write("\n")


def report_failure(report: dict, exc: BaseException, log: RunLog, output: Path) -> Path:
    log.event("run_failed", error_type=type(exc).__name__, reason=str(exc))
    private = BASE / ".private/logs"
    private.mkdir(parents=True, mode=0o700, exist_ok=True)
    trace = private / (log.run_id + ".traceback.log")
    with os.fdopen(os.open(trace, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600), "w", encoding="utf-8") as stream:
        stream.write(log.redact(traceback.format_exc()))
    compatibility = report.setdefault("compatibility", {"structurally_supported": None, "reasons": []})
    if log.current_stage in ("input_validation", "manifest_decode", "service_resources", "compatibility", "dex_validation"):
        compatibility["structurally_supported"] = False
        compatibility["reasons"].append(str(exc))
    report.update(status="failed", current_stage=log.current_stage,
        failure={"type": type(exc).__name__, "reason": str(exc)},
        private_traceback=str(trace), log=str(log.path), stages=log.stages, commands=log.commands,
        runtime_tested=False, finished_at=utc_now())
    result = output / (log.run_id + ".failure.json")
    write_json_exclusive(result, json.loads(log.redact(json.dumps(report, ensure_ascii=False))))
    return result


def process(apk: Path, config: dict, tools: dict | None, env: dict | None, output: Path, check_only: bool,
            cli_debug: dict | None = None) -> Path:
    token = datetime.now().strftime("%Y%m%d-%H%M%S-") + secrets.token_hex(4)
    output.mkdir(parents=True, exist_ok=True)
    (BASE / ".private").mkdir(mode=0o700, exist_ok=True)
    log = RunLog(output, token)
    report = {"run_id": token, "engine_version": "0.1.0", "experimental": True,
        "input": str(apk), "input_sha256": None, "mode": "check" if check_only else "build",
        "runtime_tested": False, "created_at": utc_now(), "platform": sys.platform,
        "python_version": sys.version.split()[0], "log": str(log.path),
        "compatibility": {"structurally_supported": None, "reasons": []}}
    try:
        with tempfile.TemporaryDirectory(prefix=".work-", dir=BASE / ".private") as folder:
            work = Path(folder)
            original = work / "input.apk"
            with log.stage("input_validation"):
                if apk.is_file():
                    stat = apk.stat()
                    report["input_identity"] = {"size_bytes": stat.st_size, "mtime_ns": stat.st_mtime_ns}
                    if stat.st_size <= 512 * 1024 * 1024:
                        report["input_sha256"] = core.sha256(apk)
                core.validate_apk(apk)
                shutil.copy2(apk, original)
                core.validate_apk(original)
                if core.sha256(original) != report["input_sha256"]:
                    raise Error("输入文件在创建处理快照时变化，请停止其他修改后重试。")
                with zipfile.ZipFile(original) as src:
                    if src.getinfo("AndroidManifest.xml").file_size > 2 * 1024 * 1024:
                        raise Error("AndroidManifest.xml 超过 2 MiB 预检上限。")
                    entries = src.namelist()
                log.event("input_snapshot", input=str(apk), sha256=report["input_sha256"],
                          size_bytes=original.stat().st_size, entry_count=len(entries))
            with log.stage("toolchain"):
                if tools is None or env is None:
                    tools, env = resolve_tools(config)
                log.event("toolchain_resolved", paths={name: str(path) for name, path in tools.items()})
            with log.stage("manifest_decode"):
                xml = run_command([tools["analyzer"], "manifest", "print", original], env, log, log_stdout=False)
                decoded_root = ET.fromstring(xml)
                decoded_app = decoded_root.find("application")
                decoded_sdk = decoded_root.find("uses-sdk")
                summary = {"package_name": decoded_root.get("package", ""),
                    "version_code": decoded_root.get(ANDROID + "versionCode", ""),
                    "version_name": decoded_root.get(ANDROID + "versionName", ""),
                    "permissions": sorted({node.get(ANDROID + "name", "") for node in decoded_root
                                           if node.tag.startswith("uses-permission")})}
                if decoded_app is not None:
                    summary.update(application_class=decoded_app.get(ANDROID + "name", ""),
                        original_factory=decoded_app.get(ANDROID + "appComponentFactory", ""),
                        components={tag: len(decoded_app.findall(tag)) for tag in
                                    ("activity", "activity-alias", "service", "receiver", "provider")})
                if decoded_sdk is not None:
                    summary.update(min_sdk=decoded_sdk.get(ANDROID + "minSdkVersion", "1"),
                                   target_sdk=decoded_sdk.get(ANDROID + "targetSdkVersion", "1"))
                report["input_manifest_summary"] = summary
                log.event("input_manifest_summary", **summary)
            profile = config.get("compatibility_profile", DEFAULT_COMPAT_PROFILE)
            with log.stage("service_resources"):
                configs = ({} if profile == "embedded-native"
                           else load_service_configs(xml, entries, original, tools, env, log))
            with log.stage("compatibility"):
                info = inspect_manifest(xml, entries, config.get("allow_min_sdk_raise", False), configs, profile)
                report.update(info)
                log.event("manifest_profile", **info)
            with log.stage("dex_validation"):
                with zipfile.ZipFile(original) as src:
                    names = dex_names(src)
                    # Detect collisions, never rewrite arbitrary original classes.
                    if any(b"Llocal/apkshield/runtime/" in src.read(name) for name in names):
                        raise Error("输入代码与引擎命名空间冲突。")
                    input_manifest = work / "manifest.axml"
                    input_manifest.write_bytes(src.read("AndroidManifest.xml"))
                report["dex_files"] = names
                report["structurally_supported"] = True
                reasons = ["standalone APK with retained visible launcher", "standard contiguous DEX files",
                           "supported original application/factory configuration"]
                if profile == "embedded-native":
                    reasons.extend(["embedded-native profile: JNI libraries and manifest components preserved",
                                    "accessibility and permission profiles are not statically restricted"])
                else:
                    reasons.extend(["INTERNET-only permission profile"])
                report["compatibility"] = {"structurally_supported": True, "reasons": reasons, "static_only": True,
                                           "compatibility_profile": profile}
                if info["accessibility_services"]:
                    report["compatibility"]["reasons"].append(
                        "status-only service XML declarations verified in every resource variant")
                report["warnings"] = ["Static declaration checks do not prove or constrain runtime service behavior.",
                    "Device startup and lifecycle compatibility require separate Android device tests.",
                    "The embedded decrypt key remains recoverable; this is not an absolute anti-modification boundary."]
                if info["min_sdk_before"] != info["min_sdk_after"]:
                    report["warnings"].append("Output minimum Android API is raised to 29 by explicit option.")
                log.event("compatibility_passed", **report["compatibility"], dex_files=names)
            if check_only:
                report.update(status="checked", current_stage="complete", stages=log.stages,
                              commands=log.commands, finished_at=utc_now())
                result = output / (token + ".check.json")
                write_json_exclusive(result, report)
                log.current_stage = "complete"
                log.event("run_completed", report=str(result), apk_created=False)
                return result
            with log.stage("compile_helpers"):
                helpers = compile_helpers(tools, env, work, log)
                java = [tools["java"], "-cp", str(helpers) + os.pathsep + str(tools["editor"])]
            with log.stage("payload_build"):
                plain = work / "payload.zip"
                with zipfile.ZipFile(original) as src, zipfile.ZipFile(plain, "x", compression=zipfile.ZIP_STORED) as data:
                    for name in names:
                        data.writestr(name, src.read(name))
                key = secrets.token_bytes(32)
                log.register_key(key)
                key_file = work / "payload.key"
                key_file.write_bytes(key)
                key_file.chmod(0o600)
                payload = work / "payload.blp"
                run_command(java + ["PayloadTool", "encrypt", key_file, plain, payload], env, log)
            with log.stage("shell_build"):
                shell = build_shell(tools, env, work, key, log, info)
            manifest_debug = resolve_manifest_debug(config, apk, cli_debug)
            with log.stage("manifest_patch"):
                manifest = work / "manifest-shield.axml"
                run_command(java + ["ShieldManifest", input_manifest, manifest, FACTORY, info["min_sdk_after"]], env, log)
                if manifest_debug:
                    policy_file = work / "permission-strip.json"
                    policy_file.write_text(json.dumps({
                        "mode": manifest_debug["mode"],
                        "permissions": manifest_debug["permissions"],
                        "remove_permission_declarations": manifest_debug["remove_permission_declarations"],
                    }, ensure_ascii=False), encoding="utf-8")
                    stripped = work / "manifest-permdebug.axml"
                    run_command(java + ["ManifestPermissionStrip", manifest, stripped, policy_file], env, log)
                    manifest = stripped
                    if manifest_debug.get("strip_accessibility_services"):
                        service_policy = work / "service-strip.json"
                        service_policy.write_text(json.dumps({"remove_accessibility_binding_services": True},
                                                             ensure_ascii=False), encoding="utf-8")
                        stripped_services = work / "manifest-svcdebug.axml"
                        run_command(java + ["ManifestServiceStrip", manifest, stripped_services, service_policy],
                                    env, log)
                        manifest = stripped_services
                    debug_summary = apply_manifest_debug(ET.fromstring(xml), manifest_debug)
                    report["manifest_debug"] = {**manifest_debug, **debug_summary,
                        "warning": "剥离权限仅用于安装扫描对比；运行时可能因缺权限崩溃。"}
                    log.event("manifest_debug_applied", **report["manifest_debug"])
            unsigned, aligned, signed = (work / f"{name}.apk" for name in ("unsigned", "aligned", "signed"))
            with log.stage("archive_rewrite"):
                rewrite_archive(original, unsigned, manifest, shell, payload, names)
            with log.stage("alignment"):
                run_command([tools["zipalign"], "-P", "16", "4", unsigned, aligned], env, log)
            with log.stage("signing"):
                keystore = ensure_keystore(tools, env, log)
                signer = [tools["java"], "-jar", tools["apksigner"]]
                run_command(signer + ["sign", "--ks", keystore, "--ks-key-alias", "apk-repack", "--ks-pass",
                    "env:APK_REPACK_PASSWORD", "--key-pass", "env:APK_REPACK_PASSWORD",
                    "--v4-signing-enabled", "false", "--out", signed, aligned], env, log)
            with log.stage("signature_verification"):
                run_command(signer + ["verify", "--verbose", "--print-certs", signed], env, log)
                report["signature_verified"] = True
            with log.stage("alignment_verification"):
                run_command([tools["zipalign"], "-c", "-P", "16", "4", signed], env, log)
                report["alignment_verified"] = True
            with log.stage("manifest_verification"):
                final_xml = run_command([tools["analyzer"], "manifest", "print", signed], env, log, log_stdout=False)
                if manifest_debug:
                    assert_manifest_has_no_empty_permission_nodes(final_xml)
                verify_manifest(xml, final_xml, info["min_sdk_after"], manifest_debug)
                report["manifest_verified"] = True
            with log.stage("resource_verification"):
                report["preserved_entries"] = verify_entries(original, signed, names, manifest, shell, payload)
            with log.stage("payload_roundtrip"):
                final_payload = work / "final-payload.blp"
                with zipfile.ZipFile(signed) as result_apk:
                    final_payload.write_bytes(result_apk.read(PAYLOAD))
                run_command(java + ["PayloadTool", "verify", key_file, plain, final_payload], env, log)
                report["dex_roundtrip_verified"] = True
            suffix = "-permdebug" if manifest_debug else ""
            result = output / f"{info['package_name']}-{info['version_code']}-shield{suffix}-{token}.apk"
            report.update(output=str(result), sha256=core.sha256(signed), size_bytes=signed.stat().st_size,
                signing="separate local development certificate",
                limitations=["embedded decrypt key is recoverable", "no split APK support",
                             "embedded-native profile does not statically audit permissions or accessibility XML",
                             "no Android device execution performed by this command"])
            # Publish only after every check passed; never replace previous files.
            with log.stage("publication"):
                os.link(signed, result)
            report.update(status="built", current_stage="complete", stages=log.stages,
                          commands=log.commands, finished_at=utc_now())
            try:
                write_json_exclusive(result.with_suffix(".json"), report)
            except OSError:
                result.unlink()
                raise
            log.current_stage = "complete"
            log.event("run_completed", apk=str(result), report=str(result.with_suffix(".json")))
            return result
    except (Exception, KeyboardInterrupt) as exc:
        failure_path = report_failure(report, exc, log, output)
        if isinstance(exc, KeyboardInterrupt):
            raise
        raise Error(f"{exc}\n阶段：{log.current_stage}；运行编号：{token}\n日志：{log.path}\n失败报告：{failure_path}") from exc
    finally:
        log.close()


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="完全本地的 Android 10+ APK 加壳原型（浏览器类应用）。")
    parser.add_argument("apk", nargs="*", type=Path, help="省略时读取 input 中的 APK")
    parser.add_argument("--config", type=Path, default=BASE / "config.json")
    parser.add_argument("--allow-min-sdk-raise", action="store_true", help="允许将输出最低系统版本提升到 Android 10")
    parser.add_argument("--check-only", action="store_true", help="只检查结构，不生成 APK")
    parser.add_argument("--compatibility-profile", choices=sorted(COMPAT_PROFILES),
                        help="覆盖 config.json 中的 compatibility_profile")
    parser.add_argument("--manifest-debug-mode", choices=("keep_only", "remove_list", "remove_all"),
                        help="启用 Manifest 权限调试并指定模式（覆盖 config manifest_debug）")
    parser.add_argument("--manifest-debug-permissions", type=str, default="",
                        help="逗号分隔权限名，配合 keep_only / remove_list")
    parser.add_argument("--no-manifest-debug", action="store_true",
                        help="忽略 config 中的 manifest_debug")
    parser.add_argument("--manifest-debug-strip-accessibility", action="store_true",
                        help="Manifest 调试：移除 BIND_ACCESSIBILITY_SERVICE 无障碍 Service 声明")
    parser.add_argument("--list-permissions", action="store_true",
                        help="只列出 APK Manifest 权限并退出（不打包）")
    args = parser.parse_args(argv)
    startup_stage = "configuration"
    try:
        config = json.loads(args.config.read_text(encoding="utf-8-sig"))
        if not isinstance(config, dict):
            raise Error("配置应为 JSON 对象。")
        for key in ("java_home", "android_sdk"):
            if not isinstance(config.get(key, ""), str):
                raise Error(f"{key} 应为路径字符串。")
        if type(config.get("allow_min_sdk_raise", False)) is not bool:
            raise Error("allow_min_sdk_raise 应为 true 或 false。")
        profile = args.compatibility_profile or config.get("compatibility_profile", DEFAULT_COMPAT_PROFILE)
        if profile not in COMPAT_PROFILES:
            raise Error(f"compatibility_profile 应为 {', '.join(sorted(COMPAT_PROFILES))} 之一。")
        config["allow_min_sdk_raise"] = args.allow_min_sdk_raise or config.get("allow_min_sdk_raise", False)
        config["compatibility_profile"] = profile
        cli_debug = {"disabled": args.no_manifest_debug}
        if args.manifest_debug_mode or args.manifest_debug_strip_accessibility:
            cli_debug = {"mode": args.manifest_debug_mode or "remove_all",
                         "permissions": [part.strip() for part in args.manifest_debug_permissions.split(",") if part.strip()],
                         "remove_permission_declarations": True,
                         "strip_accessibility_services": args.manifest_debug_strip_accessibility}
        startup_stage = "input_discovery"
        files = args.apk or sorted(p for p in (BASE / "input").iterdir()
                                   if p.is_file() and p.suffix.lower() == ".apk")
        if not files:
            print(f"请把 APK 放入 {BASE / 'input'}；使用说明见 README.md。")
            return 0
        output = BASE / "output"
        output.mkdir(exist_ok=True)
        failures = 0
        startup_stage = "run_lock"
        if args.list_permissions:
            tools, env = resolve_tools(config)
            for apk in files:
                apk = apk.expanduser().resolve()
                xml = run_command([tools["analyzer"], "manifest", "print", apk], env, None, log_stdout=False)
                root = ET.fromstring(xml)
                perms = sorted({node.get(ANDROID + "name", "") for node in root if _permission_tag(node.tag)})
                decl = sorted({node.get(ANDROID + "name", "") for node in root
                               if node.tag.rsplit("}", 1)[-1] == "permission"})
                print(f"{apk.name}\tuses-permission={len(perms)}")
                for name in perms:
                    print(f"  {name}")
                if decl:
                    print(f"  [declares permission] {', '.join(decl)}")
            return 0
        with core.single_run():
            for apk in files:
                try:
                    result = process(apk.expanduser().resolve(), config, None, None, output, args.check_only,
                                     cli_debug)
                    print(f"完成：{result}")
                except Error as exc:
                    failures += 1
                    print(f"失败：{apk.name}\n{exc}", file=sys.stderr)
        print(f"成功 {len(files) - failures}，失败 {failures}；运行兼容性请另做 Android 设备测试。")
        return 1 if failures else 0
    except (Error, OSError, ValueError) as exc:
        print(f"错误：{exc}", file=sys.stderr)
        log = None
        try:
            output = BASE / "output"
            output.mkdir(parents=True, exist_ok=True)
            token = datetime.now().strftime("%Y%m%d-%H%M%S-") + secrets.token_hex(4)
            log = RunLog(output, token)
            log.current_stage = startup_stage
            report = {"run_id": token, "engine_version": "0.1.0", "experimental": True,
                "mode": "check" if args.check_only else "build", "config_path": str(args.config),
                "inputs": [str(path) for path in args.apk], "created_at": utc_now()}
            result = report_failure(report, exc, log, output)
            print(f"失败报告：{result}", file=sys.stderr)
        except OSError as diagnostic_error:
            print(f"诊断文件写入失败：{diagnostic_error}", file=sys.stderr)
        finally:
            if log is not None:
                log.close()
        return 1


if __name__ == "__main__":
    try:
        sys.exit(main())
    except KeyboardInterrupt:
        print("\n已中断；原始输入保持不变。", file=sys.stderr)
        sys.exit(130)
