"""Compatibility boundaries; XML fixtures are not Android runtime tests."""
import contextlib
import io
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

import test_engine as fixtures

engine = fixtures.engine
MANIFEST = fixtures.MANIFEST
SERVICE = '''<service android:name=".StatusService" android:exported="true"
    android:permission="android.permission.BIND_ACCESSIBILITY_SERVICE">
  <intent-filter><action android:name="android.accessibilityservice.AccessibilityService"/></intent-filter>
  <meta-data android:name="android.accessibilityservice" android:resource="@xml/status_service"/>
</service>'''
CONFIG = '''<accessibility-service xmlns:android="http://schemas.android.com/apk/res/android"
    android:accessibilityEventTypes="0" android:accessibilityFlags="0"
    android:canRetrieveWindowContent="false" android:canPerformGestures="false"
    android:canRequestFilterKeyEvents="false" android:canTakeScreenshot="false"/>'''


class CompatibilityTests(unittest.TestCase):
    def inspect(self, application_attrs="", service="", config=CONFIG, manifest=MANIFEST):
        manifest = manifest.replace('android:debuggable="false"',
                                    'android:debuggable="false" ' + application_attrs)
        manifest = manifest.replace("</application>", service + "</application>")
        configs = {"@xml/status_service": config} if config is not None else {}
        return engine.inspect_manifest(manifest, ["classes.dex", "AndroidManifest.xml"], False, configs)

    def test_custom_application_name_resolution(self):
        for name, expected in ((".BrowserApp", "com.example.browser.BrowserApp"),
                               ("BrowserApp", "com.example.browser.BrowserApp"),
                               ("org.example.BrowserApp", "org.example.BrowserApp")):
            with self.subTest(name=name):
                info = self.inspect('android:name="' + name + '"')
                self.assertEqual(info["original_application"], expected)

    def test_supported_original_factories(self):
        for factory in ("android.app.AppComponentFactory", "androidx.core.app.CoreComponentFactory"):
            with self.subTest(factory=factory):
                info = self.inspect('android:appComponentFactory="' + factory + '"')
                self.assertEqual(info["original_factory"], factory)
        self.assertEqual(self.inspect()["original_factory"], "")

    def test_arbitrary_factory_and_dynamic_application_names_rejected(self):
        for attr in ('android:appComponentFactory="com.example.CustomFactory"',
                     'android:name="@string/application_name"'):
            with self.subTest(attr=attr), self.assertRaises(engine.Error):
                self.inspect(attr)

    def test_status_only_service_explicit_zero_and_default_zero(self):
        for config in (CONFIG, CONFIG.replace('android:accessibilityEventTypes="0"', "")):
            with self.subTest(config=config):
                info = self.inspect(service=SERVICE, config=config)
                self.assertEqual(len(info["accessibility_services"]), 1)
                self.assertEqual(info["permissions"], ["android.permission.INTERNET"])

    def test_status_service_requires_readable_configuration(self):
        for config in (None, "not XML", "<not-accessibility-service/>" ):
            with self.subTest(config=config), self.assertRaises(engine.Error):
                self.inspect(service=SERVICE, config=config)

    def test_nonzero_events_flags_or_capabilities_rejected(self):
        for attr, value in (("accessibilityEventTypes", "1"),
                            ("accessibilityEventTypes", "typeAllMask"),
                            ("accessibilityFlags", "1"),
                            ("canRetrieveWindowContent", "true"),
                            ("canPerformGestures", "true"),
                            ("canRequestFilterKeyEvents", "true"),
                            ("canTakeScreenshot", "true")):
            original = "0" if attr.startswith("accessibility") else "false"
            changed = CONFIG.replace(f'android:{attr}="{original}"', f'android:{attr}="{value}"')
            with self.subTest(attr=attr, value=value), self.assertRaises(engine.Error):
                self.inspect(service=SERVICE, config=changed)

    def test_resource_referenced_events_and_unknown_capability_rejected(self):
        for config in (CONFIG.replace('accessibilityEventTypes="0"', 'accessibilityEventTypes="@integer/events"'),
                       CONFIG.replace("/>", ' android:canFutureCapability="true"/>')):
            with self.subTest(config=config), self.assertRaises(engine.Error):
                self.inspect(service=SERVICE, config=config)

    def test_service_binding_intent_and_metadata_are_required(self):
        for service in (SERVICE.replace("BIND_ACCESSIBILITY_SERVICE", "BIND_NOTIFICATION_LISTENER_SERVICE"),
                        SERVICE.replace("android.accessibilityservice.AccessibilityService", "custom.ACTION"),
                        SERVICE.replace('android:resource="@xml/status_service"', 'android:value="@xml/status_service"'),
                        SERVICE.replace("</service>", '<intent-filter><action android:name="custom.EXTRA"/></intent-filter></service>'),
                        SERVICE.replace("</service>", '<meta-data android:name="android.accessibilityservice" android:resource="@xml/status_service"/></service>')):
            with self.subTest(service=service), self.assertRaises(engine.Error):
                self.inspect(service=service)

    def test_status_service_does_not_relax_permissions_or_other_components(self):
        for manifest in (MANIFEST.replace("android.permission.INTERNET", "android.permission.READ_SMS"),
                         MANIFEST.replace("</application>", '<receiver android:name=".Receiver"/></application>'),
                         MANIFEST.replace("</application>", '<provider android:name=".Provider"/></application>')):
            with self.subTest(manifest=manifest), self.assertRaises(engine.Error):
                self.inspect(service=SERVICE, manifest=manifest)

    def test_status_service_multprocess_configuration_rejected(self):
        with self.assertRaises(engine.Error):
            self.inspect(service=SERVICE.replace('android:exported="true"',
                                                 'android:exported="true" android:process=":other"'))

    def test_every_resource_variant_is_checked(self):
        good = self.inspect(service=SERVICE, config=[CONFIG, CONFIG])
        self.assertEqual(good["accessibility_services"][0]["variant_count"], 2)
        with self.assertRaises(engine.Error):
            self.inspect(service=SERVICE, config=[CONFIG, CONFIG.replace('EventTypes="0"', 'EventTypes="1"')])


