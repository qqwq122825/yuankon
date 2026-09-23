<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

class BuildBot extends Model
{
    protected $guarded = ['id'];

    protected $hidden = ['token', 'pair_hash'];

    protected function casts(): array
    {
        return ['token' => 'encrypted', 'conversation' => 'array', 'pair_expires_at' => 'datetime', 'polled_at' => 'datetime'];
    }

    public static function current(): ?self
    {
        return self::where('project_id', config('lab.project_id'))->first();
    }
}
