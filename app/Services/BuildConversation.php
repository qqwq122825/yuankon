<?php

namespace App\Services;

use App\Jobs\BuildApk;
use App\Models\ApkBuild;
use App\Models\BuildBot;
use Illuminate\Support\Facades\Storage;
use Illuminate\Support\Facades\Validator;

class BuildConversation
{
    public function __construct(private TelegramApi $api) {}

    public function handle(BuildBot $bot, array $update): void
    {
        $message = $update['message'] ?? null;
        if (! $message || ($message['chat']['type'] ?? '') !== 'private' || ($message['from']['is_bot'] ?? false)) {
            return;
        }
        $chat = (string) $message['chat']['id'];
        $text = trim($message['text'] ?? '');
        if (! $bot->owner_id) {
            $code = str_starts_with($text, '/start pair_') ? substr($text, 12) : '';
            if (! $code || ! $bot->pair_hash || ! $bot->pair_expires_at?->isFuture() || ! hash_equals($bot->pair_hash, hash('sha256', $code))) {
                return;
            }
            $bot->update(['owner_id' => $chat, 'pair_hash' => null, 'pair_expires_at' => null]);
            $this->api->message($bot->token, $chat, '配对成功。发送 /build 开始构建浏览器 APK；仅此账号可使用本机器人。');

            return;
        }
        if ($bot->owner_id !== $chat) {
            return;
        }
        if (in_array($text, ['/start', '/help'])) {
            $this->api->message($bot->token, $chat, "/build 开始构建\n/status 查看进度\n/apk 重新发送最近成功的 APK\n/cancel 取消当前填写\n应用名 → 图标 → HTTPS 网址 → /confirm\n此版本包含可见浏览器与无障碍开关引导，尚未接入设备采集或远程操控。");

            return;
        }
        if ($text === '/cancel') {
            $bot->update(['conversation' => null]);
            $this->api->message($bot->token, $chat, '当前填写已取消；已经排队的任务继续执行。');

            return;
        }
        if ($text === '/status' || $text === '/apk') {
            $query = ApkBuild::where('project_id', $bot->project_id)->where('chat_id', $chat);
            if ($text === '/apk') {
                $query->where('status', 'succeeded');
            }
            $build = $query->latest()->first();
            if (! $build) {
                $this->api->message($bot->token, $chat, '暂无构建记录，发送 /build 开始。');

                return;
            }
            if ($text === '/apk') {
                $this->api->call($bot->token, 'sendDocument', ['chat_id' => $chat, 'caption' => $build->app_name."\n开发签名 APK\nSHA-256: ".$build->sha256], Storage::disk('local')->path($build->artifact_path));
                $build->update(['delivery_status' => 'sent']);
            } else {
                $this->api->message($bot->token, $chat, $build->app_name.'：'.$build->status.'；文件发送：'.$build->delivery_status);
            }

            return;
        }
        if (in_array($text, ['/build', '/start build', '开启构建'])) {
            if (ApkBuild::where('project_id', $bot->project_id)->whereIn('status', ['queued', 'building'])->exists()) {
                $this->api->message($bot->token, $chat, '已有任务在构建队列中，发送 /status 查看。');

                return;
            }
            $bot->update(['conversation' => ['step' => 'name']]);
            $this->api->message($bot->token, $chat, '第 1/3 步：请输入应用名（1–40 个字符）。');

            return;
        }
        $state = $bot->conversation ?? [];
        switch ($state['step'] ?? '') {
            case 'name':
                if ($text === '' || mb_strlen($text) > 40 || preg_match('/[\x00-\x1f]/', $text) || str_starts_with($text, '/')) {
                    $this->api->message($bot->token, $chat, '应用名需为 1–40 个字符。');

                    return;
                }
                $state = ['step' => 'icon', 'app_name' => $text];
                $next = '第 2/3 步：发送 PNG/JPEG 图标（2MB 内），或发送 /default 使用默认图标。';
                break;
            case 'icon':
                $photo = $message['photo'] ?? [];
                $file = end($photo) ?: ($message['document'] ?? []);
                if ($text !== '/default' && empty($file['file_id'])) {
                    $this->api->message($bot->token, $chat, '请发送图标图片，或 /default。');

                    return;
                }
                try {
                    $state['icon_path'] = $text === '/default' ? null : $this->api->icon($bot->token, $file['file_id']);
                } catch (\RuntimeException $e) {
                    $this->api->message($bot->token, $chat, $e->getMessage().' 请重发图片，或 /default。');

                    return;
                }
                $state['step'] = 'url';
                $next = '第 3/3 步：请输入浏览器主页 HTTPS 网址。此网址仅用于打开网页，不是设备回传地址。';
                break;
            case 'url':
                if (Validator::make(['url' => $text], ['url' => 'required|url:https|max:2000'])->fails() || parse_url($text, PHP_URL_USER) || parse_url($text, PHP_URL_PASS)) {
                    $this->api->message($bot->token, $chat, '请输入完整 HTTPS 网址，不携带账号或密码。');

                    return;
                }
                $state['home_url'] = $text;
                $state['step'] = 'confirm';
                $next = "确认构建：\n应用名：".$state['app_name']."\n主页：".$text."\n浏览器壳 + 无障碍开关引导；开发签名，采集未接入。发送 /confirm 开始，/cancel 取消。";
                break;
            case 'confirm':
                if ($text !== '/confirm') {
                    $this->api->message($bot->token, $chat, '发送 /confirm 开始构建，或 /cancel 取消。');

                    return;
                }
                $build = ApkBuild::firstOrCreate(['telegram_update_id' => $update['update_id']], ['project_id' => $bot->project_id, 'chat_id' => $chat, 'app_name' => $state['app_name'], 'home_url' => $state['home_url'], 'icon_path' => $state['icon_path']]);
                $bot->update(['conversation' => null]);
                if ($build->wasRecentlyCreated) {
                    BuildApk::dispatch($build->id);
                }
                $this->api->message($bot->token, $chat, '任务已排队：'.$build->id.'。构建完成后会直接发送 APK 文件。');

                return;
            default: $this->api->message($bot->token, $chat, '发送 /build 开始构建。');

                return;
        }
        $bot->update(['conversation' => $state]);
        $this->api->message($bot->token, $chat, $next);
    }
}
