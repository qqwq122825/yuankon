<?php

namespace App\Console\Commands;

use App\Models\DiagnosticSession;
use App\Services\DiagnosticSessions;
use Illuminate\Console\Command;

class PruneDiagnostics extends Command
{
    protected $signature = 'diagnostics:prune';

    protected $description = 'Expire inactive diagnostic sessions and delete their temporary images and node previews';

    public function handle(DiagnosticSessions $sessions): int
    {
        DiagnosticSession::whereIn('status', ['waiting', 'active'])->chunkById(100, function ($batch) use ($sessions) {
            foreach ($batch as $session) {
                $sessions->refresh($session);
            }
        });
        $this->info('诊断会话到期检查完成。');

        return self::SUCCESS;
    }
}
