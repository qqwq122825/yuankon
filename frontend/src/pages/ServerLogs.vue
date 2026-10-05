<script setup>
import { ref, computed, onUnmounted, watch } from 'vue';
import { api } from '../api.js';

const rows = ref([]),
    error = ref(''),
    loading = ref(false),
    polling = ref(false);
const level = ref(''),
    category = ref('');
const levelLabels = { info: '信息', warn: '警告', error: '错误' };
const categoryLabels = { runtime: '服务运行', http: 'HTTP 请求' };
const filters = computed(() => {
    const query = new URLSearchParams();
    if (level.value) query.set('level', level.value);
    if (category.value) query.set('category', category.value);
    return query;
});
const exportUrl = computed(() => {
    const query = new URLSearchParams(filters.value);
    query.set('date', new Date().toISOString().slice(0, 10));
    return `/api/logs/server/export?${query}`;
});
let timer,
    controller,
    cursor = 0;
async function load(increment = false) {
    if (increment && loading.value) return;
    controller?.abort();
    const current = (controller = new AbortController());
    loading.value = true;
    error.value = '';
    try {
        const query = new URLSearchParams(filters.value);
        query.set('limit', '100');
        if (increment) query.set('afterId', String(cursor));
        const result = await api(`/api/logs/server/tail?${query}`, { signal: current.signal });
        if (current !== controller) return;
        rows.value = increment ? [...rows.value, ...result.data].slice(-500) : result.data;
        cursor = result.data.at(-1)?.id ?? (increment ? cursor : 0);
    } catch (e) {
        if (current === controller && e.name !== 'AbortError') error.value = e.message;
    } finally {
        if (current === controller) loading.value = false;
    }
}
watch(
    [level, category],
    () => {
        rows.value = [];
        cursor = 0;
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
                <small>WORKSPACE / SERVER</small>
                <h1>服务器日志</h1>
            </div>
            <RouterLink to="/">返回设备</RouterLink>
        </div>
        <p class="text-muted">
            超管专用 · Node 服务启动、停止、后台请求和处理异常；不是设备采集日志。
        </p>
        <div class="page-actions mb-3">
            <button class="btn" :disabled="loading" @click="load()">
                {{ loading ? '刷新中…' : '刷新' }}
            </button>
            <select v-model="level" class="form-select record-filter" aria-label="日志级别">
                <option value="">全部级别</option>
                <option value="info">信息</option>
                <option value="warn">警告</option>
                <option value="error">错误</option>
            </select>
            <select v-model="category" class="form-select record-filter" aria-label="日志分类">
                <option value="">全部分类</option>
                <option value="runtime">服务运行</option>
                <option value="http">HTTP 请求</option>
            </select>
            <label><input v-model="polling" type="checkbox" /> 实时增量</label>
            <a class="btn" :href="exportUrl">导出今日 UTC JSONL</a>
            <span class="text-muted">元数据保留 7 天；不记录正文、密码和凭证</span>
        </div>
        <div v-if="error" role="alert" class="alert alert-danger">{{ error }}</div>
        <div class="card" :aria-busy="loading">
            <table class="table">
                <thead>
                    <tr>
                        <th>ID</th>
                        <th>时间</th>
                        <th>级别</th>
                        <th>分类</th>
                        <th>事件</th>
                        <th>详情</th>
                    </tr>
                </thead>
                <tbody>
                    <tr v-for="row in rows" :key="row.id">
                        <td>{{ row.id }}</td>
                        <td>{{ new Date(row.ts).toLocaleString('zh-CN', { hour12: false }) }}</td>
                        <td>{{ levelLabels[row.level] }}</td>
                        <td>{{ categoryLabels[row.category] }}</td>
                        <td>
                            <code>{{ row.event }}</code>
                        </td>
                        <td>
                            {{ row.message
                            }}<template v-if="row.request_path">
                                · <code>{{ row.request_method }} {{ row.request_path }}</code> →
                                {{ row.response_status }} · {{ row.duration_ms }} ms</template
                            ><template v-if="row.error_kind">
                                · {{ row.error_kind }} {{ row.error_code || '' }}</template
                            >
                        </td>
                    </tr>
                    <tr v-if="!rows.length">
                        <td colspan="6" class="empty-state">
                            {{ loading ? '正在读取日志…' : '暂无服务器日志' }}
                        </td>
                    </tr>
                </tbody>
            </table>
        </div>
    </div>
</template>
