<?php

namespace App\Http\Controllers;

use App\Models\ApkBuild;
use App\Models\BuildBot;
use App\Services\TelegramApi;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Storage;
use Illuminate\Support\Str;
use Illuminate\Validation\ValidationException;

class BuildController extends Controller
{
    public function index()
    {
        $builds = ApkBuild::where('project_id', config('lab.project_id'))->latest()->paginate(10);
        foreach ($builds as $build) {
            $build->has_log = Storage::disk('local')->exists('apk-builds/'.$build->id.'/build.log');
        }

        return view('builds', ['bot' => BuildBot::current(), 'builds' => $builds, 'toolchainReady' => is_executable(config('build.gradle')) && is_executable(config('build.java_home').'/bin/java') && is_file(config('build.sdk').'/platforms/android-35/android.jar') && is_executable(config('build.sdk').'/build-tools/35.0.0/apksigner')]);
    }

    public function configure(Request $request, TelegramApi $api)
    {
        $data = $request->validate(['bot_token' => ['required', 'string', 'max:180', 'regex:/^[0-9]+:[A-Za-z0-9_-]+$/']]);
        try {
            $info = $api->call($data['bot_token'], 'getMe');
        } catch (\RuntimeException $e) {
            throw ValidationException::withMessages(['bot_token' => $e->getMessage()]);
        }
        abort_unless(($info['is_bot'] ?? false) && preg_match('/^[A-Za-z0-9_]+$/', $info['username'] ?? ''), 422);
        $existing = BuildBot::current();
        if ($existing && $existing->username !== $info['username']) {
            throw ValidationException::withMessages(['bot_token' => '当前已绑定其他机器人，请先核对配置，避免切换时串用构建记录。']);
        }
        BuildBot::updateOrCreate(['project_id' => config('lab.project_id')], ['token' => $data['bot_token'], 'username' => $info['username']]);

        return to_route('builds')->with('success', '机器人连接已验证。接下来生成一次性配对链接。');
    }

    public function pair()
    {
        $bot = BuildBot::current();
        abort_unless($bot, 404);
        abort_if($bot->owner_id, 409, '机器人已完成配对。');
        $code = Str::random(32);
        $bot->update(['pair_hash' => hash('sha256', $code), 'pair_expires_at' => now()->addMinutes(30)]);

        return to_route('builds')->with('pair_link', 'https://t.me/'.$bot->username.'?start=pair_'.$code);
    }

    public function artifact(string $id)
    {
        $build = ApkBuild::where('project_id', config('lab.project_id'))->findOrFail($id);
        abort_unless($build->status === 'succeeded' && $build->artifact_path && Storage::disk('local')->exists($build->artifact_path), 404);

        return response()->download(Storage::disk('local')->path($build->artifact_path), 'browser-'.substr($build->id, 0, 8).'.apk', ['Content-Type' => 'application/vnd.android.package-archive']);
    }

    public function log(string $id)
    {
        $build = ApkBuild::where('project_id', config('lab.project_id'))->findOrFail($id);
        $path = 'apk-builds/'.$build->id.'/build.log';
        abort_unless(Storage::disk('local')->exists($path), 404);

        return response(Storage::disk('local')->get($path), 200, ['Content-Type' => 'text/plain; charset=utf-8']);
    }
}
