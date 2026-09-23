<?php

namespace App\Services;

use Carbon\CarbonImmutable;
use Illuminate\Support\Facades\Validator;
use Illuminate\Validation\ValidationException;

class SnapshotNormalizer
{
    public function __construct(private ObservationNormalizer $observations) {}

    public function normalize(array $input): array
    {
        Validator::make($input, [
            'schema_version' => 'required|integer|in:1',
            'captured_at' => 'required|string|date',
            'display' => 'required|array',
            'display.width' => 'required|integer|between:1,10000',
            'display.height' => 'required|integer|between:1,10000',
            'windows' => 'present|array|list|max:16',
            'windows.*.id' => 'required|string|max:80',
            'windows.*.type' => 'required|string|in:application,system,input_method,accessibility_overlay,unknown',
            'windows.*.package' => 'nullable|string|max:200',
            'windows.*.root_status' => 'required|in:available,null_root,locked_skipped,filtered,error',
            'windows.*.active' => 'sometimes|boolean',
            'windows.*.focused' => 'sometimes|boolean',
            'windows.*.nodes' => 'present|array|list|max:2000',
            'windows.*.nodes.*.id' => 'required|string|max:100',
            'windows.*.nodes.*.parent_id' => 'nullable|string|max:100',
            'windows.*.nodes.*.class_name' => 'required|string|max:200',
            'windows.*.nodes.*.view_id' => 'nullable|string|max:250',
            'windows.*.nodes.*.bounds' => 'required|array|list|size:4',
            'windows.*.nodes.*.bounds.*' => 'required|integer|between:-32768,32768',
            'windows.*.nodes.*.flags' => 'sometimes|array',
            'windows.*.nodes.*.flags.*' => 'nullable|boolean',
            'windows.*.nodes.*.text_present' => 'sometimes|boolean',
            'diagnostics.elapsed_ms' => 'sometimes|nullable|integer|between:0,3600000',
            'diagnostics.truncated' => 'sometimes|boolean',
            'observations' => 'sometimes|array|list|max:100',
        ])->validate();

        $count = 0;
        $windowIds = [];
        $windows = [];
        foreach ($input['windows'] as $window) {
            if (isset($windowIds[$window['id']])) {
                $this->invalid('窗口 ID 重复。');
            }
            $windowIds[$window['id']] = true;
            $parents = [];
            foreach ($window['nodes'] as $node) {
                if (array_key_exists($node['id'], $parents)) {
                    $this->invalid('同一窗口内的节点 ID 应保持唯一。');
                }
                $parents[$node['id']] = $node['parent_id'] ?? null;
            }
            $nodes = [];
            foreach ($window['nodes'] as $node) {
                if (++$count > config('lab.max_nodes')) {
                    $this->invalid('单个快照最多包含 2000 个节点。');
                }
                $depth = 0;
                $seen = [$node['id'] => true];
                $parent = $parents[$node['id']];
                while ($parent !== null) {
                    if (! array_key_exists($parent, $parents) || isset($seen[$parent])) {
                        $this->invalid('节点父子关系存在循环或缺失引用。');
                    }
                    $seen[$parent] = true;
                    if (++$depth > config('lab.max_depth')) {
                        $this->invalid('节点树深度超过 32 层。');
                    }
                    $parent = $parents[$parent];
                }
                [$left, $top, $right, $bottom] = $node['bounds'];
                if ($right < $left || $bottom < $top) {
                    $this->invalid('节点坐标应满足 right ≥ left、bottom ≥ top。');
                }
                $flags = [];
                foreach (['visible', 'enabled', 'clickable', 'scrollable', 'editable', 'password', 'sensitive', 'focused'] as $flag) {
                    $flags[$flag] = isset($node['flags'][$flag]) ? (bool) $node['flags'][$flag] : null;
                }
                // Construct a whitelist DTO; never persist arbitrary source text, extras or event bodies.
                $nodes[] = [
                    'id' => $node['id'], 'parent_id' => $node['parent_id'] ?? null, 'depth' => $depth,
                    'class_name' => $node['class_name'], 'view_id' => $node['view_id'] ?? null,
                    'bounds' => $node['bounds'], 'flags' => $flags,
                    'text_present' => (bool) ($node['text_present'] ?? isset($node['text'])),
                    'text_policy' => 'omitted',
                ];
            }
            if ($window['root_status'] !== 'available' && count($nodes) > 0) {
                $this->invalid('非 available 窗口应使用空节点列表。');
            }
            $windows[] = [
                'id' => $window['id'], 'type' => $window['type'], 'package' => $window['package'] ?? null,
                'active' => isset($window['active']) ? (bool) $window['active'] : null,
                'focused' => isset($window['focused']) ? (bool) $window['focused'] : null,
                'root_status' => $window['root_status'], 'nodes' => $nodes,
            ];
        }

        return [
            'schema_version' => 1,
            'captured_at' => CarbonImmutable::parse($input['captured_at'])->toIso8601String(),
            'display' => ['width' => (int) $input['display']['width'], 'height' => (int) $input['display']['height']],
            'windows' => $windows,
            'observations' => $this->observations->normalize($input['observations'] ?? []),
            'diagnostics' => [
                'elapsed_ms' => $input['diagnostics']['elapsed_ms'] ?? null,
                'truncated' => (bool) ($input['diagnostics']['truncated'] ?? false),
                'text_policy' => 'omitted',
            ],
        ];
    }

    private function invalid(string $message): never
    {
        throw ValidationException::withMessages(['snapshot_file' => $message]);
    }
}
