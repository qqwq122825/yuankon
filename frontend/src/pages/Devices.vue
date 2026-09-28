<script setup>
import { ref, watch, onUnmounted } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { api, mutate, formatDate } from '../api.js';
import { connection } from '../connection.js';
import { setFleetStats } from '../fleet-stats.js';
import SortHeading from '../components/SortHeading.vue';

const route = useRoute(),
    router = useRouter(),
    result = ref(null),
    error = ref(''),
    loading = ref(false),
    busyId = ref(null),
    notice = ref(''),
    selected = ref([]),
    memoDevice = ref(null),
    memoResult = ref({ data: [], total: 0 }),
    memoLoading = ref(false),
    memoBusy = ref(false),
    memoError = ref(''),
    memoEditor = ref(false),
    memoForm = ref({ id: null, body: '', label: 'none' });
let controller, timer;

const quickFilters = [
    { key: 'status', value: 'online', label: '在线', tone: 'online' },
    { key: 'status', value: 'offline', label: '离线', tone: 'offline' },
    { key: 'a11y', value: 'enabled', label: '无障碍', tone: 'a11y' },
    { key: 'a11y', value: 'disabled', label: '未开无障碍', tone: 'offline' },
    { key: 'source', value: 'api', label: '设备上报', tone: 'source' },
    { key: 'source', value: 'import', label: '历史记录', tone: 'source' },
    { key: 'source', value: 'sample', label: '合成示例', tone: 'source' },
];
const columns = [
    { key: 'id', label: 'ID', sort: 'id' },
    { key: 'wallpaper', label: '壁纸' },
    { key: 'account', label: '账号', sort: 'account' },
    { key: 'note', label: '备注', sort: 'note' },
    { key: 'memo', label: '备忘', sort: 'memo' },
    { key: 'app', label: '应用', sort: 'app' },
    { key: 'brand', label: '品牌', sort: 'brand' },
    { key: 'android', label: '版本', sort: 'android' },
    { key: 'app_version', label: 'APK', sort: 'app_version' },
    { key: 'region', label: '地区' },
    { key: 'network', label: '网络' },
    { key: 'password', label: '密码' },
    { key: 'battery', label: '电池', sort: 'battery' },
    { key: 'online', label: '在线' },
    { key: 'screen', label: '屏幕' },
    { key: 'a11y', label: '无障碍', sort: 'a11y' },
    { key: 'injection', label: '注入' },
    { key: 'ai', label: 'AI' },
    { key: 'installed', label: '安装时间', sort: 'installed' },
    { key: 'latency', label: '延迟' },
];
const memoLabels = [
    ['none', '无标签'],
    ['important', '重要'],
    ['follow_up', '待跟进'],
    ['handled', '已处理'],
];
const memoLabel = (value) =>
    ({ none: '无标签', important: '重要', follow_up: '待跟进', handled: '已处理' })[value] ||
    '无标签';

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
        setFleetStats(data.stats);
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
watch(() => route.fullPath, load, { immediate: true });
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
function filterActive(filter) {
    return String(route.query[filter.key] || '') === filter.value;
}
function toggleFilter(filter) {
    query({ [filter.key]: filterActive(filter) ? '' : filter.value, page: 1 });
}
function clearFilters() {
    query({ q: '', source: '', a11y: '', status: '', page: 1 });
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
function formatInstallDate(value) {
    if (!value) return '—';
    const parts = Object.fromEntries(
        new Intl.DateTimeFormat('zh-CN', {
            timeZone: 'Asia/Shanghai',
            month: '2-digit',
            day: '2-digit',
            hour: '2-digit',
            minute: '2-digit',
            second: '2-digit',
            hour12: false,
        })
            .formatToParts(new Date(Number(value)))
            .map((part) => [part.type, part.value]),
    );
    return `${parts.month}-${parts.day} ${parts.hour}:${parts.minute}:${parts.second}`;
}
function screenState(row) {
    if (row.isScreenOn === null || row.isScreenOn === undefined) return '—';
    if (!row.isScreenOn) return '熄屏';
    return row.isLocked ? '锁屏' : '亮屏';
}
function value(row, key) {
    const values = {
        id: row.public_id,
        account: row.owner_username,
        note: row.note,
        app: row.app_name,
        brand: row.brand,
        android: row.android_version,
        app_version: row.app_version,
        region: null,
        network: null,
        password: null,
        battery: row.battery === null ? null : `${row.battery}%`,
        screen: screenState(row),
        injection: null,
        ai: null,
        installed: formatInstallDate(row.installed_at),
        latency: null,
    };
    return values[key] === null || values[key] === undefined || values[key] === ''
        ? '—'
        : values[key];
}

function resetMemoForm() {
    memoForm.value = { id: null, body: '', label: 'none' };
    memoEditor.value = false;
}
function updateMemoCount(total) {
    const count = Number(total) || 0;
    if (memoDevice.value) memoDevice.value.memo_count = count;
    const currentRow = result.value?.data.find((row) => row.id === memoDevice.value?.id);
    if (currentRow) currentRow.memo_count = count;
}
async function loadMemos() {
    if (!memoDevice.value) return;
    memoLoading.value = true;
    memoError.value = '';
    try {
        memoResult.value = await api(`/api/devices/${memoDevice.value.id}/memos`);
        updateMemoCount(memoResult.value.total);
    } catch (e) {
        memoError.value = e.message;
    } finally {
        memoLoading.value = false;
    }
}
async function openMemos(row) {
    memoDevice.value = row;
    memoResult.value = { data: [], total: Number(row.memo_count) || 0 };
    memoError.value = '';
    resetMemoForm();
    await loadMemos();
}
function closeMemos() {
    if (memoBusy.value) return;
    memoDevice.value = null;
    resetMemoForm();
}
function addMemo() {
    memoForm.value = { id: null, body: '', label: 'none' };
    memoEditor.value = true;
}
function editMemo(memo) {
    memoForm.value = { id: memo.id, body: memo.body, label: memo.label };
    memoEditor.value = true;
}
async function saveMemo() {
    if (!memoDevice.value || !memoForm.value.body.trim() || memoBusy.value) return;
    memoBusy.value = true;
    memoError.value = '';
    try {
        const id = memoForm.value.id;
        await mutate(
            `/api/devices/${memoDevice.value.id}/memos${id ? `/${id}` : ''}`,
            id ? 'PATCH' : 'POST',
            { body: memoForm.value.body, label: memoForm.value.label },
        );
        resetMemoForm();
        await loadMemos();
    } catch (e) {
        memoError.value = e.message;
    } finally {
        memoBusy.value = false;
    }
}
async function removeMemo(memo) {
    if (!memoDevice.value || memoBusy.value || !window.confirm('确认删除这条备忘？')) return;
    memoBusy.value = true;
    memoError.value = '';
    try {
        await mutate(`/api/devices/${memoDevice.value.id}/memos/${memo.id}`, 'DELETE', {});
        if (memoForm.value.id === memo.id) resetMemoForm();
        await loadMemos();
    } catch (e) {
        memoError.value = e.message;
    } finally {
        memoBusy.value = false;
    }
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
        ><span class="toolbar-hint">刷新后更新列表</span>
        <div class="fleet-filter-strip" role="group" aria-label="设备筛选">
            <button
                v-for="filter in quickFilters"
                :key="`${filter.key}:${filter.value}`"
                type="button"
                class="fleet-filter-chip"
                :class="[`tone-${filter.tone}`, { active: filterActive(filter) }]"
                :aria-pressed="filterActive(filter)"
                @click="toggleFilter(filter)"
            >
                <span class="filter-dot" aria-hidden="true"></span>{{ filter.label }}
            </button>
        </div>
        <button class="btn filter-reset" @click="clearFilters">清除筛选</button
        ><span class="selection-count" v-if="selected.length">已选择 {{ selected.length }} 台</span
        ><span class="fleet-sample-label">示例不代表真机在线</span>
    </div>

    <div v-if="error" role="alert" class="alert alert-danger m-3">
        {{ error }} <button class="btn" @click="load">重试</button>
    </div>
    <p v-if="notice" role="status" class="m-3">{{ notice }}</p>

    <div class="fleet-table-wrap" :aria-busy="loading">
        <table class="table table-vcenter fleet-table fleet-table-reference">
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
                    <template v-for="column in columns" :key="column.key">
                        <SortHeading
                            v-if="column.sort"
                            :field="column.sort"
                            :label="column.label"
                            :sort="result?.filters.sort"
                            :direction="result?.filters.direction"
                            @sort="sort"
                        />
                        <th v-else>{{ column.label }}</th>
                    </template>
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
                    <td v-for="column in columns" :key="column.key">
                        <span v-if="column.key === 'id'" class="fleet-id" :title="row.public_id">{{
                            row.public_id
                        }}</span>
                        <span
                            v-else-if="column.key === 'wallpaper'"
                            class="phone-preview"
                            :class="[`preview-${row.id % 4}`, { 'has-thumbnail': row.thumbnail }]"
                            ><img
                                v-if="row.thumbnail"
                                :src="row.thumbnail.imageUrl"
                                :alt="`${row.name} 临时首图缩略图`"
                                @error="row.thumbnail = null"
                            /><span v-else>{{
                                row.source === 'sample' ? '示例' : '记录'
                            }}</span></span
                        >
                        <button
                            v-else-if="column.key === 'memo'"
                            type="button"
                            class="memo-count-button"
                            :class="{ empty: !Number(row.memo_count) }"
                            :aria-label="`查看 ${row.name} 的备忘（${row.memo_count || 0} 条）`"
                            @click.stop="openMemos(row)"
                        >
                            <span aria-hidden="true">{{
                                Number(row.memo_count) ? '📝' : '＋'
                            }}</span
                            >{{ Number(row.memo_count) || '' }}
                        </button>
                        <span
                            v-else-if="column.key === 'online'"
                            class="status-chip"
                            :class="row.is_blacklisted ? 'blacklisted' : row.status"
                            >{{
                                row.is_blacklisted
                                    ? '已拉黑'
                                    : row.status === 'online'
                                      ? '在线'
                                      : row.source === 'sample'
                                        ? '示例'
                                        : '离线'
                            }}</span
                        >
                        <span
                            v-else-if="column.key === 'screen'"
                            class="fleet-screen-state"
                            :class="{
                                active: row.isScreenOn,
                                locked: row.isLocked,
                            }"
                            >{{ screenState(row) }}</span
                        >
                        <span
                            v-else-if="column.key === 'a11y'"
                            class="fleet-a11y-state"
                            :class="{ active: row.accessibility_enabled }"
                            >{{
                                row.accessibility_enabled === null
                                    ? '—'
                                    : row.accessibility_enabled
                                      ? '已开启'
                                      : '未开启'
                            }}</span
                        >
                        <span
                            v-else
                            :class="{
                                'fleet-note': column.key === 'note',
                                'battery-value': column.key === 'battery' && row.battery !== null,
                                low: column.key === 'battery' && row.battery < 20,
                                'value-muted': [
                                    'region',
                                    'network',
                                    'password',
                                    'injection',
                                    'ai',
                                    'latency',
                                ].includes(column.key),
                            }"
                            :title="String(value(row, column.key))"
                            >{{ value(row, column.key) }}</span
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
                    <td :colspan="columns.length + 2" class="empty-state">
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
            <button
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

    <div
        v-if="memoDevice"
        class="memo-modal-backdrop"
        role="presentation"
        @click.self="closeMemos"
        @keydown.esc="closeMemos"
    >
        <section
            class="memo-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="memo-dialog-title"
        >
            <header class="memo-modal-header">
                <div>
                    <h2 id="memo-dialog-title">备忘录 — {{ memoDevice.public_id }}</h2>
                    <p>共 {{ memoResult.total }} 条</p>
                </div>
                <button class="btn memo-close" aria-label="关闭备忘录" @click="closeMemos">
                    ×
                </button>
            </header>
            <div class="memo-modal-toolbar">
                <button class="btn btn-primary" @click="addMemo">＋ 添加</button>
            </div>
            <p v-if="memoError" class="memo-error" role="alert">{{ memoError }}</p>
            <form v-if="memoEditor" class="memo-editor" @submit.prevent="saveMemo">
                <textarea
                    v-model="memoForm.body"
                    maxlength="500"
                    required
                    autofocus
                    aria-label="备忘内容"
                    placeholder="填写备忘内容…"
                ></textarea>
                <div class="memo-label-row" role="group" aria-label="备忘标签">
                    <span>标签：</span>
                    <button
                        v-for="[key, label] in memoLabels"
                        :key="key"
                        type="button"
                        class="memo-label-button"
                        :class="[`label-${key}`, { active: memoForm.label === key }]"
                        :aria-pressed="memoForm.label === key"
                        @click="memoForm.label = key"
                    >
                        {{ label }}
                    </button>
                </div>
                <div class="memo-editor-actions">
                    <button
                        type="submit"
                        class="btn btn-primary"
                        :disabled="memoBusy || !memoForm.body.trim()"
                    >
                        {{ memoForm.id ? '更新' : '保存' }}
                    </button>
                    <button type="button" class="btn" :disabled="memoBusy" @click="resetMemoForm">
                        取消
                    </button>
                </div>
            </form>
            <div class="memo-list" :aria-busy="memoLoading">
                <article v-for="memo in memoResult.data" :key="memo.id" class="memo-item">
                    <div class="memo-item-head">
                        <span class="memo-item-label" :class="`label-${memo.label}`">{{
                            memoLabel(memo.label)
                        }}</span>
                        <div class="memo-item-actions">
                            <button class="btn" @click="editMemo(memo)">编辑</button>
                            <button class="btn delete" @click="removeMemo(memo)">删除</button>
                        </div>
                    </div>
                    <p>{{ memo.body }}</p>
                    <small
                        >{{ memo.author }} ·
                        {{ formatDate(memo.updatedAt || memo.createdAt) }}</small
                    >
                </article>
                <p v-if="!memoLoading && !memoResult.data.length" class="memo-empty">
                    暂无备忘，点击“添加”记录。
                </p>
            </div>
        </section>
    </div>
</template>
