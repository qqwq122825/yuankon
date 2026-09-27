"""Desktop JVM dispatch tests, NOT ART execution or an Android device test.

The fake InMemoryDexClassLoader deliberately does not interpret DEX bytes. These
checks exercise Java delegation, failure paths and log hygiene only.
"""
from pathlib import Path
import subprocess
import tempfile
import unittest

import test_engine as fixtures

engine = fixtures.engine
ROOT = fixtures.ROOT

STUBS = {
    "android/app/Application.java": "package android.app; public class Application {}",
    "android/app/Activity.java": "package android.app; public class Activity {}",
    "android/app/Service.java": "package android.app; public class Service {}",
    "android/content/Intent.java": "package android.content; public class Intent {}",
    "android/content/BroadcastReceiver.java": "package android.content; public class BroadcastReceiver {}",
    "android/content/ContentProvider.java": "package android.content; public class ContentProvider {}",
    "android/content/pm/ApplicationInfo.java": '''package android.content.pm;
        public class ApplicationInfo {
            public String sourceDir, packageName, appComponentFactory; public String[] splitSourceDirs;
            public ApplicationInfo() {}
            public ApplicationInfo(ApplicationInfo source) {
                sourceDir = source.sourceDir; packageName = source.packageName;
                appComponentFactory = source.appComponentFactory; splitSourceDirs = source.splitSourceDirs;
            }
        }''',
    "android/util/Log.java": '''package android.util;
        public final class Log {
            public static final StringBuilder events = new StringBuilder();
            public static int i(String tag, String msg) { events.append(tag).append(":").append(msg).append("\\n"); return 0; }
            public static int e(String tag, String msg) { return i(tag, msg); }
            public static int e(String tag, String msg, Throwable error) { return i(tag, msg); }
            public static int w(String tag, String msg) { return i(tag, msg); }
        }''',
    "dalvik/system/InMemoryDexClassLoader.java": '''package dalvik.system;
        import java.nio.ByteBuffer;
        public class InMemoryDexClassLoader extends ClassLoader {
            public final int dexCount;
            public InMemoryDexClassLoader(ByteBuffer[] buffers, ClassLoader parent) { super(parent); dexCount = buffers.length; }
        }''',
    "android/app/AppComponentFactory.java": '''package android.app;
        import android.content.*;
        import android.content.pm.ApplicationInfo;
        public class AppComponentFactory {
            public ClassLoader instantiateClassLoader(ClassLoader cl, ApplicationInfo info) { return cl; }
            public Application instantiateApplication(ClassLoader cl, String name) throws InstantiationException, IllegalAccessException, ClassNotFoundException {
                return (Application) cl.loadClass(name).newInstance();
            }
            public Activity instantiateActivity(ClassLoader cl, String name, Intent intent) throws InstantiationException, IllegalAccessException, ClassNotFoundException {
                return (Activity) cl.loadClass(name).newInstance();
            }
            public Service instantiateService(ClassLoader cl, String name, Intent intent) throws InstantiationException, IllegalAccessException, ClassNotFoundException {
                return (Service) cl.loadClass(name).newInstance();
            }
            public BroadcastReceiver instantiateReceiver(ClassLoader cl, String name, Intent intent) throws InstantiationException, IllegalAccessException, ClassNotFoundException {
                return (BroadcastReceiver) cl.loadClass(name).newInstance();
            }
            public ContentProvider instantiateProvider(ClassLoader cl, String name) throws InstantiationException, IllegalAccessException, ClassNotFoundException {
                return (ContentProvider) cl.loadClass(name).newInstance();
            }
        }''',
    "androidx/core/app/CoreComponentFactory.java": '''package androidx.core.app;
        import android.app.*;
        import android.content.*;
        import android.content.pm.ApplicationInfo;
        public class CoreComponentFactory extends AppComponentFactory {
            public static int instances, applications, activities, services, receivers, providers, loaders;
            public static String factorySeen;
            public CoreComponentFactory() { instances++; }
            public ClassLoader instantiateClassLoader(ClassLoader cl, ApplicationInfo info) {
                loaders++; factorySeen = info.appComponentFactory; return cl;
            }
            public Application instantiateApplication(ClassLoader cl, String name) throws InstantiationException, IllegalAccessException, ClassNotFoundException {
                applications++; return super.instantiateApplication(cl, name);
            }
            public Activity instantiateActivity(ClassLoader cl, String name, Intent intent) throws InstantiationException, IllegalAccessException, ClassNotFoundException {
                activities++; return super.instantiateActivity(cl, name, intent);
            }
            public Service instantiateService(ClassLoader cl, String name, Intent intent) throws InstantiationException, IllegalAccessException, ClassNotFoundException {
                services++; return super.instantiateService(cl, name, intent);
            }
            public BroadcastReceiver instantiateReceiver(ClassLoader cl, String name, Intent intent) throws InstantiationException, IllegalAccessException, ClassNotFoundException {
                receivers++; return super.instantiateReceiver(cl, name, intent);
            }
            public ContentProvider instantiateProvider(ClassLoader cl, String name) throws InstantiationException, IllegalAccessException, ClassNotFoundException {
                providers++; return super.instantiateProvider(cl, name);
            }
        }''',
    "local/apkshield/runtime/PayloadConfig.java": '''package local.apkshield.runtime;
        final class PayloadConfig {
            static byte[] lastKey;
            static byte[] key() { lastKey = new byte[32]; java.util.Arrays.fill(lastKey, (byte) 91); return lastKey; }
            static String originalFactory() { return System.getProperty("test.factory", ""); }
        }''',
    "local/apkshield/runtime/DispatchHarness.java": '''package local.apkshield.runtime;
        import android.app.*;
        import android.content.*;
        import android.content.pm.ApplicationInfo;
        import androidx.core.app.CoreComponentFactory;
        import java.nio.file.*;
        import java.util.*;
        import java.util.zip.*;
        public final class DispatchHarness {
            public static class App extends Application {}
            public static class Screen extends Activity {}
            public static class StatusService extends Service {}
            public static class ExplodingService extends Service {
                public ExplodingService() { throw new IllegalStateException("fixture-sensitive-exception-message"); }
            }
            public static class Receiver extends BroadcastReceiver {}
            public static class Provider extends ContentProvider {}
            static void require(boolean condition, String msg) { if (!condition) throw new AssertionError(msg); }
            static void dispatch(ShieldFactory factory, ClassLoader cl) throws Exception {
                require(factory.instantiateApplication(cl, App.class.getName()) instanceof App, "application routing");
                require(factory.instantiateActivity(cl, Screen.class.getName(), new Intent()) instanceof Screen, "activity routing");
                require(factory.instantiateService(cl, StatusService.class.getName(), new Intent()) instanceof StatusService, "service routing");
                require(factory.instantiateReceiver(cl, Receiver.class.getName(), new Intent()) instanceof Receiver, "receiver routing");
                require(factory.instantiateProvider(cl, Provider.class.getName()) instanceof Provider, "provider routing");
            }
            static void checkKeyWiped() {
                require(PayloadConfig.lastKey != null, "key requested");
                for (byte item : PayloadConfig.lastKey) require(item == 0, "key wiped");
            }
            public static void main(String[] args) throws Exception {
                ClassLoader parent = DispatchHarness.class.getClassLoader();
                String mode = args[0];
                if (mode.equals("default") || mode.equals("explicit-default") || mode.equals("delegate")) {
                    if (mode.equals("delegate")) System.setProperty("test.factory", CoreComponentFactory.class.getName());
                    if (mode.equals("explicit-default")) System.setProperty("test.factory", AppComponentFactory.class.getName());
                    ShieldFactory factory = new ShieldFactory();
                    dispatch(factory, parent); dispatch(factory, parent);
                    if (mode.equals("delegate")) {
                        require(CoreComponentFactory.instances == 1, "delegate cached for same classloader");
                        require(CoreComponentFactory.applications == 2 && CoreComponentFactory.activities == 2 && CoreComponentFactory.services == 2
                            && CoreComponentFactory.receivers == 2 && CoreComponentFactory.providers == 2, "all delegate calls routed");
                        dispatch(new ShieldFactory(), parent);
                        require(CoreComponentFactory.instances == 2 && CoreComponentFactory.services == 3, "factory recreation without loader hook");
                    } else require(CoreComponentFactory.instances == 0, "default does not use AndroidX");
                } else if (mode.equals("missing-class")) {
                    try { new ShieldFactory().instantiateService(parent, "missing.Fixture", new Intent()); throw new AssertionError("class failure expected"); }
                    catch (ClassNotFoundException expected) {}
                } else if (mode.equals("sensitive-exception")) {
                    try { new ShieldFactory().instantiateService(parent, ExplodingService.class.getName(), new Intent()); throw new AssertionError("constructor failure expected"); }
                    catch (IllegalStateException expected) { require(expected.getMessage().equals("fixture-sensitive-exception-message"), "exception preserved"); }
                    require(!android.util.Log.events.toString().contains("fixture-sensitive-exception-message"), "exception message omitted from logs");
                } else {
                    ApplicationInfo info = new ApplicationInfo(); info.sourceDir = args[1];
                    info.appComponentFactory = ShieldFactory.class.getName();
                    ShieldFactory factory = new ShieldFactory();
                    if (mode.equals("split")) info.splitSourceDirs = new String[]{"split.apk"};
                    if (mode.equals("load") || mode.equals("load-delegate")) {
                        if (mode.equals("load-delegate")) System.setProperty("test.factory", CoreComponentFactory.class.getName());
                        ClassLoader loaded = factory.instantiateClassLoader(parent, info);
                        require(loaded instanceof dalvik.system.InMemoryDexClassLoader, "in-memory loader returned");
                        require(((dalvik.system.InMemoryDexClassLoader) loaded).dexCount == 1, "decoded one dex");
                        checkKeyWiped();
                        require(factory.instantiateClassLoader(parent, info) == loaded, "loader cached for same parent");
                        if (mode.equals("load-delegate")) {
                            require(CoreComponentFactory.loaders == 1, "original class-loader hook invoked once");
                            require(CoreComponentFactory.factorySeen.equals(CoreComponentFactory.class.getName()), "original factory visible in copied info");
                            require(info.appComponentFactory.equals(ShieldFactory.class.getName()), "framework application info unchanged");
                        }
                        try { factory.instantiateClassLoader(new ClassLoader(parent) {}, info); throw new AssertionError("changed parent expected to fail"); }
                        catch (IllegalStateException expected) {}
                    } else {
                        try { factory.instantiateClassLoader(parent, info); throw new AssertionError("payload failure expected"); }
                        catch (IllegalStateException expected) {}
                        if (!mode.equals("split")) checkKeyWiped();
                    }
                }
                System.out.print(android.util.Log.events);
                System.out.println("DESKTOP_STUB_PASS " + mode);
            }
        }''',
}


class RuntimeDispatchTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.tools, cls.env = engine.core.toolchain({})
        cls.temp = tempfile.TemporaryDirectory()
        cls.root = Path(cls.temp.name)
        cls.classes = cls.root / "classes"
        cls.classes.mkdir()
        sources = []
        for name, content in STUBS.items():
            path = cls.root / "sources" / name
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text(content)
            sources.append(path)
        sources += list((ROOT / "java/local/apkshield/runtime").glob("*.java"))
        sources.append(ROOT / "java/PayloadTool.java")
        result = subprocess.run([str(cls.tools["javac"]), "-d", str(cls.classes), *map(str, sources)],
                                env=cls.env, capture_output=True, text=True)
        if result.returncode:
            cls.temp.cleanup()
            raise RuntimeError(result.stdout + result.stderr)
        cls.key = cls.root / "key"
        cls.key.write_bytes(bytes([91]) * 32)
        cls.plain = cls.root / "dex.zip"
        import zipfile
        with zipfile.ZipFile(cls.plain, "w") as data:
            data.writestr("classes.dex", fixtures.structural_dex())
        packed = cls.root / "payload.blp"
        result = subprocess.run([str(cls.tools["java"]), "-cp", str(cls.classes), "PayloadTool", "encrypt",
                                 str(cls.key), str(cls.plain), str(packed)], env=cls.env, capture_output=True, text=True)
        if result.returncode:
            cls.temp.cleanup()
            raise RuntimeError(result.stdout + result.stderr)
        cls.apks = {}
        for mode in ("load", "load-delegate", "missing", "tampered", "split"):
            apk = cls.root / (mode + ".apk")
            cls.apks[mode] = apk
            with zipfile.ZipFile(apk, "w") as data:
                if mode != "missing":
                    payload = bytearray(packed.read_bytes())
                    if mode == "tampered":
                        payload[-1] ^= 1
                    data.writestr(engine.PAYLOAD, payload)

    @classmethod
    def tearDownClass(cls):
        cls.temp.cleanup()

    def invoke(self, mode):
        result = subprocess.run([str(self.tools["java"]), "-cp", str(self.classes),
                                 "local.apkshield.runtime.DispatchHarness", mode,
                                 str(self.apks.get(mode, self.root / "absent.apk"))],
                                env=self.env, capture_output=True, text=True)
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertIn("DESKTOP_STUB_PASS " + mode, result.stdout)
        self.assertNotIn("5b" * 32, result.stdout.lower())
        self.assertNotIn("[91, 91", result.stdout)
        return result.stdout

    def test_default_factory_dispatch(self):
        self.invoke("default")
        self.invoke("explicit-default")

    def test_androidx_factory_dispatch_cache_and_factory_recreation(self):
        self.invoke("delegate")

    def test_component_class_exception_preserved(self):
        self.invoke("missing-class")

    def test_constructor_exception_message_not_logged(self):
        self.invoke("sensitive-exception")

    def test_loader_success_decodes_fixture_and_clears_key(self):
        self.invoke("load")

    def test_original_factory_classloader_hook_keeps_application_info_unchanged(self):
        self.invoke("load-delegate")

    def test_missing_tampered_payload_and_split_stop(self):
        for mode in ("missing", "tampered", "split"):
            with self.subTest(mode=mode):
                self.invoke(mode)


if __name__ == "__main__":
    unittest.main()
