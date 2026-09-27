import contextlib
import hashlib
import importlib.util
import io
import json
import os
from pathlib import Path
import struct
import subprocess
import tempfile
import unittest
from unittest.mock import patch
import xml.etree.ElementTree as ET
import zipfile
import zlib

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location("shield_engine_test", ROOT / "engine.py")
engine = importlib.util.module_from_spec(spec)
spec.loader.exec_module(engine)

MANIFEST = '''<manifest xmlns:android="http://schemas.android.com/apk/res/android"
    package="com.example.browser" android:versionCode="7" android:versionName="1.0">
    <uses-sdk android:minSdkVersion="29" android:targetSdkVersion="35"/>
    <uses-permission android:name="android.permission.INTERNET"/>
    <application android:debuggable="false">
      <activity android:name=".MainActivity" android:exported="true">
        <intent-filter>
          <action android:name="android.intent.action.MAIN"/>
          <category android:name="android.intent.category.LAUNCHER"/>
        </intent-filter>
      </activity>
    </application>
</manifest>'''


def structural_dex():
    """Checksum-valid header fixture, not executable Android application code."""
    data = bytearray(112)
    data[:8] = b"dex\n035\0"
    struct.pack_into("<III", data, 32, len(data), 112, 0x12345678)
    data[12:32] = hashlib.sha1(data[32:]).digest()
    struct.pack_into("<I", data, 8, zlib.adler32(data[12:]))
    return bytes(data)


