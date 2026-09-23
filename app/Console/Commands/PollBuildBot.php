<?php

namespace App\Console\Commands;

use App\Models\BuildBot;
use App\Services\BuildConversation;
use App\Services\TelegramApi;
use Illuminate\Console\Command;

class PollBuildBot extends Command
{
    protected $signature = 'build-bot:poll {--once : Process one batch and exit}';

    protected $description = 'Poll the paired private APK build bot; no inbound public endpoint needed';

    public function handle(TelegramApi $api, BuildConversation $conversation): int
    {
        // One poller on this build host. The OS releases this lock if the process exits.
        $lock = fopen(storage_path('framework/cache/build-bot-'.config('lab.project_id').'.lock'), 'c');
        if (! $lock || ! flock($lock, LOCK_EX | LOCK_NB)) {
            $this->error('已有轮询实例，或锁文件目录未就绪。');

            return self::FAILURE;
        }
        $this->info('构建机器人轮询启动。');
        try {
            do {
                try {
                    $bot = BuildBot::current();
                    if (! $bot) {
                        $this->error('请先在构建中心配置机器人。');

                        return self::FAILURE;
                    }
                    $updates = $api->call($bot->token, 'getUpdates', ['offset' => $bot->update_offset, 'timeout' => $this->option('once') ? 0 : 25, 'allowed_updates' => ['message']]);
                    $bot->update(['polled_at' => now()]);
                    foreach ($updates as $update) {
                        $bot->refresh();
                        if ($update['update_id'] < $bot->update_offset) {
                            continue;
                        }
                        // Checkpoint before outbound replies; commands can be resumed with /build, /status or /apk.
                        $bot->update(['update_offset' => $update['update_id'] + 1]);
                        try {
                            $conversation->handle($bot, $update);
                        } catch (\Throwable) {
                            $this->warn('一条消息处理失败。可重发当前输入或使用 /status。');
                        }
                    }
                } catch (\Throwable) {
                    $this->warn('Telegram 连接失败，稍后重试。');
                    if ($this->option('once')) {
                        return self::FAILURE;
                    }
                    sleep(5);
                }
            } while (! $this->option('once'));
        } finally {
            flock($lock, LOCK_UN);
            fclose($lock);
        }

        return self::SUCCESS;
    }
}
