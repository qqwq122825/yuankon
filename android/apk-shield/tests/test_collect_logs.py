"""ADB command planning tests. No connected device is used by this suite."""
import contextlib
import importlib.util
import io
import json
from pathlib import Path
import subprocess
import tempfile
import unittest
from unittest.mock import patch

SPEC = importlib.util.spec_from_file_location("shield_collect_logs_tests",
                                             Path(__file__).resolve().parents[1] / "collect_logs.py")
collector = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(collector)


class LogCollectorTests(unittest.TestCase):
    def invoke(self, devices, pids="123", serial=None, package="com.example.browser"):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            calls = []

            def run(args, allow_failure=False):
                args = list(map(str, args))
                calls.append(args)
                if args[1:] == ["devices"]:
                    data = "List of devices attached\n" + devices
                elif "getprop" in args:
                    data = "fixture\n"
                elif "pidof" in args:
                    data = pids
                elif "logcat" in args:
                    data = "fixture APKShield stage=classloader status=ok\n"
                else:
                    raise AssertionError("Unexpected ADB command " + repr(args))
                return subprocess.CompletedProcess(args, 0, data, "")

            argv = ["--package", package]
            if serial is not None:
                argv += ["--serial", serial]
            stdout, stderr = io.StringIO(), io.StringIO()
            with patch.object(collector, "BASE", root), patch.object(collector, "find_adb", return_value=Path("/fixture/adb")), \
                    patch.object(collector, "run", side_effect=run), \
                    contextlib.redirect_stdout(stdout), contextlib.redirect_stderr(stderr):
                code = collector.main(argv)
            reports = [json.loads(path.read_text()) for path in (root / "output").glob("*.json")]
            modes = [path.stat().st_mode & 0o777 for path in (root / "output").glob("*")]
            return code, calls, reports, modes, stdout.getvalue(), stderr.getvalue()

    def test_no_online_device_has_no_report(self):
        for devices in ("", "serial unauthorized\n", "serial offline\n"):
            with self.subTest(devices=devices):
                code, calls, reports, *_ = self.invoke(devices)
                self.assertEqual(code, 1)
                self.assertEqual(len(calls), 1)
                self.assertEqual(reports, [])

    def test_multiple_devices_need_selection(self):
        code, calls, reports, *_ = self.invoke("one device\ntwo device\n")
        self.assertEqual(code, 1)
        self.assertEqual(len(calls), 1)
        self.assertEqual(reports, [])

    def test_unknown_selected_device_stops(self):
        code, calls, reports, *_ = self.invoke("one device\n", serial="two")
        self.assertEqual(code, 1)
        self.assertEqual(len(calls), 1)
        self.assertEqual(reports, [])

    def test_explicit_device_and_each_pid_are_narrowly_filtered(self):
        code, calls, reports, modes, *_ = self.invoke("one device\ntwo device\n", pids="123 456", serial="two")
        self.assertEqual(code, 0)
        logs = [args for args in calls if "logcat" in args]
        self.assertEqual(len(logs), 2)
        self.assertIn("--pid=123", logs[0])
        self.assertIn("--pid=456", logs[1])
        for args in calls[1:]:
            self.assertEqual(args[1:3], ["-s", "two"])
        for args in logs:
            self.assertEqual(args[-2:], ["APKShield:V", "*:S"])
        self.assertEqual(reports[0]["scope"], "package-pids")
        self.assertFalse(reports[0]["runtime_verified"])
        self.assertEqual(modes, [0o600, 0o600])
        self.assertFalse(any(token in ("install", "uninstall", "am", "settings", "-c") for args in calls for token in args))

    def test_stopped_process_uses_engine_tag_and_discloses_broader_scope(self):
        code, calls, reports, _, stdout, _ = self.invoke("one device\n", pids="")
        self.assertEqual(code, 0)
        logs = [args for args in calls if "logcat" in args]
        self.assertEqual(len(logs), 1)
        self.assertFalse(any(arg.startswith("--pid=") for arg in logs[0]))
        self.assertEqual(logs[0][-2:], ["APKShield:V", "*:S"])
        self.assertEqual(reports[0]["scope"], "APKShield-tag-only")
        self.assertIn(reports[0]["note"], stdout)
        self.assertFalse(reports[0]["runtime_verified"])

    def test_non_numeric_pid_stops_before_logcat(self):
        code, calls, reports, *_ = self.invoke("one device\n", pids="123; bad")
        self.assertEqual(code, 1)
        self.assertFalse(any("logcat" in args for args in calls))
        self.assertEqual(reports, [])

    def test_invalid_package_stops_before_adb(self):
        code, calls, reports, *_ = self.invoke("one device\n", package="com.example;bad")
        self.assertEqual(code, 1)
        self.assertEqual(calls, [])
        self.assertEqual(reports, [])


if __name__ == "__main__":
    unittest.main()
