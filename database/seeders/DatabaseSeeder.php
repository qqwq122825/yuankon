<?php

namespace Database\Seeders;

use App\Models\Device;
use App\Models\LabEvent;
use App\Services\SnapshotNormalizer;
use Illuminate\Database\Seeder;
use Illuminate\Support\Facades\DB;

class DatabaseSeeder extends Seeder
{
    public function run(): void
    {
        DB::table('projects')->insertOrIgnore(['id' => 1, 'name' => '本地研究空间', 'created_at' => now(), 'updated_at' => now()]);
        $examples = [
            ['Pixel 8', 'Google', '15', true, 86, '设置页面 · 基础控件'],
            ['Galaxy S23', 'Samsung', '14', true, 72, '多窗口结构对照'],
            ['Android Emulator', 'AVD', '15', true, 100, '进程回收后重新连接'],
            ['Pixel 7', 'Google', '14', false, 45, '服务关闭 · 空结果样例'],
            ['Xiaomi 14', 'Xiaomi', '14', true, 64, '最近任务清理观察'],
            ['Galaxy A54', 'Samsung', '14', true, 38, '尚未导入快照'],
        ];
        foreach ($examples as $index => [$name, $brand, $android, $enabled, $battery, $note]) {
            $publicId = 'DEMO-'.str_pad((string) ($index + 1), 3, '0', STR_PAD_LEFT);
            if (Device::where('public_id', $publicId)->exists()) {
                continue;
            }
            $time = now()->subMinutes(4 + $index * 11);
            $device = Device::create(['project_id' => 1, 'public_id' => $publicId, 'name' => $name, 'brand' => $brand,
                'android_version' => $android, 'accessibility_enabled' => $enabled, 'battery' => $battery,
                'note' => $note, 'source' => 'sample', 'last_received_at' => $index === 5 ? null : $time]);
            if ($index < 5) {
                $input = json_decode(file_get_contents(resource_path('fixtures/example-snapshot.json')), true);
                $input['captured_at'] = $time->toIso8601String();
                if (! $enabled) {
                    $input['windows'] = [['id' => 'unknown-1', 'type' => 'unknown', 'root_status' => 'null_root', 'nodes' => []]];
                }
                $payload = app(SnapshotNormalizer::class)->normalize($input);
                $device->snapshots()->create(['project_id' => 1, 'source' => 'sample', 'captured_at' => $time,
                    'payload' => $payload, 'window_count' => count($payload['windows']),
                    'node_count' => array_sum(array_map(fn ($w) => count($w['nodes']), $payload['windows'])),
                    'screenshot_path' => $enabled ? 'demo:settings' : null]);
            }
            foreach ([['service_connected', '示例：系统绑定无障碍服务'], ['snapshot_created', '示例：读取结构快照，保留节点元数据']] as $offset => [$kind, $summary]) {
                LabEvent::create(['project_id' => 1, 'device_id' => $device->id, 'source' => 'sample', 'kind' => $kind,
                    'summary' => $enabled ? $summary : '示例：无障碍服务关闭，根节点为空', 'occurred_at' => $time->copy()->subSeconds(30 - $offset * 15)]);
            }
        }
    }
}
