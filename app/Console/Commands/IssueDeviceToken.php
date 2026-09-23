<?php

namespace App\Console\Commands;

use App\Models\Device;
use Illuminate\Console\Command;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Storage;
use Illuminate\Support\Str;

class IssueDeviceToken extends Command
{
    protected $signature = 'devices:issue-token {name : Registered test device name} {--project=1}';

    protected $description = 'Register one test device and write a scoped, expiring token to a private local file';

    public function handle(): int
    {
        $name = trim($this->argument('name'));
        if ($name === '' || mb_strlen($name) > 100 || ! DB::table('projects')->where('id', $this->option('project'))->exists()) {
            $this->error('请核对设备名称和项目。');

            return self::FAILURE;
        }
        $device = Device::create(['project_id' => $this->option('project'), 'public_id' => 'API-'.Str::upper(Str::random(8)), 'name' => $name, 'source' => 'api']);
        $token = $device->createToken('diagnostic-client', ['diagnostics:write'], now()->addDays(30));
        $path = 'device-credentials/'.$device->public_id.'.json';
        $disk = Storage::disk('local');
        if (! $disk->put($path, json_encode(['device_id' => $device->id, 'public_id' => $device->public_id, 'token' => $token->plainTextToken, 'expires_at' => $token->accessToken->expires_at], JSON_PRETTY_PRINT))) {
            $token->accessToken->delete();
            $device->delete();
            $this->error('凭证文件写入失败。');

            return self::FAILURE;
        }
        chmod($disk->path($path), 0600);
        $this->info('设备已登记：'.$device->public_id.'；凭证文件：'.$disk->path($path));
        $this->line('每个安装实例使用独立凭证。该文件不放入 Git、不作为全体 APK 共享密钥。');

        return self::SUCCESS;
    }
}