class ResourceResolutionTests(unittest.TestCase):
    TABLE = '''    resource 0x7f050001 com.example.browser:xml/status_service: t=0x03 d=0x00000004
      (string8) "res/xml/status_service.xml"
    config v31:
    resource 0x7f050001 com.example.browser:xml/status_service: t=0x03 d=0x00000005
      (string8) "res/xml-v31/status_service.xml"
'''
    ENTRIES = ["res/xml/status_service.xml", "res/xml-v31/status_service.xml"]

    def test_named_and_numeric_references_include_all_variants(self):
        references = {"@xml/status_service", "@0x7f050001", "@ref/0x7f050001"}
        resolved = engine.resource_xml_paths(self.TABLE, references, self.ENTRIES)
        self.assertEqual(set(resolved), references)
        for paths in resolved.values():
            self.assertEqual(paths, sorted(self.ENTRIES))

    def test_alias_opaque_or_missing_resource_paths_stop(self):
        for table, entries in ((self.TABLE.replace("t=0x03", "t=0x01", 1), self.ENTRIES),
                               (self.TABLE.replace('      (string8) "res/xml-v31/status_service.xml"', ""), self.ENTRIES),
                               (self.TABLE, self.ENTRIES[:1]),
                               (self.TABLE.replace("res/xml/status_service.xml", "../status_service.xml"), self.ENTRIES)):
            with self.subTest(table=table, entries=entries), self.assertRaises(engine.Error):
                engine.resource_xml_paths(table, {"@xml/status_service"}, entries)


class BatchIsolationTests(unittest.TestCase):
    def test_batch_continues_after_one_failure_without_touching_inputs(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            (root / "input").mkdir()
            originals = {root / "input/a.apk": b"first-input", root / "input/b.apk": b"second-input"}
            for path, data in originals.items():
                path.write_bytes(data)
            config = root / "config.json"
            config.write_text(json.dumps({"allow_min_sdk_raise": False}))
            calls = []

            def process(apk, config, tools, env, output, check_only, cli_debug=None):
                calls.append(apk)
                if len(calls) == 1:
                    raise engine.Error("fixture first-file failure")
                return output / "second.check.json"

            with patch.object(engine, "BASE", root), patch.object(engine.core, "BASE", root), \
                    patch.object(engine, "resolve_tools", return_value=({}, {})), \
                    patch.object(engine, "process", side_effect=process), \
                    contextlib.redirect_stdout(io.StringIO()), contextlib.redirect_stderr(io.StringIO()):
                self.assertEqual(engine.main(["--config", str(config), "--check-only"]), 1)
            self.assertEqual(calls, sorted(path.resolve() for path in originals))
            for path, data in originals.items():
                self.assertEqual(path.read_bytes(), data)
            self.assertFalse((root / ".private/run.lock").exists())


if __name__ == "__main__":
    unittest.main()
