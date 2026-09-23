<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasOne;

class DiagnosticSession extends Model
{
    public $incrementing = false;

    protected $keyType = 'string';

    protected $guarded = ['id'];

    protected $hidden = ['viewer_hash'];

    protected function casts(): array
    {
        return ['expires_at' => 'datetime', 'lease_expires_at' => 'datetime', 'stopped_at' => 'datetime'];
    }

    public function device(): BelongsTo
    {
        return $this->belongsTo(Device::class);
    }

    public function snapshot(): HasOne
    {
        return $this->hasOne(Snapshot::class);
    }
}
