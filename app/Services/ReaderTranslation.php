<?php

namespace App\Services;

use App\Models\TranslationSetting;
use Illuminate\Http\Client\ConnectionException;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\Http;
use Illuminate\Validation\ValidationException;

class ReaderTranslation
{
    public const ENDPOINT = 'https://translation.googleapis.com/language/translate/v2';

    public const LANGUAGES = ['zh-CN' => '简体中文', 'zh-TW' => '繁體中文', 'en' => 'English', 'ja' => '日本語', 'es' => 'Español'];

    public function translate(TranslationSetting $setting, array $labels, bool $verify = false): array
    {
        if (! $setting->hasKey()) {
            throw ValidationException::withMessages(['translation' => '请先在翻译设置中保存 API Key。']);
        }
        $cacheKey = 'reader-translation:'.$setting->project_id.':'.$setting->revision.':'.hash('sha256', json_encode($labels));
        if (! $verify && ($cached = Cache::get($cacheKey)) !== null) {
            return $cached;
        }
        try {
            $response = Http::acceptJson()->asJson()->connectTimeout(5)->timeout(12)
                ->withOptions(['allow_redirects' => false])
                ->withHeaders(['X-Goog-Api-Key' => $setting->api_key])
                ->post(self::ENDPOINT, ['q' => array_values($labels), 'source' => 'en', 'target' => $setting->target_language, 'format' => 'text', 'model' => 'nmt']);
        } catch (ConnectionException) {
            throw ValidationException::withMessages(['translation' => '翻译服务连接超时或网络异常，请检查网络后重试。']);
        }
        // Never expose or log provider error bodies, headers or request credentials.
        if (! $response->successful()) {
            $hint = match ($response->status()) {
                400, 401, 403 => '请检查 API Key、API 启用状态、密钥限制与结算设置。',
                429 => '调用额度或频率达到上限，请稍后重试。',
                default => '服务暂时异常，请稍后重试。',
            };
            throw ValidationException::withMessages(['translation' => '翻译请求失败（HTTP '.$response->status().'）。'.$hint]);
        }
        $items = strlen($response->body()) <= 65536 ? $response->json('data.translations') : null;
        if (! is_array($items) || count($items) !== count($labels)) {
            throw ValidationException::withMessages(['translation' => '翻译服务返回的数据格式不匹配。']);
        }
        $result = [];
        foreach (array_values($labels) as $index => $label) {
            $text = $items[$index]['translatedText'] ?? null;
            if (! is_string($text) || trim($text) === '' || mb_strlen($text) > 1000) {
                throw ValidationException::withMessages(['translation' => '翻译服务返回了无效文本。']);
            }
            $result[array_keys($labels)[$index]] = html_entity_decode($text, ENT_QUOTES | ENT_HTML5, 'UTF-8');
        }
        if (! $verify) {
            Cache::put($cacheKey, $result, now()->addMinutes(10));
        }

        return $result;
    }
}
