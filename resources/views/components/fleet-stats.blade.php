@props(['stats'])
<div class="header-device-stats" role="group" aria-label="设备统计">
    <div class="header-stat" title="按设备 API 最近 15 秒心跳统计；未登记接入设备时显示未知">
        <span class="header-stat-icon mint"><x-icon name="activity" :size="15"/></span>
        <div><strong data-header-metric="online">{{ $stats['online'] ?? '—' }}</strong><small>在线设备</small></div>
    </div>
    <div class="header-stat" title="本地设备记录总数，包含已标注的示例设备">
        <span class="header-stat-icon"><x-icon name="device-mobile" :size="15"/></span>
        <div><strong data-header-metric="devices">{{ $stats['devices'] }}</strong><small>设备总数</small></div>
    </div>
</div>
<div class="header-periods" role="group" aria-label="今日与昨日统计" aria-describedby="header-stat-help">
    @foreach($stats['periods'] as $period)
        <div class="header-period {{ $period['key'] }}" role="group" aria-label="{{ $period['label'] }}统计">
            <span class="header-period-label">{{ $period['label'] }}</span>
            @foreach(['installed' => '安装', 'offline' => '离线', 'accessibility' => '无障碍'] as $key => $label)
                <div class="header-period-metric metric-{{ $key }}" title="{{ $period['label'] }}{{ $label }}：尚未接入对应事件">
                    <strong data-header-metric="{{ $period['key'] }}-{{ $key }}">{{ $period[$key] ?? '—' }}</strong><small>{{ $label }}</small>
                </div>
            @endforeach
        </div>
    @endforeach
</div>
<span id="header-stat-help" class="visually-hidden">在线数量按设备 API 心跳统计；每日事件尚未接入，破折号表示未知，不代表零。</span>
