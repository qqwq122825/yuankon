<?php

namespace App\Jobs;

use App\Models\ApkBuild;
use App\Models\BuildBot;
use App\Services\ApkBuilder;
use App\Services\TelegramApi;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Foundation\Queue\Queueable;
use Illuminate\Support\Facades\Storage;

class BuildApk implements ShouldQueue
{
    use Queueable;

    public int $timeout = 780;

    public int $tries = 1;

    public function __construct(public string $buildId)
    {
        $this->onQueue('apk');
    }

    public function handle(ApkBuilder $builder, TelegramApi $api): void
    {
        if (! ApkBuild::whereKey($this->buildId)->where('status', 'queued')->update(['status' => 'building'])) {
            return;
        }
        $build = ApkBuild::findOrFail($this->buildId);
        try {
            $build->update([...$builder->build($build), 'status' => 'succeeded']);
        } catch (\Throwable) {
            $build->update(['status' => 'failed', 'error' => '构建未完成，请在本地构建中心检查工具链及日志。']);
        }
        $bot = BuildBot::where('project_id', $build->project_id)->first();
        if (! $bot || ! $build->chat_id || $bot->owner_id !== $build->chat_id) {
            return;
        }
        try {
            if ($build->status === 'succeeded') {
                $api->call($bot->token, 'sendDocument', ['chat_id' => $build->chat_id, 'caption' => $build->app_name."\n浏览器壳 APK · 开发签名\nSHA-256: ".$build->sha256], Storage::disk('local')->path($build->artifact_path));
                $build->update(['delivery_status' => 'sent']);
            } else {
                $api->message($bot->token, $build->chat_id, $build->error);
            }
        } catch (\Throwable) {
            $build->update(['delivery_status' => 'failed']);
        }
    }

    public function failed(?\Throwable $error): void
    {
        ApkBuild::whereKey($this->buildId)->whereIn('status', ['queued', 'building'])->update(['status' => 'failed', 'error' => '构建进程中断或超时，请重新发起构建。']);
    }
}
