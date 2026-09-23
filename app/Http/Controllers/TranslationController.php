<?php

namespace App\Http\Controllers;

use App\Models\Snapshot;
use App\Models\TranslationSetting;
use App\Services\ReaderTranslation;
use App\Support\SampleNodeLabels;
use Illuminate\Http\Request;
use Illuminate\Support\Str;
use Illuminate\Validation\Rule;
use Illuminate\Validation\ValidationException;

class TranslationController extends Controller
{
    public function edit()
    {
        return view('settings.translation', ['setting' => TranslationSetting::forProject(), 'languages' => ReaderTranslation::LANGUAGES, 'endpoint' => ReaderTranslation::ENDPOINT]);
    }

    public function update(Request $request, ReaderTranslation $translator)
    {
        $data = $request->validate([
            'enabled' => 'required|boolean',
            'api_key' => ['nullable', 'string', 'max:256', 'regex:/^[A-Za-z0-9_-]+$/'],
            'target_language' => ['required', Rule::in(array_keys(ReaderTranslation::LANGUAGES))],
            'action' => 'required|in:save,verify',
        ]);
        $setting = TranslationSetting::forProject();
        if (($data['enabled'] || $data['action'] === 'verify') && ! filled($data['api_key'] ?? null) && ! $setting->hasKey()) {
            throw ValidationException::withMessages(['api_key' => '启用或验证翻译前，请先填写 API Key。']);
        }
        $setting->fill(['enabled' => $data['enabled'], 'target_language' => $data['target_language']]);
        if (filled($data['api_key'] ?? null)) {
            $setting->api_key = $data['api_key'];
        }
        if ($setting->isDirty() || ! $setting->exists) {
            $setting->revision = (string) Str::uuid();
            $setting->verified_at = null;
        }
        if ($data['action'] === 'verify') {
            $setting->verified_at = null;
        }
        $setting->save();
        if ($data['action'] === 'verify') {
            $result = $translator->translate($setting, ['test' => 'Research test page'], verify: true);
            $setting->update(['verified_at' => now()]);

            return to_route('translation.edit')->with('success', '配置已保存，连接验证成功。测试译文：'.$result['test']);
        }

        return to_route('translation.edit')->with('success', '翻译配置已保存；本次未调用外部 API。');
    }

    public function destroy()
    {
        TranslationSetting::where('project_id', config('lab.project_id'))->delete();

        return to_route('translation.edit')->with('success', '翻译配置已删除。');
    }

    public function translate(Request $request, int $id, ReaderTranslation $translator)
    {
        $snapshot = Snapshot::where('project_id', config('lab.project_id'))
            ->whereHas('device', fn ($query) => $query->where('project_id', config('lab.project_id')))->findOrFail($id);
        abort_if(array_diff(array_keys($request->all()), ['_token']), 422, '此接口仅处理服务端固定样例标签。');
        $labels = SampleNodeLabels::forSnapshot($snapshot);
        abort_unless($labels, 422, '当前快照没有可翻译的固定样例标签；节点正文保持省略。');
        $setting = TranslationSetting::forProject();
        abort_unless($setting->enabled, 422, '请先在设置中启用阅读器翻译。');

        return response()->json(['labels' => $translator->translate($setting, $labels), 'target' => $setting->target_language]);
    }
}
