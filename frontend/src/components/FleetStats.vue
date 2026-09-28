<script setup>
defineProps({ stats: Object });
</script>
<template>
    <div class="header-device-stats" role="group" aria-label="设备统计">
        <div
            class="header-stat"
            title="已登记 API 设备最近 90 秒的有效 WS 状态；无接入设备时显示未知"
        >
            <span class="header-stat-icon mint"
                ><img src="/vendor/icons/activity.svg" width="15" alt=""
            /></span>
            <div>
                <strong>{{ stats?.online ?? '—' }}</strong
                ><small>在线设备</small>
            </div>
        </div>
        <div class="header-stat" title="当前账号可见的未删除设备记录总数，包含合成示例">
            <span class="header-stat-icon"
                ><img src="/vendor/icons/device-mobile.svg" width="15" alt=""
            /></span>
            <div>
                <strong>{{ stats?.devices ?? '—' }}</strong
                ><small>设备总数</small>
            </div>
        </div>
    </div>
    <div class="header-periods">
        <div
            v-for="period in stats?.periods || [{ label: '今日' }, { label: '昨日' }]"
            :key="period.label"
            class="header-period"
            :class="{ yesterday: period.label === '昨日' }"
        >
            <span class="header-period-label">{{ period.label }}</span
            ><span
                v-for="[key, label] in [
                    ['installed', '安装'],
                    ['offline', '离线'],
                    ['accessibility', '无障碍'],
                ]"
                :key="key"
                class="header-period-metric"
                :class="`metric-${key}`"
                title="尚未接入每日事件统计"
                ><strong>{{ period[key] ?? '—' }}</strong
                ><small>{{ label }}</small></span
            >
        </div>
    </div>
</template>
