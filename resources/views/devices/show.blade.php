<x-layout :title="$device->name" variant="detail">
    <x-slot:header>
        <a href="{{ route('devices.index') }}" class="device-back" aria-label="返回设备列表"><x-icon name="arrow-left" :size="18"/></a>
        <h1>{{ $device->brand }} {{ $device->name }}</h1><span class="device-system">Android {{ $device->android_version }} · {{ $device->public_id }}</span>
        <form class="topbar-note" action="{{ route('devices.note', $device->id) }}" method="post">@csrf @method('PATCH')<input class="form-control" name="note" maxlength="200" aria-label="设备备注" placeholder="添加备注…" value="{{ old('note', $device->note) }}"><button class="btn btn-primary" aria-label="保存备注">保存</button></form>
        <div class="device-badges"><span class="pill pill-neutral"><i></i>{{ $device->source === 'api' ? ($device->isOnline() ? '在线' : '待接入 / 超时') : ($device->source === 'sample' ? '示例设备' : '离线记录') }}</span>@if($device->battery !== null)<span class="pill pill-blue">▰ {{ $device->battery }}%</span>@endif<span class="pill pill-purple">{{ $device->source === 'sample' ? 'synthetic' : $device->source }}</span><span class="pill pill-green">无障碍: {{ $device->accessibility_enabled === null ? '未记录' : ($device->accessibility_enabled ? '开' : '关') }}</span><span class="pill pill-green">只读快照</span><span class="pill pill-neutral">入库: {{ $device->last_received_at?->format('Y/m/d') ?? '—' }}</span></div>
        <button class="btn btn-icon" id="theme-toggle" aria-label="切换明暗主题"><x-icon name="sun" :size="16"/></button>
        <a href="{{ route('guide') }}" class="pill pill-blue device-guide">研究说明</a>
    </x-slot:header>
    <div class="device-workbench">
        <aside class="device-nav"><nav aria-label="设备栏目">
            <button class="active" data-workbench-view="overview" aria-current="page">设备信息</button>
            <button data-workbench-view="snapshots">快照档案</button>
            <button data-workbench-view="observations" data-scenario="sms">短信观察</button>
            <button data-workbench-view="observations" data-scenario="password">密码事件</button>
            <button data-workbench-view="events">观察记录</button>
            <button data-workbench-view="metadata">节点信息</button>
            <button data-workbench-view="note">备注</button>
            <a href="{{ route('guide') }}">研究说明</a>
        </nav><span class="device-nav-caption">本机 · 只读</span></aside>
        <div class="device-canvas">
            <section data-workbench-section="overview">
                <div class="inspection-orbit"><button class="orbit-launch" @if($snapshot) data-open-panel="both" @else disabled @endif><span>V1</span><strong>{{ $snapshot ? '开始检查' : '等待快照' }}</strong></button></div>
                <section class="card research-summary"><div class="card-header"><h2 class="card-title">无障碍快照概览</h2><div class="summary-actions">@if($snapshot)<button class="btn btn-primary" data-open-panel="both">查看快照</button>@endif<a class="btn" href="{{ request()->fullUrl() }}">刷新</a></div></div><div class="summary-content">
                    @if($snapshot)<div class="summary-metrics"><span><strong>{{ $snapshot->window_count }}</strong>窗口</span><span><strong>{{ $snapshot->node_count }}</strong>节点</span><span><strong>{{ count($snapshot->payload['observations'] ?? []) }}</strong>场景观察</span></div><p>{{ $snapshot->source === 'sample' ? '合成示例数据 · 非真机连接' : ($snapshot->source === 'api' ? '设备 API 采集端报告' : '手动导入数据 · 非实时连接') }}<span class="footer-dot">·</span>{{ $snapshot->captured_at->format('Y-m-d H:i:s') }}</p>
                    @else<p class="waiting-state">还没有可查看的快照</p>@endif
                </div></section>
            </section>
            <section data-workbench-section="snapshots" hidden><div class="workspace-section-heading"><h2>快照档案</h2><span>{{ $device->snapshots_count }} 份记录</span></div><section class="card"><div class="table-responsive"><table class="table table-vcenter"><thead><tr><th>快照</th><th>采集时间</th><th>来源</th><th>节点</th><th>操作</th></tr></thead><tbody>@forelse($snapshots as $item)<tr><td>#{{ $item->id }}</td><td>{{ $item->captured_at->format('Y-m-d H:i:s') }}</td><td><x-source :value="$item->source"/></td><td>{{ $item->node_count }}</td><td><a href="{{ route('devices.show', ['id'=>$device->id,'snapshot'=>$item->id]) }}#inspect">打开查看</a></td></tr>@empty<tr><td colspan="5" class="text-center p-4">暂无快照</td></tr>@endforelse</tbody></table></div></section></section>
            <section data-workbench-section="events" hidden><div class="workspace-section-heading"><h2>观察记录</h2><a href="{{ route('events.index') }}">全部记录 ↗</a></div><section class="card"><div class="card-body"><x-timeline :entries="$events"/></div></section></section>
            <section data-workbench-section="note" hidden><div class="workspace-section-heading"><h2>研究备注</h2></div><section class="card"><div class="card-body"><form action="{{ route('devices.note', $device->id) }}" method="post">@csrf @method('PATCH')<label for="research-note" class="form-label">实验范围、进度与待核实事项</label><textarea class="form-control" id="research-note" name="note" rows="4" maxlength="200">{{ old('note', $device->note) }}</textarea><p class="form-hint">最多 200 字；请仅填写研究摘要。</p><button class="btn btn-primary mt-2">保存研究备注</button></form></div></section></section>
            <section data-workbench-section="metadata" hidden><div class="workspace-section-heading"><h2>节点信息</h2><x-source :value="$device->source"/></div><section class="card"><div class="card-body">
                @if($snapshot)<dl class="metadata-list"><div><dt>屏幕坐标系</dt><dd>{{ $snapshot->payload['display']['width'] }} × {{ $snapshot->payload['display']['height'] }}</dd></div><div><dt>采集耗时（记录值）</dt><dd>{{ $snapshot->payload['diagnostics']['elapsed_ms'] ?? '—' }} ms</dd></div><div><dt>遍历截断</dt><dd>{{ $snapshot->payload['diagnostics']['truncated'] ? '是 · 结果不完整' : '否（记录值）' }}</dd></div><div><dt>节点内容策略</dt><dd>仅结构与状态，正文不入库</dd></div></dl>@foreach($snapshot->payload['windows'] as $window)<div class="window-metadata"><span>{{ $window['type'] }}</span><code>{{ $window['id'] }}</code><span>{{ $window['root_status'] }}</span><span>{{ count($window['nodes']) }} 节点</span></div>@endforeach
                @else<p class="text-secondary">暂无节点记录。</p>@endif
            </div></section></section>
            <section data-workbench-section="observations" hidden><div class="workspace-section-heading"><h2 id="observation-heading">场景观察</h2></div><x-observations :items="$snapshot?->payload['observations'] ?? []" :source="$device->source"/></section>
        </div>
        <aside class="device-tools" aria-label="研究查看工具">
            @if($device->source === 'api')<x-diagnostic-controls :device="$device"/>@endif
            <div class="tool-group"><h2>画面与节点</h2><button class="tool-button primary" data-open-panel="screenshot" @disabled(!$snapshot)>查看截图</button><button class="tool-button" data-open-panel="nodes" @disabled(!$snapshot)>打开阅读器</button><button class="tool-button primary" data-open-panel="both" @disabled(!$snapshot)>并排查看</button><button class="tool-button primary" data-workbench-view="metadata">无障碍调试信息</button></div>
            <div class="tool-group"><h2>快照记录</h2>@if($snapshot)<form method="get" class="tool-snapshot-form"><label class="visually-hidden" for="snapshot-select">当前快照</label><select class="form-select" id="snapshot-select" name="snapshot">@foreach($snapshots as $item)<option value="{{ $item->id }}" @selected($item->id === $snapshot->id)>#{{ $item->id }} · {{ $item->captured_at->format('m-d H:i') }}</option>@endforeach</select><button class="tool-button muted">切换快照</button></form><a class="tool-button muted" href="{{ route('snapshots.export', $snapshot->id) }}">导出脱敏 JSON</a>@endif</div>
            <div class="tool-group"><h2>场景观察</h2><button class="tool-button" data-workbench-view="observations" data-scenario="password">密码字段事件</button><button class="tool-button" data-workbench-view="observations" data-scenario="sms">短信可见性</button></div>
            <div class="tool-group"><h2>视图管理</h2><button class="tool-button rose" data-close-all-panels>关闭浮动窗口</button><button class="tool-button mint" data-reset-panels>重置窗口位置</button><a class="tool-button" href="{{ request()->fullUrl() }}">刷新当前页面</a></div>
            <div class="tool-group"><h2>阅读器设置</h2><a class="tool-button" href="{{ route('translation.edit') }}" target="_blank" rel="noopener">翻译 API 配置 ↗</a></div>
            <div class="tool-group tool-help"><h2>研究说明</h2><p>仅查看已保存记录。示例结果与真机结论分别标注。</p><a href="{{ route('guide') }}">查看数据范围 ↗</a></div>
        </aside>
    </div>
    @if($viewerSnapshot)
        <x-debug-viewers :snapshot="$viewerSnapshot"/>
        <script id="snapshot-data" type="application/json">{!! json_encode($viewerSnapshot->payload, JSON_HEX_TAG | JSON_HEX_AMP | JSON_HEX_APOS | JSON_HEX_QUOT) !!}</script>
        <script id="reader-config" type="application/json">{!! json_encode(['labels' => (object) $readerLabels, 'translateUrl' => $viewerSnapshot->exists ? route('snapshots.translate', $viewerSnapshot->id) : null], JSON_HEX_TAG | JSON_HEX_AMP | JSON_HEX_APOS | JSON_HEX_QUOT) !!}</script>
        @push('scripts')<script src="{{ asset('assets/panels.js') }}" defer></script><script src="{{ asset('assets/inspector.js') }}" defer></script>@endpush
    @endif
</x-layout>
