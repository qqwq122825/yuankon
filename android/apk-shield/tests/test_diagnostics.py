"""Structured stage/command reports, redaction, failure durability and isolation."""
import base64
import json
from pathlib import Path
import subprocess
import tempfile
import unittest
from unittest.mock import patch
import zipfile

import test_engine as fixtures

engine = fixtures.engine


class StructuredLoggingTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        self.log = engine.RunLog(self.root, "fixture-run")

    def tearDown(self):
        self.log.close()
        self.temp.cleanup()

    def events(self):
        return [json.loads(line) for line in self.log.path.read_text().splitlines()]

    def test_success_and_failure_stages_have_timings_and_run_ids(self):
        with self.log.stage("inspect"):
            self.log.event("fixture_checked")
        with self.assertRaises(engine.Error):
            with self.log.stage("compile"):
                raise engine.Error("fixture compile failure")
        self.assertEqual([stage["status"] for stage in self.log.stages], ["passed", "failed"])
        for stage in self.log.stages:
            self.assertGreaterEqual(stage["duration_ms"], 0)
        self.assertEqual(self.log.current_stage, "compile")
        self.assertTrue(all(event["run_id"] == "fixture-run" for event in self.events()))
        self.assertEqual(self.log.path.stat().st_mode & 0o777, 0o600)

    def test_commands_capture_separate_streams_and_exit_code(self):
        completed = subprocess.CompletedProcess(["fixture"], 0, "parser output", "warning only")
        with patch.object(engine.subprocess, "run", return_value=completed):
            with self.log.stage("decode"):
                self.assertEqual(engine.run_command(["fixture", "arg"], {}, self.log), "parser output")
        finished = [event for event in self.events() if event["event"] == "command_finished"][0]
        self.assertEqual(finished["stdout"], "parser output")
        self.assertEqual(finished["stderr"], "warning only")
        self.assertEqual(finished["exit_code"], 0)
        self.assertEqual(finished["stage"], "decode")
        self.assertNotIn("stdout", self.log.commands[0])

    def test_registered_key_password_redaction_and_output_limit(self):
        key = bytes(range(32))
        self.log.register_key(key)
        key_texts = [key.hex(), base64.b64encode(key).decode(), ",".join(map(str, key))]
        stdout = " ".join(key_texts) + " pass:fixture-secret " + "z" * 70000
        completed = subprocess.CompletedProcess(["fixture"], 0, stdout, "")
        with patch.object(engine.subprocess, "run", return_value=completed):
            self.assertEqual(engine.run_command(["fixture", "pass:fixture-secret"], {}, self.log), stdout)
        serialized = self.log.path.read_text()
        for secret in key_texts + ["fixture-secret"]:
            self.assertNotIn(secret, serialized)
        finished = [event for event in self.events() if event["event"] == "command_finished"][0]
        self.assertTrue(finished["stdout_truncated"])
        self.assertEqual(finished["stdout_characters"], len(stdout))
        self.assertLessEqual(len(finished["stdout"]), 65536)

    def test_nonzero_timeout_and_launch_failure_are_distinct(self):
        outcomes = [subprocess.CompletedProcess(["fixture"], 7, "partial", "failed"),
                    subprocess.TimeoutExpired(["fixture"], 2, output=b"partial", stderr=b"timeout"),
                    FileNotFoundError("fixture executable missing")]
        for index, outcome in enumerate(outcomes):
            context = patch.object(engine.subprocess, "run", **(
                {"side_effect": outcome} if isinstance(outcome, Exception) else {"return_value": outcome}))
            with self.subTest(outcome=outcome), context, self.assertRaises(engine.Error):
                engine.run_command(["fixture"], {}, self.log, timeout=2)
            record = self.log.commands[index]
            self.assertEqual(record["timeout_seconds"], 2)
        self.assertEqual(self.log.commands[0]["exit_code"], 7)
        self.assertTrue(self.log.commands[1]["timed_out"])
        self.assertTrue(self.log.commands[2]["launch_failed"])

    def test_decoded_manifest_stdout_is_returned_but_not_persisted(self):
        raw = '<meta-data android:value="fixture-private-api-value"/>'
        result = subprocess.CompletedProcess(["fixture"], 0, raw, "")
        with patch.object(engine.subprocess, "run", return_value=result):
            self.assertEqual(engine.run_command(["fixture"], {}, self.log, log_stdout=False), raw)
        self.assertNotIn("fixture-private-api-value", self.log.path.read_text())
        finished = [event for event in self.events() if event["event"] == "command_finished"][0]
        self.assertTrue(finished["stdout_omitted"])
        self.assertEqual(finished["stdout_characters"], len(raw))


class ProcessReportTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        self.output = self.root / "output"
        self.apk = self.root / "fixture.apk"
        with zipfile.ZipFile(self.apk, "w") as archive:
            archive.writestr("AndroidManifest.xml", b"fixture manifest; external decoder is mocked")
            archive.writestr("classes.dex", fixtures.structural_dex())
        self.original = self.apk.read_bytes()
        self.base_patch = patch.object(engine, "BASE", self.root)
        self.base_patch.start()

    def tearDown(self):
        self.base_patch.stop()
        self.temp.cleanup()

    def assert_failure(self, stage, supported):
        failures = list(self.output.glob("*.failure.json"))
        self.assertEqual(len(failures), 1)
        report = json.loads(failures[0].read_text())
        self.assertEqual(report["status"], "failed")
        self.assertEqual(report["current_stage"], stage)
        self.assertIs(report["compatibility"]["structurally_supported"], supported)
        self.assertFalse(report["runtime_tested"])
        self.assertTrue(report["failure"]["type"])
        self.assertTrue(report["failure"]["reason"])
        self.assertEqual(report["stages"][-1]["status"], "failed")
        self.assertEqual(failures[0].stat().st_mode & 0o777, 0o600)
        trace = Path(report["private_traceback"])
        self.assertTrue(trace.is_file())
        self.assertEqual(trace.stat().st_mode & 0o777, 0o600)
        self.assertIn("Traceback", trace.read_text())
        events = [json.loads(line) for line in Path(report["log"]).read_text().splitlines()]
        self.assertEqual(events[-1]["event"], "run_failed")
        self.assertEqual(events[-1]["stage"], stage)
        self.assertFalse(list((self.root / ".private").glob(".work-*")))
        self.assertFalse(list(self.output.glob("*.apk")))
        return report

    def test_bad_zip_fails_before_toolchain_with_report(self):
        self.apk.write_bytes(b"bad archive")
        with patch.object(engine, "resolve_tools") as resolve, self.assertRaises(engine.Error):
            engine.process(self.apk, {}, None, None, self.output, True)
        resolve.assert_not_called()
        self.assert_failure("input_validation", False)
        self.assertEqual(self.apk.read_bytes(), b"bad archive")

    def test_missing_toolchain_report_keeps_input_identity(self):
        with patch.object(engine, "resolve_tools", side_effect=engine.Error("fixture missing tool")), \
                self.assertRaises(engine.Error):
            engine.process(self.apk, {}, None, None, self.output, True)
        report = self.assert_failure("toolchain", None)
        self.assertEqual(report["input_sha256"], engine.core.sha256(self.apk))
        self.assertEqual(self.apk.read_bytes(), self.original)

    def test_incompatible_manifest_reports_exact_stage(self):
        xml = fixtures.MANIFEST.replace("android.permission.INTERNET", "android.permission.READ_SMS")
        with patch.object(engine, "run_command", return_value=xml), self.assertRaises(engine.Error):
            engine.process(self.apk, {}, {"analyzer": Path("fixture")}, {}, self.output, True)
        report = self.assert_failure("compatibility", False)
        self.assertTrue(report["compatibility"]["reasons"])
        self.assertEqual(self.apk.read_bytes(), self.original)

    def test_check_only_has_stages_but_no_apk_or_key(self):
        with patch.object(engine, "run_command", return_value=fixtures.MANIFEST):
            path = engine.process(self.apk, {}, {"analyzer": Path("fixture")}, {}, self.output, True)
        report = json.loads(path.read_text())
        self.assertEqual(report["status"], "checked")
        self.assertTrue(report["structurally_supported"])
        self.assertFalse(report["runtime_tested"])
        self.assertEqual(report["current_stage"], "complete")
        self.assertTrue(all(stage["status"] == "passed" for stage in report["stages"]))
        self.assertEqual(report["stages"][-1]["name"], "dex_validation")
        self.assertFalse(list(self.output.glob("*.apk")))
        self.assertFalse((self.root / ".private/development.p12").exists())
        self.assertFalse(list((self.root / ".private").glob(".work-*")))
        self.assertEqual(self.apk.read_bytes(), self.original)

    def test_unexpected_compile_error_is_recorded_after_valid_structure(self):
        with patch.object(engine, "run_command", return_value=fixtures.MANIFEST), \
                patch.object(engine, "compile_helpers", side_effect=ValueError("fixture compile issue")), \
                self.assertRaises(engine.Error):
            engine.process(self.apk, {}, {"analyzer": Path("fixture")}, {}, self.output, False)
        report = self.assert_failure("compile_helpers", True)
        self.assertEqual(report["failure"]["type"], "ValueError")
        self.assertEqual(self.apk.read_bytes(), self.original)

    def test_interruption_has_report_and_propagates_keyboardinterrupt(self):
        with patch.object(engine, "run_command", side_effect=KeyboardInterrupt()), \
                self.assertRaises(KeyboardInterrupt):
            engine.process(self.apk, {}, {"analyzer": Path("fixture")}, {}, self.output, True)
        # KeyboardInterrupt deliberately has no message; the typed report remains diagnostic.
        report = json.loads(next(self.output.glob("*.failure.json")).read_text())
        self.assertEqual(report["failure"]["type"], "KeyboardInterrupt")
        self.assertEqual(report["current_stage"], "manifest_decode")
        self.assertFalse(report["runtime_tested"])
        self.assertFalse(list((self.root / ".private").glob(".work-*")))


if __name__ == "__main__":
    unittest.main()
