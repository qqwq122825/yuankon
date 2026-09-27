import importlib.util
import json
from pathlib import Path
import tempfile
import stat
import unittest
from unittest.mock import patch
import zipfile

SCRIPT = Path(__file__).resolve().parents[1] / "repack.py"
spec = importlib.util.spec_from_file_location("repack", SCRIPT)
repack = importlib.util.module_from_spec(spec)
spec.loader.exec_module(repack)


class RepackTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)

    def tearDown(self):
        self.temp.cleanup()

    def config(self, **kwargs):
        return dict(package_name="com.mtx.test", version_name="4.0", version_code="random", **kwargs)

    def test_config_accepts_named_or_random_package_and_code(self):
        for package in ["com.mtx.test", "random"]:
            for code in [1, repack.MAX_CODE, "random"]:
                repack.validate_config(dict(package_name=package, version_name="4.0-beta+2", version_code=code))

    def test_config_rejects_invalid_values(self):
        for key, values in {
            "package_name": [None, "com", "com..test", "com.1test", "a;rm.b", "com.test\n"],
            "version_name": [None, "", "x/y", "x'quoted", "4.0\n"],
            "version_code": [0, -1, True, 1.5, "4", repack.MAX_CODE + 1],
        }.items():
            for value in values:
                with self.subTest(key=key, value=value), self.assertRaises(repack.RepackError):
                    config = self.config()
                    config[key] = value
                    repack.validate_config(config)

    def test_badging_parser_does_not_confuse_sdk_codename_with_package(self):
        text = "package: name='com.mtx.test' versionCode='55' versionName='4.0' compileSdkVersionCodename='15'\n"
        self.assertEqual(dict(package_name="com.mtx.test", version_code=55, version_name="4.0"), repack.read_badging(text))

    def test_badging_parser_rejects_missing_fields(self):
        with self.assertRaises(repack.RepackError):
            repack.read_badging("package: name='com.example.app'\n")

    def test_badging_parser_rejects_split_apk(self):
        with self.assertRaises(repack.RepackError):
            repack.read_badging("package: name='com.example.app' versionCode='1' versionName='1.0' split='config.zh'\n")

    def test_zip_validation_and_dex_hashes(self):
        path = self.root / "valid.APK"
        with zipfile.ZipFile(path, "w") as archive:
            archive.writestr("AndroidManifest.xml", b"manifest")
            archive.writestr("classes.dex", b"dex1")
            archive.writestr("classes2.dex", b"dex2")
            archive.writestr("assets/classes.dex", b"data")
        repack.validate_apk(path)
        self.assertEqual({"classes.dex", "classes2.dex", "assets/classes.dex"}, set(repack.payload_hashes(path)))

    def test_rewrite_changes_only_manifest_and_signature_entries(self):
        source = self.root / "source.apk"
        target = self.root / "target.apk"
        manifest = self.root / "AndroidManifest.xml"
        manifest.write_bytes(b"new manifest")
        with zipfile.ZipFile(source, "w") as archive:
            archive.writestr("AndroidManifest.xml", b"old manifest")
            archive.writestr("classes.dex", b"dex")
            archive.writestr("META-INF/MANIFEST.MF", b"signature")
            archive.writestr("META-INF/CERT.SF", b"signature")
            archive.writestr("META-INF/services/example.Service", b"implementation")
            archive.writestr("META-INF/androidx_core.version", b"1.0")
        repack.rewrite_apk_manifest(source, manifest, target)
        with zipfile.ZipFile(target) as archive:
            self.assertEqual(b"new manifest", archive.read("AndroidManifest.xml"))
            self.assertEqual(b"dex", archive.read("classes.dex"))
            self.assertEqual(b"implementation", archive.read("META-INF/services/example.Service"))
            self.assertEqual(b"1.0", archive.read("META-INF/androidx_core.version"))
            self.assertNotIn("META-INF/MANIFEST.MF", archive.namelist())
            self.assertNotIn("META-INF/CERT.SF", archive.namelist())

    def test_zip_validation_rejects_bad_input(self):
        path = self.root / "bad.apk"
        for entry in ["../outside", "/absolute", "C:/drive", "a\\b"]:
            with zipfile.ZipFile(path, "w") as archive:
                archive.writestr("AndroidManifest.xml", "manifest")
                archive.writestr(entry, "bad")
            with self.subTest(entry=entry), self.assertRaises(repack.RepackError):
                repack.validate_apk(path)
        path.write_text("not a zip")
        with self.assertRaises(repack.RepackError):
            repack.validate_apk(path)

    def test_lock_prevents_second_run_and_cleans_up(self):
        with patch.object(repack, "BASE", self.root):
            with repack.single_run():
                with self.assertRaises(repack.RepackError):
                    with repack.single_run():
                        self.fail("second run entered")
            self.assertFalse((self.root / ".private/run.lock").exists())

    def test_zip_rejects_symlinks_and_missing_manifest(self):
        path = self.root / "link.apk"
        with zipfile.ZipFile(path, "w") as archive:
            archive.writestr("AndroidManifest.xml", "manifest")
            info = zipfile.ZipInfo("assets/link")
            info.create_system = 3
            info.external_attr = (stat.S_IFLNK | 0o777) << 16
            archive.writestr(info, "../../outside")
        with self.assertRaises(repack.RepackError):
            repack.validate_apk(path)
        with zipfile.ZipFile(path, "w") as archive:
            archive.writestr("example.txt", "text")
        with self.assertRaises(repack.RepackError):
            repack.validate_apk(path)

    def test_cli_overrides_and_failed_batch_member(self):
        config = self.root / "config.json"
        config.write_text(json.dumps(self.config()))
        files = [self.root / name for name in ("bad.apk", "good.apk")]
        for path in files:
            path.write_text("fixture")
        with patch.object(repack, "BASE", self.root), patch.object(repack, "toolchain", return_value=({}, {})), \
                patch.object(repack, "ensure_manifest_editor", return_value=self.root / "tool.jar"), \
                patch.object(repack, "validate_apk", side_effect=[repack.RepackError("invalid fixture"), None]), \
                patch.object(repack, "process_apk", return_value=self.root / "result.apk") as process:
            result = repack.main([*(str(p) for p in files), "--config", str(config), "--output-dir", str(self.root / "output"),
                                  "--package", "com.new.app", "--version-name", "5.0", "--version-code", "12"])
            self.assertEqual(1, result)
            process.assert_called_once()
            actual = process.call_args.args[1]
            self.assertEqual(("com.new.app", "5.0", 12), (actual["package_name"], actual["version_name"], actual["version_code"]))

    def test_empty_input_is_success_without_tool_downloads(self):
        (self.root / "input").mkdir()
        config = self.root / "config.json"
        config.write_text(json.dumps(self.config()))
        with patch.object(repack, "BASE", self.root), patch.object(repack, "ensure_manifest_editor") as download:
            self.assertEqual(0, repack.main(["--config", str(config)]))
            download.assert_not_called()


if __name__ == "__main__":
    unittest.main()