class ManifestTests(unittest.TestCase):
    def check(self, xml=MANIFEST, entries=None, allow=False, profile=engine.DEFAULT_COMPAT_PROFILE):
        return engine.inspect_manifest(xml, entries or ["classes.dex", "AndroidManifest.xml"], allow,
                                       profile=profile)

    def test_visible_browser_supported(self):
        info = self.check()
        self.assertEqual(info["package_name"], "com.example.browser")
        self.assertEqual(info["min_sdk_after"], 29)
        self.assertEqual(info["permissions"], ["android.permission.INTERNET"])

    def test_sdk_raise_requires_explicit_option(self):
        xml = MANIFEST.replace('minSdkVersion="29"', 'minSdkVersion="26"')
        with self.assertRaises(engine.Error):
            self.check(xml)
        self.assertEqual(self.check(xml, allow=True)["min_sdk_after"], 29)

    def test_newer_minimum_preserved(self):
        self.assertEqual(self.check(MANIFEST.replace('minSdkVersion="29"', 'minSdkVersion="33"'))["min_sdk_after"], 33)

    def test_old_target_is_not_silently_changed(self):
        with self.assertRaises(engine.Error):
            self.check(MANIFEST.replace('targetSdkVersion="35"', 'targetSdkVersion="28"'), allow=True)

    def test_permissions_outside_browser_profile(self):
        for permission in ("READ_SMS", "RECORD_AUDIO", "READ_CONTACTS"):
            with self.subTest(permission=permission), self.assertRaises(engine.Error):
                self.check(MANIFEST.replace("android.permission.INTERNET", "android.permission." + permission))

    def test_background_components_not_supported(self):
        for tag in ("service", "provider", "receiver", "uses-library"):
            xml = MANIFEST.replace("</application>", f'<{tag} android:name="com.example.Extra"/></application>')
            with self.subTest(tag=tag), self.assertRaises(engine.Error):
                self.check(xml)

    def test_unsupported_factory_loader_and_debug_builds(self):
        for attr in ('android:appComponentFactory="com.example.Factory"',
                     'android:classLoader="com.example.Loader"',
                     'android:process=":worker"', 'android:debuggable="true"'):
            xml = MANIFEST.replace('android:debuggable="false"', attr)
            with self.subTest(attr=attr), self.assertRaises(engine.Error):
                self.check(xml)

    def test_native_plugins_repeated_packing(self):
        for name in ("lib/arm64-v8a/libx.so", "assets/libx.so", "assets/plugin.apk", "assets/plugin.jar", engine.MARKER):
            with self.subTest(name=name), self.assertRaises(engine.Error):
                self.check(entries=["classes.dex", name])

    def test_embedded_native_allows_jni_and_background_components(self):
        xml = MANIFEST.replace("</application>",
                               '<receiver android:name="com.example.Receiver"/>'
                               '<provider android:name="com.example.Provider" android:authorities="com.example"/>'
                               '</application>')
        xml = xml.replace("android.permission.INTERNET", "android.permission.READ_SMS")
        entries = ["classes.dex", "AndroidManifest.xml", "lib/arm64-v8a/libnative.so"]
        info = self.check(xml, entries=entries, profile="embedded-native")
        self.assertEqual(info["compatibility_profile"], "embedded-native")
        self.assertIn("android.permission.READ_SMS", info["permissions"])

    def test_embedded_native_still_blocks_nested_plugins(self):
        for name in ("assets/plugin.apk", "assets/plugin.jar", "assets/libx.so"):
            with self.subTest(name=name), self.assertRaises(engine.Error):
                self.check(entries=["classes.dex", name], profile="embedded-native")

    def test_split_and_shared_uid(self):
        for attr in ('split="base"', 'android:sharedUserId="shared"', 'android:isSplitRequired="true"'):
            with self.subTest(attr=attr), self.assertRaises(engine.Error):
                self.check(MANIFEST.replace('package="com.example.browser"', f'package="com.example.browser" {attr}'))

    def test_missing_launch_entry(self):
        xml = MANIFEST.replace("android.intent.category.LAUNCHER", "android.intent.category.DEFAULT")
        with self.assertRaises(engine.Error):
            self.check(xml)
        self.assertEqual(self.check(xml, profile="embedded-native")["compatibility_profile"], "embedded-native")
        with self.assertRaises(engine.Error):
            self.check(MANIFEST.replace("android.intent.action.MAIN", "android.intent.action.VIEW"), profile="embedded-native")

    def test_exact_manifest_changes_only(self):
        after = ET.fromstring(MANIFEST)
        after.find("application").set(engine.ANDROID + "appComponentFactory", engine.FACTORY)
        engine.verify_manifest(MANIFEST, ET.tostring(after, encoding="unicode"), 29)
        after.find("uses-permission").set(engine.ANDROID + "name", "android.permission.CAMERA")
        with self.assertRaises(engine.Error):
            engine.verify_manifest(MANIFEST, ET.tostring(after, encoding="unicode"), 29)

    def test_manifest_debug_remove_all_and_keep_only(self):
        extra = MANIFEST.replace("</manifest>",
                                  '<uses-permission android:name="android.permission.CAMERA"/>'
                                  '<permission android:name="com.example.CUSTOM"/>'
                                  '</manifest>')
        policy = engine.permission_debug_policy("remove_all", [], True)
        stripped = ET.fromstring(extra)
        summary = engine.apply_manifest_debug(stripped, policy)
        self.assertEqual(summary["kept"], [])
        self.assertIn("android.permission.INTERNET", summary["removed"])
        after = ET.fromstring(ET.tostring(stripped, encoding="unicode"))
        after.find("application").set(engine.ANDROID + "appComponentFactory", engine.FACTORY)
        engine.verify_manifest(extra, ET.tostring(after, encoding="unicode"), 29, policy)
        policy_keep = engine.permission_debug_policy("keep_only", ["android.permission.INTERNET"], False)
        stripped2 = ET.fromstring(extra)
        engine.apply_manifest_debug(stripped2, policy_keep)
        self.assertNotIn("android.permission.CAMERA",
                         [node.get(engine.ANDROID + "name") for node in stripped2 if engine._permission_tag(node.tag)])


