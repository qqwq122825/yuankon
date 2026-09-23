<?php

namespace App\Services;

use Illuminate\Http\Client\ConnectionException;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Storage;
use Illuminate\Support\Str;
use RuntimeException;

class TelegramApi
{
    public function call(string $token, string $method, array $data = [], ?string $document = null): array
    {
        try {
            $http = Http::connectTimeout(10)->timeout($method === 'sendDocument' ? 90 : 40)->withOptions(['allow_redirects' => false]);
            if ($document) {
                $http = $http->attach('document', fopen($document, 'rb'), 'browser.apk');
            }
            $response = $http->post('https://api.telegram.org/bot'.$token.'/'.$method, $data);
        } catch (ConnectionException) {
            throw new RuntimeException('Telegram 连接异常，请检查网络。');
        }
        if (! $response->successful() || ! $response->json('ok')) {
            throw new RuntimeException('Telegram 请求未成功，请检查配置或稍后重试。');
        }

        return $response->json('result') ?? [];
    }

    public function message(string $token, string $chat, string $text): void
    {
        $this->call($token, 'sendMessage', ['chat_id' => $chat, 'text' => $text]);
    }

    public function icon(string $token, string $fileId): string
    {
        $info = $this->call($token, 'getFile', ['file_id' => $fileId]);
        if (($info['file_size'] ?? 0) > 2 * 1024 * 1024 || ! preg_match('~^(photos|documents)/[A-Za-z0-9_.-]+$~', $info['file_path'] ?? '')) {
            throw new RuntimeException('图标需为 2MB 内的 PNG/JPEG 图片。');
        }
        try {
            $response = Http::connectTimeout(10)->timeout(30)->withOptions(['allow_redirects' => false])->get('https://api.telegram.org/file/bot'.$token.'/'.$info['file_path']);
        } catch (ConnectionException) {
            throw new RuntimeException('图标下载超时，请重试。');
        }
        $body = $response->body();
        $size = @getimagesizefromstring($body);
        if (! $response->successful() || strlen($body) > 2 * 1024 * 1024 || ! $size || $size[0] * $size[1] > 4000000 || ! in_array($size[2], [IMAGETYPE_PNG, IMAGETYPE_JPEG])) {
            throw new RuntimeException('图标格式或尺寸不合要求。');
        }
        $source = imagecreatefromstring($body);
        $image = imagecreatetruecolor(512, 512);
        imagefill($image, 0, 0, imagecolorallocate($image, 255, 255, 255));
        $edge = min($size[0], $size[1]);
        imagecopyresampled($image, $source, 0, 0, (int) (($size[0] - $edge) / 2), (int) (($size[1] - $edge) / 2), 512, 512, $edge, $edge);
        $path = 'build-icons/'.Str::uuid().'.png';
        $disk = Storage::disk('local');
        $disk->makeDirectory('build-icons');
        imagepng($image, $disk->path($path));
        imagedestroy($source);
        imagedestroy($image);

        return $path;
    }
}
