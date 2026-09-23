<?php

namespace App\Services;

use App\Models\Device;
use App\Models\LabEvent;
use App\Models\Snapshot;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Storage;
use Illuminate\Support\Facades\Validator;
use Illuminate\Support\Str;
use Illuminate\Validation\ValidationException;

class SnapshotImporter
{
    public function __construct(private SnapshotNormalizer $normalizer, private ScreenshotStore $screenshots) {}

    public function import(array $attributes, UploadedFile $json, ?UploadedFile $image): Snapshot
    {
        Validator::make([...$attributes, 'snapshot_file' => $json, 'screenshot_file' => $image], [
            'device_id' => 'nullable|integer|min:1', 'name' => 'required_without:device_id|nullable|string|max:100',
            'brand' => 'nullable|string|max:50', 'android_version' => 'nullable|string|max:30',
            'snapshot_file' => 'required|file|max:2048', 'screenshot_file' => 'nullable|file|max:8192',
        ])->validate();
        $attributes += ['brand' => '', 'android_version' => ''];
        try {
            $input = json_decode(file_get_contents($json->getRealPath()), true, 64, JSON_THROW_ON_ERROR);
        } catch (\JsonException) {
            throw ValidationException::withMessages(['snapshot_file' => 'JSON 解析失败，请检查文件格式。']);
        }
        if (! is_array($input)) {
            throw ValidationException::withMessages(['snapshot_file' => '快照顶层应为 JSON 对象。']);
        }
        $payload = $this->normalizer->normalize($input);
        $device = ! empty($attributes['device_id'])
            ? Device::where('project_id', config('lab.project_id'))->findOrFail($attributes['device_id']) : null;
        $path = $image ? $this->screenshots->store($image) : null;
        try {
            return DB::transaction(function () use ($attributes, $device, $payload, $path) {
                $device ??= Device::create([
                    'project_id' => config('lab.project_id'), 'public_id' => 'LAB-'.Str::upper(Str::random(8)),
                    'name' => $attributes['name'], 'brand' => $attributes['brand'] ?: '测试设备',
                    'android_version' => $attributes['android_version'] ?: '待记录', 'source' => 'import',
                ]);
                $snapshot = $device->snapshots()->create([
                    'project_id' => config('lab.project_id'), 'source' => 'import',
                    'captured_at' => $payload['captured_at'], 'payload' => $payload,
                    'node_count' => array_sum(array_map(fn ($w) => count($w['nodes']), $payload['windows'])),
                    'window_count' => count($payload['windows']), 'screenshot_path' => $path,
                ]);
                $device->update(['last_received_at' => now()]);
                LabEvent::create([
                    'project_id' => config('lab.project_id'), 'device_id' => $device->id, 'kind' => 'snapshot_imported',
                    'summary' => '手动导入快照 #'.$snapshot->id.'；已执行结构校验与节点正文字段剔除。',
                    'source' => 'import', 'occurred_at' => now(),
                ]);

                return $snapshot;
            });
        } catch (\Throwable $e) {
            if ($path) {
                Storage::disk('local')->delete($path);
            }
            throw $e;
        }
    }
}