class DexAndZipTests(unittest.TestCase):
    def test_dex_checksum_validation(self):
        data = structural_dex()
        engine.validate_dex(data)
        for offset in (0, 8, 12, 32, 36, 40, 70):
            corrupt = bytearray(data)
            corrupt[offset] ^= 1
            with self.subTest(offset=offset), self.assertRaises(engine.Error):
                engine.validate_dex(bytes(corrupt))

    def zip_names(self, names):
        stream = io.BytesIO()
        with zipfile.ZipFile(stream, "w") as apk:
            for name in names:
                apk.writestr(name, structural_dex())
        stream.seek(0)
        with zipfile.ZipFile(stream) as apk:
            return engine.dex_names(apk)

    def test_multidex_order(self):
        self.assertEqual(self.zip_names(["classes2.dex", "classes.dex"]), ["classes.dex", "classes2.dex"])

    def test_missing_and_nested_dex(self):
        for names in ([], ["classes2.dex"], ["classes.dex", "classes3.dex"],
                      ["classes.dex", "assets/classes.dex"], ["classes.dex", "classes1.dex"]):
            with self.subTest(names=names), self.assertRaises(engine.Error):
                self.zip_names(names)

    def test_zip_rewrite_preserves_resources_and_metadata(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            original, output = root / "original.apk", root / "output.apk"
            manifest, shell, payload = (root / name for name in ("manifest", "shell", "payload"))
            manifest.write_bytes(b"new manifest")
            shell.write_bytes(b"new shell")
            payload.write_bytes(b"encrypted payload")
            with zipfile.ZipFile(original, "w") as apk:
                for name, data in {"AndroidManifest.xml": b"old manifest", "classes.dex": b"old dex",
                                   "classes2.dex": b"second dex", "META-INF/OLD.RSA": b"old signature",
                                   "META-INF/services/example": b"keep me", "resources.arsc": b"resources"}.items():
                    apk.writestr(name, data)
            names = ["classes.dex", "classes2.dex"]
            engine.rewrite_archive(original, output, manifest, shell, payload, names)
            self.assertEqual(engine.verify_entries(original, output, names, manifest, shell, payload), 2)
            with zipfile.ZipFile(output) as apk:
                self.assertNotIn("classes2.dex", apk.namelist())
                self.assertNotIn("META-INF/OLD.RSA", apk.namelist())
                self.assertEqual(apk.read("META-INF/services/example"), b"keep me")
                self.assertEqual(apk.read("classes.dex"), b"new shell")
            with self.assertRaises(FileExistsError):
                engine.rewrite_archive(original, output, manifest, shell, payload, names)

    def test_archive_path_and_duplicate_validation(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            for i, name in enumerate(("../payload", "/absolute", "nested\\file")):
                apk = root / f"{i}.apk"
                with zipfile.ZipFile(apk, "w") as data:
                    data.writestr("AndroidManifest.xml", b"manifest")
                    data.writestr(name, b"data")
                with self.assertRaises(engine.Error):
                    engine.core.validate_apk(apk)


class CryptoIntegrationTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.tools, cls.env = engine.core.toolchain({})
        cls.temp = tempfile.TemporaryDirectory()
        cls.root = Path(cls.temp.name)
        cls.classes = cls.root / "classes"
        cls.classes.mkdir()
        result = subprocess.run([str(cls.tools["javac"]), "-d", str(cls.classes),
            str(ROOT / "java/local/apkshield/runtime/PayloadCodec.java"), str(ROOT / "java/PayloadTool.java")],
            env=cls.env, capture_output=True, text=True)
        if result.returncode:
            raise RuntimeError(result.stdout + result.stderr)
        cls.key = cls.root / "key"
        cls.key.write_bytes(os.urandom(32))
        cls.plain = cls.root / "plain.zip"
        with zipfile.ZipFile(cls.plain, "w") as archive:
            archive.writestr("classes.dex", structural_dex())
            archive.writestr("classes2.dex", structural_dex())

    @classmethod
    def tearDownClass(cls):
        cls.temp.cleanup()

    def invoke(self, mode, key, plain, packed):
        return subprocess.run([str(self.tools["java"]), "-cp", str(self.classes), "PayloadTool", mode,
                              str(key), str(plain), str(packed)], env=self.env, capture_output=True, text=True)

    def make_payload(self, name):
        packed = self.root / name
        result = self.invoke("encrypt", self.key, self.plain, packed)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn("DEX count=2", result.stdout)
        return packed

    def test_jvm_shared_decoder_and_random_nonces(self):
        first = self.make_payload("first.blp")
        second = self.make_payload("second.blp")
        self.assertNotEqual(first.read_bytes(), second.read_bytes())
        self.assertEqual(first.read_bytes()[:4], b"BLP1")

    def test_modified_container_and_wrong_key_fail(self):
        good = self.make_payload("tamper-source.blp")
        for offset in (0, 4, 17, len(good.read_bytes()) - 1):
            data = bytearray(good.read_bytes())
            data[offset] ^= 1
            corrupt = self.root / f"corrupt-{offset}.blp"
            corrupt.write_bytes(data)
            self.assertNotEqual(self.invoke("verify", self.key, self.plain, corrupt).returncode, 0)
        wrong_key = self.root / "wrong.key"
        wrong_key.write_bytes(os.urandom(32))
        self.assertNotEqual(self.invoke("verify", wrong_key, self.plain, good).returncode, 0)

    def test_nested_entry_rejected_by_runtime_decoder(self):
        invalid = self.root / "nested.zip"
        with zipfile.ZipFile(invalid, "w") as archive:
            archive.writestr("../classes.dex", structural_dex())
        result = self.invoke("encrypt", self.key, invalid, self.root / "nested.blp")
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("Unexpected DEX entry", result.stderr)

    def test_empty_nonsequential_excessive_and_invalid_dex_payloads(self):
        cases = {
            "empty": [],
            "missing-first": [("classes2.dex", structural_dex())],
            "gap": [("classes.dex", structural_dex()), ("classes3.dex", structural_dex())],
            "bad-dex": [("classes.dex", b"not a dex")],
            "too-many": [("classes.dex" if i == 1 else f"classes{i}.dex", structural_dex())
                         for i in range(1, 18)],
        }
        for name, entries in cases.items():
            with self.subTest(name=name):
                invalid = self.root / f"invalid-{name}.zip"
                with zipfile.ZipFile(invalid, "w") as archive:
                    for entry, data in entries:
                        archive.writestr(entry, data)
                result = self.invoke("encrypt", self.key, invalid, self.root / f"invalid-{name}.blp")
                self.assertNotEqual(result.returncode, 0)

    def test_invalid_key_length_and_existing_output_are_not_accepted(self):
        short_key = self.root / "short.key"
        short_key.write_bytes(b"short")
        result = self.invoke("encrypt", short_key, self.plain, self.root / "short-key.blp")
        self.assertNotEqual(result.returncode, 0)
        packed = self.make_payload("never-overwrite.blp")
        original = packed.read_bytes()
        self.assertNotEqual(self.invoke("encrypt", self.key, self.plain, packed).returncode, 0)
        self.assertEqual(packed.read_bytes(), original)


class CliTests(unittest.TestCase):
    def test_empty_input_and_invalid_config(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            (root / "input").mkdir()
            config = root / "config.json"
            config.write_text('{"allow_min_sdk_raise":false}')
            with patch.object(engine, "BASE", root), contextlib.redirect_stdout(io.StringIO()):
                self.assertEqual(engine.main(["--config", str(config)]), 0)
                config.write_text('{"allow_min_sdk_raise":"yes"}')
                with contextlib.redirect_stderr(io.StringIO()):
                    self.assertEqual(engine.main(["--config", str(config)]), 1)


if __name__ == "__main__":
    unittest.main()
