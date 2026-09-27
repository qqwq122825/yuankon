package local.apkshield.runtime;

import android.app.AppComponentFactory;
import android.app.Activity;
import android.app.Application;
import android.app.Service;
import android.content.BroadcastReceiver;
import android.content.ContentProvider;
import android.content.Intent;
import android.content.pm.ApplicationInfo;
import android.util.Log;
import dalvik.system.InMemoryDexClassLoader;
import java.io.InputStream;
import java.nio.ByteBuffer;
import java.util.Arrays;
import java.util.zip.ZipEntry;
import java.util.zip.ZipFile;

/** API 29+ public class-loader hook; no hidden API or framework-field patching. */
public final class ShieldFactory extends AppComponentFactory {
    private static final String TAG = "APKShield";
    private static final String CORE_FACTORY = "androidx.core.app.CoreComponentFactory";
    private ClassLoader loadedParent;
    private ClassLoader loadedClassLoader;
    private String loadedSource;
    private ClassLoader delegateClassLoader;
    private AppComponentFactory delegate;

    @Override
    public synchronized ClassLoader instantiateClassLoader(ClassLoader parent, ApplicationInfo info) {
        long started = begin("classloader", "ClassLoader", InMemoryDexClassLoader.class.getName());
        byte[] key = null;
        String stage = "classloader.validate";
        try {
            if (parent == null || info == null || info.sourceDir == null) {
                throw new IllegalStateException("APK Shield requires a class loader and APK source path");
            }
            Log.i(TAG, "stage=classloader package=" + safeName(info.packageName));
            if (info.splitSourceDirs != null && info.splitSourceDirs.length > 0) {
                throw new IllegalStateException("APK Shield prototype expects a standalone APK");
            }
            if (loadedClassLoader != null) {
                if (parent != loadedParent || !info.sourceDir.equals(loadedSource)) {
                    throw new IllegalStateException("APK Shield factory received a different parent or APK source");
                }
                Log.i(TAG, "stage=classloader status=reused");
                success("classloader", "ClassLoader", loadedClassLoader.getClass().getName(), started);
                return loadedClassLoader;
            }
            stage = "payload.read";
            key = PayloadConfig.key();
            ByteBuffer[] buffers;
            long readStarted = begin(stage, "Payload", "container");
            byte[] packed;
            try (ZipFile apk = new ZipFile(info.sourceDir)) {
                ZipEntry entry = apk.getEntry("assets/apk-shield/payload.blp");
                if (entry == null) throw new IllegalStateException("APK Shield payload is missing");
                try (InputStream input = apk.getInputStream(entry)) {
                    packed = PayloadCodec.readBounded(input, PayloadCodec.MAX_BYTES + 32);
                }
            }
            success(stage, "Payload", "container", readStarted);
            stage = "payload.decode";
            buffers = PayloadCodec.decode(packed, key, new PayloadCodec.StageListener() {
                @Override
                public void started(String stage) {
                    Log.i(TAG, "stage=" + stage + " status=started");
                }

                @Override
                public void completed(String stage, long elapsedNanos, int count, int bytes) {
                    Log.i(TAG, "stage=" + stage + " status=ok elapsed_ms=" + millis(elapsedNanos)
                        + " dex_count=" + count + " bytes=" + bytes);
                }

                @Override
                public void failed(String stage, long elapsedNanos, Throwable error) {
                    failure(stage, "Payload", "container", System.nanoTime() - elapsedNanos, error);
                }
            });
            stage = "classloader.create";
            long createStarted = begin(stage, "ClassLoader", InMemoryDexClassLoader.class.getName());
            ClassLoader loader = new InMemoryDexClassLoader(buffers, parent);
            success(stage, "ClassLoader", loader.getClass().getName(), createStarted);
            stage = "factory.classloader";
            long hookStarted = begin(stage, "Factory", PayloadConfig.originalFactory());
            // CoreComponentFactory inherits the public no-op class-loader hook. Keep the original
            // factory visible to its hook, without changing the framework's ApplicationInfo.
            ApplicationInfo originalInfo = new ApplicationInfo(info);
            String original = PayloadConfig.originalFactory();
            originalInfo.appComponentFactory = original.isEmpty() ? null : original;
            ClassLoader selected = factoryFor(loader).instantiateClassLoader(loader, originalInfo);
            if (selected != loader) {
                throw new IllegalStateException("APK Shield supports only the original factory's default class-loader hook");
            }
            success(stage, "Factory", original, hookStarted);
            loadedParent = parent;
            loadedClassLoader = loader;
            loadedSource = info.sourceDir;
            success("classloader", "ClassLoader", loader.getClass().getName(), started);
            return loader;
        } catch (Exception | LinkageError error) {
            failure(stage, "ClassLoader", InMemoryDexClassLoader.class.getName(), started, error);
            throw new IllegalStateException("APK Shield startup failed at " + stage, error);
        } finally {
            if (key != null) Arrays.fill(key, (byte) 0);
        }
    }

    @Override
    public Application instantiateApplication(ClassLoader loader, String className)
            throws InstantiationException, IllegalAccessException, ClassNotFoundException {
        return instantiate("Application", loader, className,
            factory -> factory.instantiateApplication(loader, className));
    }

