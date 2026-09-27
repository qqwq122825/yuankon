<script setup>
import { ref, watch, onUnmounted } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { api, mutate, sourceLabel, formatDate } from '../api.js';
import { connection } from '../connection.js';
import SortHeading from '../components/SortHeading.vue';
const route = useRoute(),
    router = useRouter(),
    result = ref(null),
    error = ref(''),
    loading = ref(false),
    busyId = ref(null),
    notice = ref(''),
    selected = ref([]),
    source = ref(''),
    a11y = ref(''),
    status = ref('');
let controller, timer;
const columns = [
    ['id', 'ID'],
    ['name', '设备名称'],
    ['note', '备注'],
    ['source', '来源'],
    ['brand', '品牌'],
    ['android', 'Android'],
    ['snapshots', '快照'],
    ['battery', '电量'],
    ['a11y', '无障碍'],
    ['windows', '窗口'],
    ['last_seen', '最近入库'],
];
async function load() {
    controller?.abort();
    const request = (controller = new AbortController());
    loading.value = true;
    error.value = '';
    try {
        const data = await api(`/api/devices?${new URLSearchParams(route.query)}`, {
            signal: request.signal,
        });
        if (request.signal.aborted) return;
        result.value = data;
        const lastPage = Math.max(1, Math.ceil(data.total / data.perPage));
        if (data.page > lastPage) {
            await router.replace({ path: '/', query: { ...route.query, page: lastPage } });
            return;
        }
        selected.value = selected.value.filter((id) =>
            result.value.data.some((row) => row.id === id),
        );
    } catch (e) {
        if (e.name !== 'AbortError') error.value = e.message;
    } finally {
        if (controller === request) loading.value = false;
    }
}
watch(
    () => route.fullPath,
    () => {
        source.value = String(route.query.source || '');
        a11y.value = String(route.query.a11y || '');
        status.value = String(route.query.status || '');
        load();
    },
    { immediate: true },
);
watch(
    () => connection.revision,
    () => {
        clearTimeout(timer);
        timer = setTimeout(load, 250);
    },
);
onUnmounted(() => {
    controller?.abort();
    clearTimeout(timer);
});
function query(changes) {
    router.push({ path: '/', query: { ...route.query, ...changes } });
}
function sort(field) {
    query({
        sort: field,
        direction:
            result.value?.filters.sort === field && result.value?.filters.direction === 'asc'
                ? 'desc'
                : 'asc',
        page: 1,
    });
}
function openRow(event, row) {
    if (
        event.target.closest('a,button,input,label,select,textarea') ||
        window.getSelection()?.toString()
    )
        return;
    router.push(`/devices/${row.id}`);
}
function rowKey(event, row) {
    if (event.target === event.currentTarget && ['Enter', ' '].includes(event.key)) {
        event.preventDefault();
        router.push(`/devices/${row.id}`);
    }
}
async function manage(row, remove = false) {
    if (busyId.value !== null) return;
    const action = remove ? '删除' : row.is_blacklisted ? '取消拉黑' : '拉黑';
    const explanation = remove
        ? '将从设备列表移除并停止接入，历史记录保留以供审计，不清除手机数据。'
        : row.is_blacklisted
          ? '将重新允许该设备使用仍有效的凭证接入。'
          : '将断开设备并阻止新的状态与截图上报。';
    if (!window.confirm(`确认${action}「${row.name}」？\n${explanation}`)) return;
    busyId.value = row.id;
    error.value = '';
    notice.value = '';
    try {
        await mutate(
            `/api/devices/${row.id}${remove ? '' : '/blacklist'}`,
            remove ? 'DELETE' : 'PATCH',
            remove ? {} : { blacklisted: !row.is_blacklisted },
        );
        notice.value = `${row.name}已${action}`;
        await load();
    } catch (e) {
        error.value = e.message;
    } finally {
        busyId.value = null;
    }
}
function value(row, key) {
    return key === 'id'
        ? row.public_id
        : key === 'android'
          ? row.android_version
          : key === 'snapshots'
            ? row.snapshots_count
            : key === 'a11y'
              ? row.accessibility_enabled === null
                  ? '—'
                  : row.accessibility_enabled
                    ? '已开启'
                    : '已关闭'
              : key === 'source'
                ? sourceLabel(row.source)
                : key === 'battery'
                  ? row.battery === null
                      ? '—'
                      : row.battery + '%'
                  : key === 'nodes'
                    ? (row.node_count ?? '—')
                    : key === 'windows'
                      ? (row.window_count ?? '—')
                      : key === 'last_seen'
                        ? formatDate(row.last_received_at)
                        : row[key] || '—';
}
</script>
<template>
    <h1 class="visually-hidden">设备工作台</h1>
    <div class="fleet-toolbar">
        <div class="fleet-count">
            <strong>{{ result?.total ?? '—' }}</strong
            ><span>当前设备</span>
        </div>
        <button class="btn btn-primary" @click="load" :disabled="loading">刷新状态</button
        ><span class="toolbar-hint">心跳状态与历史记录分开显示</span>
        <form class="fleet-filters" @submit.prevent="query({ source, a11y, status, page: 1 })">
            <select v-model="source" aria-label="数据来源" class="form-select">
                <option value="">全部来源</option>
                <option value="sample">合成示例</option>
                <option value="import">历史记录</option>
                <option value="api">设备 API</option></select
            ><select v-model="a11y" aria-label="无障碍状态" class="form-select">
                <option value="">全部无障碍</option>
                <option value="enabled">已开启</option>
                <option value="disabled">已关闭</option></select
            ><select v-model="status" aria-label="在线状态" class="form-select">
                <option value="">全部状态</option>
                <option value="online">在线</option>
                <option value="offline">离线</option></select
            ><button class="btn filter-apply">筛选</button>
        </form>
        <button class="btn" @click="query({ q: '', source: '', a11y: '', status: '', page: 1 })">
            清除筛选</button
        ><span class="selection-count" v-if="selected.length">已选择 {{ selected.length }} 台</span
        ><span class="fleet-sample-label">示例不代表真机在线</span>
    </div>
    <div v-if="error" role="alert" class="alert alert-danger m-3">
        {{ error }} <button class="btn" @click="load">重试</button>
    </div>
    <p v-if="notice" role="status" class="m-3">{{ notice }}</p>
    <div class="fleet-table-wrap" :aria-busy="loading">
        <table class="table table-vcenter fleet-table">
            <thead>
                <tr>
                    <th class="select-cell">
                        <input
                            type="checkbox"
                            aria-label="选择当前页"
                            :checked="
                                !!result?.data.length && selected.length === result?.data.length
                            "
                            @change="
                                selected = $event.target.checked ? result.data.map((d) => d.id) : []
                            "
                        />
                    </th>
                    <th>预览</th>
                    <SortHeading
                        v-for="[key, label] in columns"
                        :key="key"
                        :field="key"
                        :label="label"
                        :sort="result?.filters.sort"
                        :direction="result?.filters.direction"
                        @sort="sort"
                    />
                    <th>连接状态</th>
                    <th>操作</th>
                </tr>
            </thead>
            <tbody>
                <tr
                    v-for="row in result?.data"
                    :key="row.id"
                    class="fleet-device-row"
                    :class="{
                        'is-selected': selected.includes(row.id),
                        'is-blacklisted': row.is_blacklisted,
                    }"
                    :data-device-id="row.id"
                    tabindex="0"
                    :aria-label="`${row.name}，按回车进入设备详情`"
                    @click="openRow($event, row)"
                    @keydown="rowKey($event, row)"
                >
                    <td @click.stop>
                        <input
                            v-model="selected"
                            type="checkbox"
                            :value="row.id"
                            :aria-label="`选择 ${row.name}`"
                        />
                    </td>
                    <td>
                        <span class="phone-preview" :class="`preview-${row.id % 4}`"
                            ><span>{{ row.source === 'sample' ? '示例' : '记录' }}</span></span
                        >
                    </td>
                    <td v-for="[key] in columns" :key="key">
                        <RouterLink
                            v-if="key === 'name'"
                            :to="`/devices/${row.id}`"
                            class="fleet-device-name"
                            >{{ row.name }}</RouterLink
                        ><span
                            v-else
                            :class="{
                                'fleet-id': key === 'id',
                                'fleet-note': key === 'note',
                                'value-green': key === 'a11y' && row.accessibility_enabled,
                            }"
                            :title="String(value(row, key))"
                            >{{ value(row, key) }}</span
                        >
                    </td>
                    <td>
                        <span
                            class="status-chip"
                            :class="row.is_blacklisted ? 'blacklisted' : row.status"
                            >{{
                                row.is_blacklisted
                                    ? '已拉黑'
                                    : row.status === 'online'
                                      ? '在线'
                                      : row.source === 'sample'
                                        ? '示例记录'
                                        : '离线'
                            }}</span
                        >
                    </td>
                    <td @click.stop>
                        <div class="fleet-row-actions">
                            <button
                                class="btn row-blacklist"
                                :disabled="busyId !== null"
                                @click="manage(row)"
                            >
                                {{ row.is_blacklisted ? '取消拉黑' : '拉黑' }}
                            </button>
                            <button
                                class="btn row-delete"
                                :disabled="busyId !== null"
                                @click="manage(row, true)"
                            >
                                删除
                            </button>
                        </div>
                    </td>
                </tr>
                <tr v-if="!result?.data.length">
                    <td :colspan="columns.length + 4" class="empty-state">
                        {{ loading ? '正在加载设备…' : '暂无匹配设备；可调整筛选条件。' }}
                    </td>
                </tr>
            </tbody>
        </table>
    </div>
    <footer class="fleet-pagination">
        <span
            >共 {{ result?.total ?? 0 }} 条 · 第 {{ result?.page ?? 1 }} 页 ·
            {{ loading ? '读取中' : '本地数据' }}</span
        >
        <div class="page-actions">
            <RouterLink to="/snapshots">快照档案</RouterLink
            ><RouterLink to="/events">观察记录</RouterLink
            ><button
                class="btn btn-sm"
                :disabled="!result || result.page <= 1"
                @click="query({ page: result.page - 1 })"
            >
                上一页</button
            ><button
                class="btn btn-sm"
                :disabled="!result || result.page * 10 >= result.total"
                @click="query({ page: result.page + 1 })"
            >
                下一页
            </button>
        </div>
    </footer>
</template>
