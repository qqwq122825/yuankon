<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Relations\HasMany;
use Illuminate\Database\Eloquent\Relations\HasOne;
use Illuminate\Foundation\Auth\User as Authenticatable;
use Laravel\Sanctum\HasApiTokens;

class Device extends Authenticatable
{
    use HasApiTokens;

    protected $guarded = ['id'];

    public function isOnline(): bool
    {
        return $this->source === 'api' && $this->last_heartbeat_at?->gt(now()->subSeconds(config('diagnostics.online_seconds')));
    }

    protected function casts(): array
    {
        return ['accessibility_enabled' => 'boolean', 'last_received_at' => 'datetime', 'last_heartbeat_at' => 'datetime'];
    }

    public function snapshots(): HasMany
    {
        return $this->hasMany(Snapshot::class);
    }

    public function latestSnapshot(): HasOne
    {
        return $this->hasOne(Snapshot::class)->latestOfMany();
    }

    public function events(): HasMany
    {
        return $this->hasMany(LabEvent::class);
    }
}