    @Override
    public Activity instantiateActivity(ClassLoader loader, String className, Intent intent)
            throws InstantiationException, IllegalAccessException, ClassNotFoundException {
        return instantiate("Activity", loader, className,
            factory -> factory.instantiateActivity(loader, className, intent));
    }

    @Override
    public Service instantiateService(ClassLoader loader, String className, Intent intent)
            throws InstantiationException, IllegalAccessException, ClassNotFoundException {
        return instantiate("Service", loader, className,
            factory -> factory.instantiateService(loader, className, intent));
    }

    @Override
    public BroadcastReceiver instantiateReceiver(ClassLoader loader, String className, Intent intent)
            throws InstantiationException, IllegalAccessException, ClassNotFoundException {
        return instantiate("Receiver", loader, className,
            factory -> factory.instantiateReceiver(loader, className, intent));
    }

    @Override
    public ContentProvider instantiateProvider(ClassLoader loader, String className)
            throws InstantiationException, IllegalAccessException, ClassNotFoundException {
        return instantiate("Provider", loader, className,
            factory -> factory.instantiateProvider(loader, className));
    }

    private interface Instantiator<T> {
        T create(AppComponentFactory factory)
            throws InstantiationException, IllegalAccessException, ClassNotFoundException;
    }

    private <T> T instantiate(String kind, ClassLoader loader, String className, Instantiator<T> action)
            throws InstantiationException, IllegalAccessException, ClassNotFoundException {
        long started = begin("component.create", kind, className);
        try {
            T result = action.create(factoryFor(loader));
            if (result == null) throw new IllegalStateException("Component factory returned null");
            success("component.create", kind, className, started);
            return result;
        } catch (InstantiationException | IllegalAccessException | ClassNotFoundException
                | RuntimeException | LinkageError error) {
            failure("component.create", kind, className, started, error);
            throw error;
        }
    }

    private synchronized AppComponentFactory factoryFor(ClassLoader loader) {
        if (loader == null) throw new IllegalStateException("Component class loader is missing");
        if (delegate != null && delegateClassLoader == loader) return delegate;
        String original = PayloadConfig.originalFactory();
        String name = original.isEmpty() ? AppComponentFactory.class.getName() : original;
        long started = begin("factory.create", "Factory", name);
        try {
            AppComponentFactory instance;
            if (original.isEmpty() || AppComponentFactory.class.getName().equals(original)) {
                instance = new AppComponentFactory();
            } else {
                if (!CORE_FACTORY.equals(original)) {
                    throw new IllegalStateException("Unsupported original component factory");
                }
                instance = loader.loadClass(original).asSubclass(AppComponentFactory.class)
                    .getDeclaredConstructor().newInstance();
            }
            // Android can recreate this factory without calling instantiateClassLoader on the
            // new instance. Rebuild the delegate lazily from the loader supplied by the framework.
            delegateClassLoader = loader;
            delegate = instance;
            success("factory.create", "Factory", name, started);
            return instance;
        } catch (ReflectiveOperationException | RuntimeException | LinkageError error) {
            failure("factory.create", "Factory", name, started, error);
            throw new IllegalStateException("APK Shield original component factory creation failed", error);
        }
    }

    private static long begin(String stage, String kind, String name) {
        Log.i(TAG, "stage=" + stage + " status=started component=" + kind + " class=" + safeName(name));
        return System.nanoTime();
    }

    private static void success(String stage, String kind, String name, long started) {
        Log.i(TAG, "stage=" + stage + " status=ok component=" + kind + " class=" + safeName(name)
            + " elapsed_ms=" + millis(System.nanoTime() - started));
    }

    private static String millis(long nanos) {
        return Long.toString(Math.max(0, nanos) / 1000000);
    }

    private static String safeName(String value) {
        if (value == null) return "<null>";
        String limited = value.substring(0, Math.min(value.length(), 256));
        return limited.replaceAll("[^A-Za-z0-9_.$<>-]", "?");
    }

    private static void failure(String stage, String kind, String name, long started, Throwable error) {
        Log.e(TAG, "stage=" + stage + " status=failed component=" + kind + " class=" + safeName(name)
            + " elapsed_ms=" + millis(System.nanoTime() - started)
            + " error_type=" + error.getClass().getName());
        // Constructor errors may contain user data. Emit bounded type/stack metadata only, never
        // an arbitrary Throwable message, Intent contents, key, DEX bytes, or decoded webpage data.
        Throwable cause = error;
        for (int depth = 0; cause != null && depth < 8; depth++) {
            Log.e(TAG, "stage=" + stage + " cause_depth=" + depth
                + " error_type=" + cause.getClass().getName());
            StackTraceElement[] stack = cause.getStackTrace();
            for (int index = 0; index < Math.min(stack.length, 8); index++) {
                StackTraceElement frame = stack[index];
                Log.e(TAG, "stage=" + stage + " frame=" + index + " at="
                    + safeName(frame.getClassName()) + "." + safeName(frame.getMethodName())
                    + " line=" + frame.getLineNumber());
            }
            if (cause.getCause() == cause) break;
            cause = cause.getCause();
        }
    }
}
