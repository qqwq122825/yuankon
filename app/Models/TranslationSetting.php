<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

class TranslationSetting extends Model
{
    protected $guarded = ['id'];

    protected $hidden = ['api_key'];

    protected function casts(): array
    {
        return ['api_key' => 'encrypted', 'enabled' => 'boolean', 'verified_at' => 'datetime'];
    }

    public static function forProject(): self
    {
        return self::firstOrNew(['project_id' => config('lab.project_id')], ['enabled' => false, 'target_language' => 'zh-CN']);
    }

    public function hasKey(): bool
    {
        return filled($this->getRawOriginal('api_key'));
    }
}
