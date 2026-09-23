<x-layout title="构建中心" active="builds">
<div class="translation-settings">
    <div class="page-heading"><div><h1>APK 构建中心</h1><p>在 Telegram 填写应用名、图标和主页网址，构建完成后直接收到 APK。</p></div></div>
    <div class="translation-notice"><strong>浏览器壳 · 本地构建优先</strong><p>APK 包含 HTTPS 浏览器与无障碍开关引导：服务未开启时显示说明，已开启时直接浏览主页；当前尚未接入截图、节点采集、短信访问或远程控制。电脑保持联网并运行轮询与构建进程即可；本阶段不需要把免登录后台开放到公网。</p></div>
    <section class="card"><div class="card-body"><h2>构建状态</h2><div class="d-flex gap-3"><span class="badge {{ $toolchainReady ? 'bg-green-lt':'bg-orange-lt' }}">Android 工具链：{{ $toolchainReady ? '已安装':'待安装' }}</span><span class="badge {{ $bot?->polled_at?->gt(now()->subSeconds(60)) ? 'bg-green-lt':'bg-secondary-lt' }}">机器人轮询：{{ $bot?->polled_at?->gt(now()->subSeconds(60)) ? '运行中':'未检测到' }}</span></div><p class="form-hint mt-3">开发签名 APK，用于安装测试；构建与签名验证不代表已通过真机兼容性测试。</p></div></section>
    <section class="card"><div class="card-body"><h2>Telegram 机器人</h2>
        @if($bot)<p>已连接 <a href="https://t.me/{{ $bot->username }}" target="_blank" rel="noopener">{{ '@'.$bot->username }}</a> · {{ $bot->owner_id ? '已绑定专用账号':'等待配对' }}</p>@endif
        <form method="post" action="{{ route('builds.configure') }}" autocomplete="off">@csrf<label class="form-label" for="bot-token">BotFather Token</label><input type="password" name="bot_token" id="bot-token" class="form-control" autocomplete="new-password" required placeholder="{{ $bot ? '已加密保存；需要更新时输入新 Token':'粘贴新机器人的 Token，仅保存在本机' }}"><button class="btn btn-primary mt-3">保存并连接机器人</button></form>
        @if($bot && !$bot->owner_id)<form method="post" action="{{ route('builds.pair') }}" class="mt-3">@csrf<button class="btn btn-outline-primary">生成一次性配对链接</button></form>@endif
        @if(session('pair_link'))<div class="alert alert-info mt-3"><a href="{{ session('pair_link') }}" target="_blank" rel="noopener">在 Telegram 完成账号配对 ↗</a><span>链接 30 分钟内有效，仅使用一次。</span></div>@endif
        @if($bot?->owner_id)<a class="btn btn-primary mt-3" href="https://t.me/{{ $bot->username }}?start=build" target="_blank" rel="noopener">前往机器人构建 ↗</a>@endif
    </div></section>
    <section class="card"><div class="card-body"><h2>构建记录</h2>@forelse($builds as $build)<div class="border-bottom py-3"><strong>{{ $build->app_name }}</strong> <span class="badge bg-secondary-lt">{{ $build->status }}</span><p class="form-hint">{{ $build->home_url }} · {{ $build->created_at->format('m-d H:i:s') }}</p>@if($build->status==='succeeded')<a class="btn btn-sm" href="{{ route('builds.artifact',$build->id) }}">下载 APK</a><span class="form-hint">发送状态：{{ $build->delivery_status }} · {{ number_format($build->size / 1024) }} KB</span>@endif @if($build->has_log)<a class="btn btn-sm" href="{{ route('builds.log',$build->id) }}" target="_blank" rel="noopener">构建日志</a>@endif @if($build->error)<p class="text-danger mt-2">{{ $build->error }}</p>@endif</div>@empty<p class="text-secondary mb-0">暂无构建任务。在机器人发送 /build 开始。</p>@endforelse</div></section>{{ $builds->links() }}
</div>
</x-layout>
