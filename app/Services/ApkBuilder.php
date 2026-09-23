<?php

namespace App\Services;

use App\Models\ApkBuild;
use Illuminate\Support\Facades\File;
use Illuminate\Support\Facades\Process;
use Illuminate\Support\Facades\Storage;
use RuntimeException;

class ApkBuilder
{
    public function build(ApkBuild $build): array
    {
        $disk = Storage::disk('local');
        $relative = 'apk-builds/'.$build->id;
        $work = $disk->path($relative.'/source');
        if (! is_executable(config('build.gradle')) || ! is_file(config('build.sdk').'/platforms/android-35/android.jar')) {
            throw new RuntimeException('Android 构建工具尚未就绪。');
        }
        File::ensureDirectoryExists($work);
        File::copyDirectory(base_path('android-shell'), $work);
        $escape = fn (string $value) => htmlspecialchars(str_replace(['\\', '"', "'"], ['\\\\', '\\"', "\\'"], $value), ENT_XML1 | ENT_QUOTES, 'UTF-8');
        File::put($work.'/app/src/main/res/values/strings.xml', '<resources><string name="app_name">"'.$escape($build->app_name).'"</string><string name="home_url" translatable="false">'.$escape($build->home_url).'</string></resources>');
        if ($build->icon_path) {
            abort_unless(str_starts_with($build->icon_path, 'build-icons/'), 422);
            File::copy($disk->path($build->icon_path), $work.'/app/src/main/res/drawable/app_icon.png');
            File::delete($work.'/app/src/main/res/drawable/app_icon.xml');
        }
        $env = ['JAVA_HOME' => config('build.java_home'), 'ANDROID_HOME' => config('build.sdk'), 'ANDROID_SDK_ROOT' => config('build.sdk'), 'GRADLE_USER_HOME' => config('build.gradle_home'), 'ANDROID_USER_HOME' => base_path('.local-tools/android-user')];
        $result = Process::path($work)->env($env)->timeout(600)->run([config('build.gradle'), '--no-daemon', '--console=plain', 'assembleDebug', '-PshellApplicationId=dev.boundarylab.app.b'.str_replace('-', '', $build->id)]);
        $disk->put($relative.'/build.log', $result->output().$result->errorOutput());
        $apk = $work.'/app/build/outputs/apk/debug/app-debug.apk';
        if (! $result->successful() || ! is_file($apk)) {
            throw new RuntimeException('Gradle 构建失败，请查看本地构建日志。');
        }
        $verify = Process::env($env)->timeout(30)->run([config('build.sdk').'/build-tools/35.0.0/apksigner', 'verify', '--verbose', $apk]);
        if (! $verify->successful()) {
            throw new RuntimeException('APK 签名验证未通过。');
        }
        $artifact = $relative.'/browser.apk';
        $disk->put($artifact, file_get_contents($apk));

        return ['artifact_path' => $artifact, 'sha256' => hash_file('sha256', $apk), 'size' => filesize($apk)];
    }
}
