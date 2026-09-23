@props(['title' => '设备工作台', 'active' => 'devices', 'variant' => 'standard'])
<!doctype html>
<html lang="zh-CN">
<head>
    <meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
    <meta name="csrf-token" content="{{ csrf_token() }}"><meta name="color-scheme" content="light dark">
    <title>{{ $title }} · Boundary Lab</title>
    <link rel="icon" href="{{ asset('favicon.svg') }}" type="image/svg+xml">
    <link rel="stylesheet" href="{{ asset('vendor/tabler/tabler.min.css') }}">
    <link rel="stylesheet" href="{{ asset('assets/lab.css') }}">
    <link rel="stylesheet" href="{{ asset('assets/console.css') }}">
    <script src="{{ asset('assets/theme.js') }}"></script>
</head>
<body class="console-page console-{{ $variant }}">
<a href="#main" class="skip-link">跳到主要内容</a>
@if($variant === 'detail')
    <header class="device-topbar">{{ $header }}</header>
@else
    <header class="console-topbar">
        <a href="{{ route('devices.index') }}" class="console-brand"><img src="{{ asset('favicon.svg') }}" alt="" width="24" height="24"><strong>边界研究</strong><span class="version-label">V1</span></a>
        <div class="console-header-content">{{ $header ?? '' }}</div>
        <div class="console-account"><span class="account-avatar">L</span><span><strong>local</strong><small>本地研究空间</small></span><span class="local-mode">免登录预览</span></div>
        <button class="btn console-theme" id="theme-toggle" aria-label="切换明暗主题"><x-icon name="sun" :size="16"/><span>极简纯白</span></button>
        <a href="{{ route('guide') }}" class="btn console-help"><x-icon name="book" :size="15"/>指南</a>
    </header>
    <aside class="console-rail"><nav aria-label="主导航">
        @foreach([['devices','devices.index','device-mobile','设备'], ['builds','builds','package','构建'], ['translation','translation.edit','adjustments','翻译']] as [$key,$route,$icon,$label])
        <a class="rail-link {{ $active === $key ? 'active' : '' }}" href="{{ route($route) }}" title="{{ $label }}" @if($active === $key) aria-current="page" @endif><x-icon :name="$icon" :size="21"/><span>{{ $label }}</span></a>
        @endforeach
    </nav><span class="rail-version">0.1</span></aside>
@endif
<main id="main" class="console-main {{ $variant === 'standard' ? 'lab-main' : '' }}">
    @if(session('success'))<div class="alert alert-success console-message" role="status"><x-icon name="check"/> {{ session('success') }}</div>@endif
    @if($errors->any())<div class="alert alert-danger console-message" role="alert"><div><strong>请检查以下内容</strong><ul class="mb-0 mt-2">@foreach($errors->all() as $error)<li>{{ $error }}</li>@endforeach</ul></div></div>@endif
    {{ $slot }}
</main>
<script src="{{ asset('vendor/tabler/tabler.min.js') }}" defer></script>
<script src="{{ asset('assets/lab.js') }}" defer></script>
@stack('scripts')
</body></html>
