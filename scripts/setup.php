<?php

if (PHP_VERSION_ID < 80300) {
    fwrite(STDERR, "需要 PHP 8.3 或更新版本。\n");
    exit(1);
}
chdir(dirname(__DIR__));
if (! is_file('.env')) {
    copy('.env.example', '.env');
}
if (! is_file('database/database.sqlite')) {
    touch('database/database.sqlite');
}
$env = file_get_contents('.env');
$commands = [];
if (preg_match('/^APP_KEY=\s*$/m', $env)) {
    $commands[] = 'key:generate';
}
$commands[] = 'migrate';
$commands[] = 'db:seed';
foreach ($commands as $command) {
    passthru(escapeshellarg(PHP_BINARY).' artisan '.$command.' --no-interaction', $status);
    if ($status !== 0) {
        exit($status);
    }
}
echo "\n就绪。运行 bash scripts/dev.sh 后访问 http://127.0.0.1:8877\n";
