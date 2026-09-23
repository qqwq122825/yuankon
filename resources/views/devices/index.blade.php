<x-layout variant="fleet">
    <x-slot:header>
        <form class="header-search" method="get" action="{{ route('devices.index') }}">
            <input class="form-control" name="q" aria-label="搜索设备" placeholder="搜索设备 ID / 备注 / 名称 / 品牌…" value="{{ $filters['q'] ?? '' }}">
            @foreach(['source','a11y'] as $filter)@if(!empty($filters[$filter]))<input type="hidden" name="{{ $filter }}" value="{{ $filters[$filter] }}">@endif @endforeach
            @foreach($sorting as $key => $value)<input type="hidden" name="{{ $key }}" value="{{ $value }}">@endforeach
            <button type="submit" class="header-search-button" aria-label="提交搜索"><x-icon name="search" :size="15"/></button>
        </form>
        <x-fleet-stats :stats="$stats"/>
    </x-slot:header>
    <h1 class="visually-hidden">设备工作台</h1>
    <div class="fleet-toolbar">
        <div class="fleet-count"><strong>{{ $devices->total() }}</strong><span>当前设备</span></div>
        <a class="btn btn-primary" href="{{ request()->fullUrl() }}"><x-icon name="refresh" :size="14"/>刷新状态</a>
        <span class="toolbar-hint"><i></i>心跳状态与历史记录分开显示</span>
        <form class="fleet-filters" method="get" action="{{ route('devices.index') }}">
            @if(!empty($filters['q']))<input type="hidden" name="q" value="{{ $filters['q'] }}">@endif
            @foreach($sorting as $key => $value)<input type="hidden" name="{{ $key }}" value="{{ $value }}">@endforeach
            <select class="form-select" name="source" aria-label="数据来源"><option value="">全部来源</option><option value="sample" @selected(($filters['source'] ?? '') === 'sample')>示例设备</option><option value="import" @selected(($filters['source'] ?? '') === 'import')>历史研究记录</option><option value="api" @selected(($filters['source'] ?? '') === 'api')>设备 API</option></select>
            <select class="form-select" name="a11y" aria-label="无障碍状态"><option value="">全部无障碍</option><option value="enabled" @selected(($filters['a11y'] ?? '') === 'enabled')>已开启</option><option value="disabled" @selected(($filters['a11y'] ?? '') === 'disabled')>已关闭</option></select>
            <button class="btn filter-apply" type="submit"><x-icon name="adjustments" :size="13"/>筛选</button>
        </form>
        @if(array_filter($filters))<a class="filter-reset" href="{{ route('devices.index', $sorting) }}">清除筛选</a>@endif
        <span id="selection-count" class="selection-count" role="status" hidden></span>
        <span class="fleet-sample-label">示例数据已标记</span>
    </div>
    <div class="fleet-table-wrap"><table class="table table-vcenter fleet-table"><thead><tr>
        <th class="select-cell"><input type="checkbox" class="form-check-input" id="select-all-devices" aria-label="选择当前页设备"></th>
        <x-sort-heading field="id" label="ID" :sorting="$sorting" :filters="$filters"/>
        <th scope="col">预览</th>
        @foreach(['name'=>'设备名称','note'=>'备注','source'=>'来源','brand'=>'品牌','android'=>'Android','snapshots'=>'快照','battery'=>'电量'] as $field => $label)
            <x-sort-heading :field="$field" :label="$label" :sorting="$sorting" :filters="$filters"/>
        @endforeach
        <th scope="col">数据状态</th>
        @foreach(['a11y'=>'无障碍','nodes'=>'节点','windows'=>'窗口','last_seen'=>'最近入库'] as $field => $label)
            <x-sort-heading :field="$field" :label="$label" :sorting="$sorting" :filters="$filters"/>
        @endforeach
        <th scope="col" class="text-end">操作</th>
    </tr></thead><tbody>
    @forelse($devices as $device)
        <tr data-href="{{ route('devices.show', $device->id) }}">
            <td class="select-cell"><input type="checkbox" class="form-check-input device-checkbox" aria-label="选择 {{ $device->name }}"></td>
            <td><span class="fleet-id" title="{{ $device->public_id }}">{{ $device->public_id }}</span></td>
            <td><a href="{{ route('devices.show', $device->id) }}#inspect" class="phone-preview preview-{{ $loop->index % 4 }}" aria-label="查看 {{ $device->name }} 快照"><span>LAB</span></a></td>
            <td><a class="fleet-device-name" href="{{ route('devices.show', $device->id) }}">{{ $device->name }}</a></td>
            <td><a class="fleet-note" href="{{ route('devices.show', $device->id) }}#note" title="{{ $device->note ?: '添加备注' }}">{{ $device->note ?: '点击备注' }}</a></td>
            <td><x-source :value="$device->source"/></td>
            <td>{{ $device->brand }}</td><td>{{ $device->android_version }}</td>
            <td><span class="value-muted">{{ $device->snapshots_count }}</span></td>
            <td><span class="battery-value {{ ($device->battery ?? 100) < 20 ? 'low' : '' }}">{{ $device->battery !== null ? $device->battery.'%' : '—' }}</span></td>
            <td><span class="pill pill-neutral"><i></i>{{ $device->source === 'api' ? ($device->isOnline() ? '在线' : ($device->last_heartbeat_at ? '连接超时' : '待接入')) : ($device->source === 'sample' ? '示例' : '离线记录') }}</span></td>
            <td><span class="pill {{ $device->accessibility_enabled ? 'pill-green' : 'pill-neutral' }}">{{ $device->accessibility_enabled === null ? '未记录' : ($device->accessibility_enabled ? '已开启' : '已关闭') }}</span></td>
            <td><span class="value-green">{{ $device->latestSnapshot?->node_count ?? '—' }}</span></td><td>{{ $device->latestSnapshot?->window_count ?? '—' }}</td>
            <td class="time-cell">{{ $device->last_received_at?->format('m-d H:i:s') ?? '—' }}</td>
            <td class="text-end"><div class="fleet-row-actions"><a class="btn btn-sm row-inspect" href="{{ route('devices.show', $device->id) }}">详情</a><a class="btn btn-sm row-snapshot" href="{{ route('devices.show', $device->id) }}#inspect">快照</a></div></td>
        </tr>
    @empty
        <tr><td colspan="16"><div class="empty-state"><x-icon name="devices" :size="34"/><h2>没有匹配的设备</h2><p>试试其他搜索条件，或清除筛选查看全部设备。</p><a class="btn" href="{{ route('devices.index', $sorting) }}">清除筛选</a></div></td></tr>
    @endforelse
    </tbody></table></div>
    <div class="fleet-pagination"><span>显示 {{ $devices->firstItem() ?? 0 }}–{{ $devices->lastItem() ?? 0 }} 条，共 {{ $devices->total() }} 台设备 <span class="footer-dot">·</span> 在线仅依据最近心跳；节点属性为采样值</span>{{ $devices->links('pagination::bootstrap-5') }}</div>
</x-layout>
