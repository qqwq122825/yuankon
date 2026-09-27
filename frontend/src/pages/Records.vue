<script setup>
import { ref, watch, onUnmounted, computed } from 'vue';
import { useRoute } from 'vue-router';
import { api, formatDate, sourceLabel } from '../api.js';
const route = useRoute(),
    rows = ref([]),
    error = ref(''),
    page = ref(1),
    total = ref(0),
    polling = ref(false),
    channel = ref('');
let timer, controller;
const protocol = computed(() => route.path === '/protocol');
const title = computed(() =>
    protocol.value ? '协议审计' : route.path === '/events' ? '观察记录' : '快照档案',
);
async function load(increment = false) {
    controller?.abort();
    controller = new AbortController();
    error.value = '';
    try {
        const endpoint = protocol.value
            ? `/api/logs/protocol/tail?afterId=${increment ? rows.value.at(-1)?.id || 0 : 0}&limit=100${channel.value ? `&channel=${channel.value}` : ''}`
            : `/api${route.path}?page=${page.value}`;
        const result = await api(endpoint, { signal: controller.signal });
        rows.value = increment ? [...rows.value, ...result.data].slice(-500) : result.data;
        total.value = result.total ?? rows.value.length;
    } catch (e) {
        if (e.name !== 'AbortError') error.value = e.message;
    }
}
watch(
    () => route.path,
    () => {
        page.value = 1;
        rows.value = [];
        polling.value = false;
        load();
    },
    { immediate: true },
);
watch(polling, (on) => {
    clearInterval(timer);
    if (on) timer = setInterval(() => load(true), 3000);
});
onUnmounted(() => {
    clearInterval(timer);
    controller?.abort();
});
</script>
<template>
    <div class="settings-page">
        <div class="page-title-row">
            <div>
                <small>WORKSPACE / RECORDS</small>
                <h1>{{ title }}</h1>
            </div>
            <RouterLink to="/">返回设备</RouterLink>
        </div>
        <div class="page-actions mb-3">
            <button class="btn" @click="load(false)">刷新</button
            ><template v-if="protocol"
                ><select
                    v-model="channel"
                    class="form-select record-filter"
                    aria-label="审计通道"
                    @change="load(false)"
                >
                    <option value="">全部通道</option>
                    <option value="panel">管理端</option>
                    <option value="device">设备</option>
                    <option value="http">HTTP</option></select
                ><label><input v-model="polling" type="checkbox" /> 实时增量</label
                ><a
                    class="btn"
                    :href="`/api/logs/protocol/export?date=${new Date().toISOString().slice(0, 10)}`"
                    >导出今日 UTC JSONL</a
                ><span class="text-muted">仅类型、时间、设备与字节数；保留 7 天</span></template
            ><template v-else
                ><button
                    class="btn"
                    :disabled="page <= 1"
                    @click="
                        page--;
                        load();
                    "
                >
                    上一页</button
                ><span>{{ page }} 页 / {{ total }} 条</span
                ><button
                    class="btn"
                    :disabled="page * 20 >= total"
                    @click="
                        page++;
                        load();
                    "
                >
                    下一页
                </button></template
            >
        </div>
        <div v-if="error" role="alert" class="alert alert-danger">{{ error }}</div>
        <div class="card">
            <table class="table">
                <thead>
                    <tr>
                        <th>ID</th>
                        <th>设备</th>
                        <th>时间</th>
                        <th>类型 / 来源</th>
                        <th>详情</th>
                    </tr>
                </thead>
                <tbody>
                    <tr v-for="row in rows" :key="row.id">
                        <td>{{ row.id }}</td>
                        <td>{{ row.device_id || '—' }}</td>
                        <td>
                            {{
                                protocol
                                    ? new Date(row.ts).toLocaleString()
                                    : formatDate(row.captured_at || row.occurred_at)
                            }}
                        </td>
                        <td>{{ row.type || row.kind || sourceLabel(row.source) }}</td>
                        <td v-if="protocol">
                            {{ row.channel }} · {{ row.dir }} · {{ row.size }} bytes
                        </td>
                        <td v-else-if="row.node_count !== undefined">
                            <RouterLink :to="`/devices/${row.device_id}?snapshot=${row.id}`"
                                >{{ row.node_count }} 节点 / {{ row.window_count }} 窗口</RouterLink
                            >
                            · <a :href="`/api/snapshots/${row.id}/export`">导出</a>
                        </td>
                        <td v-else>采集端报告 · 无正文</td>
                    </tr>
                    <tr v-if="!rows.length">
                        <td colspan="5" class="empty-state">暂无记录</td>
                    </tr>
                </tbody>
            </table>
        </div>
    </div>
</template>
