@props(['device'])
<div class="tool-group" id="diagnostic-controls" data-base="{{ url('/devices/'.$device->id.'/diagnostics') }}">
    <h2>诊断联调</h2>
    <p class="form-hint" id="diagnostic-status" role="status">手机端会话接口已就绪；APK 采集端待接入。</p>
    <button class="tool-button primary" id="diagnostic-connect">连接已开启的诊断</button>
    <button class="tool-button rose" id="diagnostic-stop" disabled>停止诊断</button>
    <p class="form-hint">需手机端先明确开启会话。关闭网页或离开此标签页会结束查看，租约最长 10 秒。</p>
</div>
@push('scripts')<script src="{{ asset('assets/diagnostics.js') }}" defer></script>@endpush
