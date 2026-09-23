<?php

namespace App\Support;

use App\Models\Snapshot;
use Illuminate\Database\Eloquent\Builder;

final class DeviceTableSort
{
    public const COLUMNS = [
        'id' => 'devices.public_id',
        'name' => 'devices.name',
        'note' => 'devices.note',
        'source' => 'devices.source',
        'brand' => 'devices.brand',
        'android' => 'devices.android_version',
        'snapshots' => 'snapshots_count',
        'battery' => 'devices.battery',
        'a11y' => 'devices.accessibility_enabled',
        'nodes' => 'sort_nodes',
        'windows' => 'sort_windows',
        'last_seen' => 'devices.last_received_at',
    ];

    public static function apply(Builder $query, string $field, string $direction): Builder
    {
        // Only fixed SQL identifiers and directions reach orderByRaw below.
        if (! array_key_exists($field, self::COLUMNS) || ! in_array($direction, ['asc', 'desc'], true)) {
            throw new \InvalidArgumentException('Invalid device ordering.');
        }
        $column = self::COLUMNS[$field];
        if (in_array($field, ['nodes', 'windows'], true)) {
            $metric = $field === 'nodes' ? 'node_count' : 'window_count';
            $query->addSelect([$column => Snapshot::select($metric)
                ->whereColumn('device_id', 'devices.id')
                ->whereColumn('project_id', 'devices.project_id')
                ->latest('id')->limit(1)]);
        }
        // Absent measurements stay at the end in both directions.
        $query->orderByRaw($column.' IS NULL ASC');
        if ($field === 'android') {
            $query->orderByRaw("CASE WHEN devices.android_version IN ('', '待记录', '—') THEN 1 ELSE 0 END ASC")
                ->orderByRaw('CAST(devices.android_version AS DECIMAL(10,3)) '.$direction);
        } else {
            $query->orderBy($column, $direction);
        }

        // Deterministic tie-breaker keeps pagination stable for equal values.
        return $query->orderBy('devices.id', 'asc');
    }
}
