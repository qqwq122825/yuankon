<x-layout title="阅读器翻译配置" active="translation">
    <div class="translation-settings">
        <div class="page-heading"><div><h1>阅读器翻译配置</h1><p>保存自己的 API Key，在阅读器中点击「翻译」查看译文，再次点击恢复原文。</p></div></div>
        <div class="translation-notice"><strong>按需调用，不自动上传画面</strong><p>当前版本仅翻译服务端预设的合成样例标签。截图、输入内容、密码及短信正文不参与请求。相同配置与内容缓存 10 分钟。</p></div>
        <form method="post" action="{{ route('translation.update') }}" autocomplete="off">
            @csrf @method('PUT')
            <section class="card translation-enable"><input type="hidden" name="enabled" value="0"><label class="form-check mb-0"><input class="form-check-input" type="checkbox" name="enabled" value="1" @checked(old('enabled', $setting->enabled))><span class="form-check-label">启用阅读器翻译</span></label>
                <span class="badge {{ $setting->verified_at ? 'bg-green-lt' : 'bg-secondary-lt' }}">{{ $setting->verified_at ? '上次验证 '.$setting->verified_at->format('Y-m-d H:i:s') : '尚未验证' }}</span>
            </section>
            <section class="card"><div class="card-body"><h2>翻译提供商</h2><div class="translation-provider">Google Cloud Translation · Basic v2</div>
                <div class="translation-help"><strong>配置步骤</strong><ol><li>在 Google Cloud 项目中启用 Cloud Translation API，并设置结算和调用配额。</li><li>创建 API Key，将 API 限制为 Cloud Translation API；按部署环境设置适用的调用方限制。</li><li>在下方保存密钥。点击「保存并验证」会向 Google 发送固定文案 <code>Research test page</code>，可能产生费用。</li></ol><a href="https://cloud.google.com/translate/docs/authentication" target="_blank" rel="noopener">查看 Google 官方认证说明 ↗</a></div>
            </div></section>
            <section class="card"><div class="card-body"><h2>连接参数</h2>
                <div class="mb-3"><label class="form-label" for="translation-url">Base URL</label><input class="form-control" id="translation-url" value="{{ $endpoint }}" readonly><div class="form-hint">官方固定地址；密钥仅由 PHP 服务端发送。</div></div>
                <div class="mb-3"><label class="form-label" for="translation-key">API Key</label><input class="form-control" type="password" id="translation-key" name="api_key" maxlength="256" autocomplete="new-password" placeholder="{{ $setting->hasKey() ? '已保存密钥；留空保留，需要更换时输入新 Key' : '粘贴自己的 Google API Key' }}"><div class="form-hint">{{ $setting->hasKey() ? '已加密保存 ••••••••' : '尚未保存密钥' }} · 页面不回显密钥。</div></div>
                <div class="translation-field-row"><div><label class="form-label" for="translation-model">模型</label><input class="form-control" id="translation-model" value="nmt" readonly></div><div><label class="form-label" for="translation-language">目标语言</label><select class="form-select" id="translation-language" name="target_language">@foreach($languages as $code => $label)<option value="{{ $code }}" @selected(old('target_language', $setting->target_language) === $code)>{{ $label }}</option>@endforeach</select></div></div>
            </div></section>
            <div class="translation-actions"><button class="btn btn-outline-primary" name="action" value="verify">保存并验证</button><button class="btn btn-primary" name="action" value="save">保存配置</button><span>仅保存不会请求翻译服务。</span></div>
        </form>
        @if($setting->exists)<form method="post" action="{{ route('translation.destroy') }}" class="translation-delete">@csrf @method('DELETE')<label class="form-check"><input class="form-check-input" type="checkbox" required><span class="form-check-label">确认删除已保存的翻译配置</span></label><button class="btn btn-outline-danger">删除配置</button></form>@endif
        <p class="form-hint mt-3">当前配置属于本地研究空间；子账号继承与其他翻译提供商尚未接入。更换密钥或目标语言后，需要重新验证。</p>
    </div>
</x-layout>
