<?php

namespace App\Services;

use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\Storage;
use Illuminate\Support\Str;
use Illuminate\Validation\ValidationException;

class ScreenshotStore
{
    public function store(UploadedFile $file): string
    {
        $size = @getimagesize($file->getRealPath());
        if (! $size || ! in_array($size[2], [IMAGETYPE_PNG, IMAGETYPE_JPEG, IMAGETYPE_WEBP], true)
            || $size[0] * $size[1] > 16000000 || max($size[0], $size[1]) > 8000) {
            throw ValidationException::withMessages(['screenshot_file' => '请选择 PNG、JPEG 或 WebP；总像素上限 1600 万，单边上限 8000。']);
        }
        $image = @imagecreatefromstring(file_get_contents($file->getRealPath()));
        if ($image === false) {
            throw ValidationException::withMessages(['screenshot_file' => '图片内容解析失败。']);
        }
        // Re-encode to discard metadata and appended content. No OCR is performed.
        ob_start();
        imagepng($image);
        $png = ob_get_clean();
        imagedestroy($image);
        $path = 'screenshots/'.Str::uuid().'.png';
        if (! Storage::disk('local')->put($path, $png)) {
            throw new \RuntimeException('截图保存失败。');
        }

        return $path;
    }
}
