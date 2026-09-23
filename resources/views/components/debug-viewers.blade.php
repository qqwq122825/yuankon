@props(['snapshot'])
<div class="debug-workspace" id="debug-workspace" hidden>
    <section class="card debug-panel" id="panel-screenshot" hidden role="dialog" aria-labelledby="screenshot-title" tabindex="-1">
        <div class="card-header panel-handle">
            <h2 class="card-title screenshot-title" id="screenshot-title"><span class="viewer-dot"></span>屏幕截图</h2>
            <span class="panel-counter">#{{ $snapshot->id }}</span>
            <button class="btn btn-icon btn-sm panel-close" data-close-panel="screenshot" aria-label="关闭截图面板"><x-icon name="x" :size="16"/></button>
        </div>
        <x-viewer-width panel="screenshot" label="截图"/>
        @if($snapshot->screenshot_path || $snapshot->source === 'api')
            <div class="screenshot-stage"><img id="screen-image" @if($snapshot->screenshot_path) src="{{ route('snapshots.image', $snapshot->id) }}" @else hidden @endif alt="{{ $snapshot->source === 'sample' ? '合成测试界面，不是真机截图' : ($snapshot->source === 'api' ? '设备 API 诊断预览' : '研究者手动导入的界面截图') }}"></div>
        @else
            <div class="empty-state viewer-empty"><x-icon name="photo" :size="32"/><h3>没有附带截图</h3><p>当前记录只有节点结构。</p></div>
        @endif
        <div class="panel-footnote">{{ $snapshot->source === 'sample' ? '合成样例 · 非真机截图' : ($snapshot->source === 'api' ? '诊断会话临时预览' : '已保存图片 · 非实时画面') }}@if($snapshot->screenshot_path)<a href="{{ route('snapshots.image', $snapshot->id) }}" target="_blank" rel="noopener">查看原图 ↗</a>@endif</div>
    </section>
    <section class="card debug-panel nodes-panel" id="panel-nodes" hidden role="dialog" aria-labelledby="nodes-title" tabindex="-1">
        <div class="card-header panel-handle reader-header">
            <h2 class="card-title" id="nodes-title"><span class="viewer-dot"></span>阅读器</h2>
            <span class="reader-count" title="{{ $snapshot->node_count }} 个节点">#{{ $snapshot->node_count }}</span>
            <div class="reader-controls">
                <button type="button" class="reader-translate" id="reader-translate" aria-pressed="false" title="翻译固定样例标签">翻译</button>
                <button type="button" data-reader-font="-5" aria-label="减小阅读器字号">A−</button>
                <output id="reader-font-label" aria-live="polite">55%</output>
                <button type="button" data-reader-font="5" aria-label="增大阅读器字号">A+</button>
            </div>
            <button class="btn btn-icon btn-sm panel-close" data-close-panel="nodes" aria-label="关闭节点面板"><x-icon name="x" :size="16"/></button>
        </div>
        <x-viewer-width panel="nodes" label="阅读器"/>
        <div class="reader-message" id="reader-message" role="status" hidden></div>
        <div class="node-tabs" role="tablist" aria-label="节点视图">
            <button role="tab" aria-selected="false" aria-controls="node-tree-view" data-node-tab="tree">结构</button>
            <button class="active" role="tab" aria-selected="true" aria-controls="node-map-view" data-node-tab="map">映射</button>
            <button role="tab" aria-selected="false" aria-controls="node-json-view" data-node-tab="json">JSON</button>
            <a href="{{ route('translation.edit') }}" target="_blank" rel="noopener" title="翻译 API 设置（新页面）" aria-label="翻译 API 设置（新页面）"><x-icon name="adjustments" :size="13"/></a>
        </div>
        <div class="node-filters">
            <select class="form-select form-select-sm" id="window-filter" aria-label="筛选窗口"><option value="">全部窗口（{{ $snapshot->window_count }}）</option>@foreach($snapshot->payload['windows'] as $window)<option value="{{ $window['id'] }}">{{ $window['type'] }} · {{ $window['package'] ?? $window['id'] }}</option>@endforeach</select>
            <input id="node-search" class="form-control form-control-sm" placeholder="搜索节点…" aria-label="搜索节点">
        </div>
        <div id="node-tree-view" class="node-view" role="tabpanel" hidden><div class="node-tree" id="node-tree"></div><div class="node-inspector" id="node-inspector"><h3>选择一个节点</h3><p>查看坐标与属性。</p></div></div>
        <div id="node-map-view" class="node-view map-view" role="tabpanel"><svg id="node-map" role="img" aria-label="节点边界分布图"></svg></div>
        <div id="node-json-view" class="node-view" role="tabpanel" hidden><pre id="node-json" tabindex="0" aria-label="已脱敏的快照 JSON"></pre></div>
        <div class="panel-footnote">只读结构 · 样例标签 · 正文省略</div>
    </section>
</div>
