<script setup>
import { computed, onUnmounted, ref, watch } from 'vue';
import { onBeforeRouteLeave, useRoute, useRouter } from 'vue-router';
import { api } from '../api.js';
import { session } from '../session.js';
import { setFleetStats } from '../fleet-stats.js';
import {
    DEVICE_CACHE_BATCH,
    DEVICE_PAGE_SIZE,
    deviceListQuery,
    localDevicePage,
} from '../device-list.js';
import SortHeading from '../components/SortHeading.vue';

const route = useRoute();
const router = useRouter();
const result = ref(null);
const error = ref('');
const notice = ref('');
const loading = ref(false);
const busy = ref(false);
const selected = ref([]);
const searchDraft = ref('');
const selectAllInput = ref(null);
const allowedSort = new Set(['id', 'brand', 'account', 'note']);
const canManage = computed(() => ['superadmin', 'studio_admin'].includes(session.user?.role));
const accountKey = () =>
    JSON.stringify([
        session.user?.id,
        session.user?.role,
        session.user?.projectId,
        session.user?.parentAccountId,
        session.user?.username,
    ]);
const filters = computed(() => ({
    q: String(route.query.q || ''),
    sort: allowedSort.has(String(route.query.sort)) ? String(route.query.sort) : 'id',
    direction: route.query.direction === 'desc' ? 'desc' : 'asc',
}));
const view = computed(() =>
    localDevicePage(result.value, {
        ...filters.value,
        page: route.query.page,
        blacklisted: '1',
    }),
);
const rows = computed(() => view.value?.data || []);
const pageCount = computed(() =>
    Math.max(1, Math.ceil((view.value?.total || 0) / DEVICE_PAGE_SIZE)),
);
const allSelected = computed(
    () => rows.value.length > 0 && rows.value.every((row) => selected.value.includes(row.id)),
);
const pageItems = computed(() => {
    const total = pageCount.value;
    if (total <= 7) return Array.from({ length: total }, (_, index) => index + 1);
    const start = Math.max(2, Math.min((view.value?.page || 1) - 2, total - 5));
    const end = Math.min(total - 1, start + 4);
    return [
        1,
        ...(start > 2 ? ['gap-left'] : []),
        ...Array.from({ length: end - start + 1 }, (_, index) => start + index),
        ...(end < total - 1 ? ['gap-right'] : []),
        total,
    ];
});
const scope = computed(() =>
    session.user?.role === 'superadmin' ? '当前授权范围' : '仅本总台及下属',
);
const scopeHint = computed(() =>
    session.user?.role === 'superadmin'
        ? '按当前授权范围显示拉黑设备。释放后可再次接入，历史记录保留。'
        : '只显示本总台及下属的拉黑设备。释放后可再次接入，历史记录保留。',
);

let readController;
let releaseController;
let readFilterKey = '';
let active = true;
function cancelRequests() {
    readController?.abort();
    releaseController?.abort();
    readController = undefined;
    releaseController = undefined;
    loading.value = false;
    busy.value = false;
}
function sameAccount(key) {
    return active && canManage.value && accountKey() === key;
}
async function load() {
    if (!active || !canManage.value || busy.value) return;
    readController?.abort();
    const request = (readController = new AbortController());
    const key = accountKey();
    const query = { ...filters.value };
    readFilterKey = deviceListQuery(query);
    loading.value = true;
    error.value = '';
    selected.value = [];
    try {
        const fetchPage = (page) =>
            api(`/api/devices?${deviceListQuery(query, page)}`, { signal: request.signal });
        const first = await fetchPage(1);
        if (request.signal.aborted || !sameAccount(key)) return;
        const cache = new Map(first.data.map((row) => [row.id, row]));
        const batches = Math.ceil(first.total / DEVICE_CACHE_BATCH);
        for (let page = 2; page <= batches; page++) {
            const batch = await fetchPage(page);
            if (request.signal.aborted || !sameAccount(key)) return;
            for (const row of batch.data) cache.set(row.id, row);
        }
        result.value = { ...first, data: [...cache.values()] };
        setFleetStats(first.stats);
    } catch (failure) {
        if (failure.name !== 'AbortError' && sameAccount(key)) {
            error.value = failure.message;
            selected.value = [];
        }
    } finally {
        if (readController === request) loading.value = false;
    }
}

watch(
    () => route.query.q,
    (q) => (searchDraft.value = String(q || '')),
    { immediate: true },
);
function stopReleaseForQuery() {
    if (!busy.value) return false;
    releaseController?.abort();
    releaseController = undefined;
    busy.value = false;
    selected.value = [];
    notice.value = '列表条件已变化，已停止后续释放。已提交的操作以重新读取的结果为准。';
    return true;
}
watch(
    () => deviceListQuery(filters.value),
    () => {
        stopReleaseForQuery();
        selected.value = [];
        result.value = null;
        load();
    },
    { immediate: true, flush: 'sync' },
);
// App's top search and browser history can change the URL while this page is busy.
watch(
    () => route.fullPath,
    () => {
        // Search/order changes are handled by the API-query watcher only.
        if (deviceListQuery(filters.value) !== readFilterKey) return;
        if (stopReleaseForQuery()) load();
    },
    { flush: 'sync' },
);
watch(
    view,
    (page) => {
        selected.value = selected.value.filter((id) => page?.data.some((row) => row.id === id));
        if (page && route.query.page && String(route.query.page) !== String(page.page))
            router.replace({ path: route.path, query: { ...route.query, page: page.page } });
    },
    { flush: 'sync' },
);
watch(
    [rows, selected, selectAllInput],
    () => {
        if (selectAllInput.value)
            selectAllInput.value.indeterminate = selected.value.length > 0 && !allSelected.value;
    },
    { flush: 'post' },
);
watch(
    accountKey,
    () => {
        cancelRequests();
        result.value = null;
        selected.value = [];
        error.value = '';
        notice.value = '';
        if (active && canManage.value) load();
    },
    { flush: 'sync' },
);
onBeforeRouteLeave(() => {
    active = false;
    cancelRequests();
});
onUnmounted(() => {
    active = false;
    cancelRequests();
});

function query(changes) {
    if (busy.value || loading.value) return;
    selected.value = [];
    notice.value = '';
    router.push({ path: route.path, query: { ...route.query, ...changes } });
}
function search() {
    query({ q: searchDraft.value.trim(), page: 1 });
}
function sort(field) {
    if (!allowedSort.has(field)) return;
    query({
        sort: field,
        direction:
            filters.value.sort === field && filters.value.direction === 'asc' ? 'desc' : 'asc',
        page: 1,
    });
}
function toggleAll(event) {
    if (busy.value || loading.value) return;
    selected.value = event.target.checked ? rows.value.map((row) => row.id) : [];
}
function toggleRow(event, row) {
    if (busy.value || loading.value) return;
    selected.value = event.target.checked
        ? [...new Set([...selected.value, row.id])]
        : selected.value.filter((id) => id !== row.id);
}
async function release(ids) {
    if (busy.value || loading.value || !active || !canManage.value) return;
    const targets = rows.value.filter((row) => ids.includes(row.id) && row.is_blacklisted === true);
    if (!targets.length) return;
    const key = accountKey();
    const label =
        targets.length === 1 ? `设备「${targets[0].public_id}」` : `${targets.length} 台设备`;
    if (!window.confirm(`确认释放${label}？\n释放后可使用仍有效的凭证再次接入，历史记录保留。`))
        return;
    if (!sameAccount(key)) return;
    busy.value = true;
    notice.value = '';
    error.value = '';
    const request = (releaseController = new AbortController());
    const failures = [];
    let permissionStopped = false;
    let succeeded = 0;
    try {
        for (const row of targets) {
            if (request.signal.aborted || !sameAccount(key)) break;
            try {
                await api(`/api/devices/${row.id}/blacklist`, {
                    method: 'PATCH',
                    body: JSON.stringify({ blacklisted: false }),
                    signal: request.signal,
                });
                if (request.signal.aborted || !sameAccount(key)) break;
                succeeded++;
                result.value = {
                    ...result.value,
                    data: result.value.data.filter((device) => device.id !== row.id),
                };
                selected.value = selected.value.filter((id) => id !== row.id);
            } catch (failure) {
                if (failure.name === 'AbortError' || !sameAccount(key)) break;
                failures.push({ row, message: failure.message });
                if (failure.status === 401 || failure.status === 403) {
                    permissionStopped = true;
                    break;
                }
            }
        }
        if (!request.signal.aborted && sameAccount(key)) {
            if (succeeded) notice.value = `已释放 ${succeeded} 台设备，历史记录保留。`;
            if (failures.length)
                error.value = `释放成功 ${succeeded} 台，失败 ${failures.length} 台：${failures
                    .map(({ row, message }) => `${row.public_id}（${message}）`)
                    .join(
                        '；',
                    )}。${permissionStopped ? `权限校验未通过，后续释放已停止；${targets.length - succeeded - failures.length} 台未提交，仍在列表中。` : '可重试仍在列表中的设备。'}`;
        }
    } finally {
        if (releaseController === request) busy.value = false;
    }
}
</script>

<template>
    <section class="blacklist-page" :aria-busy="loading || busy">
        <header class="blacklist-toolbar">
            <h1><span class="blacklist-heading-icon" aria-hidden="true">⛔</span> 拉黑设备</h1>
            <span class="blacklist-count"
                >共 <strong>{{ view?.total ?? 0 }}</strong> 台（{{ scope }}）</span
            >
            <form class="blacklist-search" @submit.prevent="search">
                <input
                    v-model="searchDraft"
                    class="form-control"
                    aria-label="搜索拉黑设备"
                    placeholder="搜索设备 ID / 品牌 / 账号 / 备注…"
                    maxlength="100"
                    :disabled="busy || loading"
                />
                <button class="visually-hidden" type="submit" :disabled="busy || loading">
                    搜索
                </button>
            </form>
            <button
                type="button"
                class="btn blacklist-refresh"
                :disabled="busy || loading"
                @click="load"
            >
                {{ loading ? '刷新中…' : '刷新' }}
            </button>
            <button
                type="button"
                class="btn blacklist-bulk-release"
                :disabled="!selected.length || busy || loading"
                @click="release(selected)"
            >
                释放选中 ({{ selected.length }})
            </button>
            <span class="blacklist-scope-hint" :title="scopeHint">{{ scopeHint }}</span>
        </header>
        <div v-if="error" class="blacklist-message blacklist-error" role="alert">
            <span>{{ error }}</span>
            <button v-if="!busy" type="button" class="btn" :disabled="loading" @click="load">
                重试
            </button>
            <span v-if="result" class="blacklist-stale">列表显示上次读取的数据。</span>
        </div>
        <div v-if="notice" class="blacklist-message blacklist-notice" role="status">
            {{ notice }}
        </div>
        <div class="blacklist-table-wrap" :aria-busy="loading || busy">
            <table class="blacklist-table">
                <colgroup>
                    <col class="blacklist-select-column" />
                    <col />
                    <col />
                    <col />
                    <col />
                    <col />
                    <col />
                    <col />
                    <col />
                    <col class="blacklist-action-column" />
                </colgroup>
                <thead>
                    <tr>
                        <th class="blacklist-select-cell">
                            <input
                                ref="selectAllInput"
                                type="checkbox"
                                aria-label="选择全部拉黑设备"
                                :checked="allSelected"
                                :disabled="!rows.length || loading || busy"
                                @change="toggleAll"
                            />
                        </th>
                        <SortHeading
                            label="设备 ID"
                            field="id"
                            :sort="filters.sort"
                            :direction="filters.direction"
                            @sort="sort"
                        />
                        <SortHeading
                            label="品牌 / 型号"
                            field="brand"
                            :sort="filters.sort"
                            :direction="filters.direction"
                            @sort="sort"
                        />
                        <th>最后 IP</th>
                        <SortHeading
                            label="账号"
                            field="account"
                            :sort="filters.sort"
                            :direction="filters.direction"
                            @sort="sort"
                        />
                        <SortHeading
                            label="备注"
                            field="note"
                            :sort="filters.sort"
                            :direction="filters.direction"
                            @sort="sort"
                        />
                        <th>原因</th>
                        <th>操作人</th>
                        <th>拉黑时间</th>
                        <th>操作</th>
                    </tr>
                </thead>
                <tbody>
                    <tr
                        v-for="row in rows"
                        :key="row.id"
                        class="blacklist-row"
                        :class="{ 'is-selected': selected.includes(row.id) }"
                        :data-device-id="row.id"
                    >
                        <td class="blacklist-select-cell">
                            <input
                                type="checkbox"
                                :aria-label="`选择设备 ${row.public_id}`"
                                :checked="selected.includes(row.id)"
                                :disabled="busy || loading"
                                @change="toggleRow($event, row)"
                            />
                        </td>
                        <td class="blacklist-device-id" :title="row.public_id">
                            <RouterLink :to="`/devices/${row.id}`">{{ row.public_id }}</RouterLink>
                        </td>
                        <td :title="row.brand">{{ row.brand || '—' }}</td>
                        <td><span class="blacklist-pending" title="最后 IP 待记录">—</span></td>
                        <td :title="row.owner_username">{{ row.owner_username || '—' }}</td>
                        <td :title="row.note">{{ row.note || '—' }}</td>
                        <td><span class="blacklist-pending" title="拉黑原因待记录">—</span></td>
                        <td><span class="blacklist-pending" title="操作人待记录">—</span></td>
                        <td><span class="blacklist-pending" title="拉黑时间待记录">—</span></td>
                        <td>
                            <button
                                type="button"
                                class="btn blacklist-row-release"
                                :disabled="busy || loading"
                                @click="release([row.id])"
                            >
                                释放
                            </button>
                        </td>
                    </tr>
                    <tr v-if="!rows.length" class="blacklist-empty-row">
                        <td colspan="10">
                            {{
                                loading
                                    ? '正在读取拉黑设备…'
                                    : error
                                      ? '读取失败，请重试'
                                      : '暂无拉黑设备'
                            }}
                        </td>
                    </tr>
                </tbody>
            </table>
        </div>
        <footer class="fleet-pagination" :aria-busy="loading || busy">
            <div class="fleet-pagination-center">
                <span class="fleet-pagination-summary">共 {{ view?.total ?? 0 }} 台</span>
                <nav class="fleet-page-actions" aria-label="拉黑设备分页">
                    <button
                        v-if="pageCount > 1"
                        type="button"
                        class="fleet-page-button fleet-page-direction"
                        aria-label="上一页"
                        :disabled="loading || busy || !view || view.page <= 1"
                        @click="query({ page: view.page - 1 })"
                    >
                        ‹
                    </button>
                    <template v-for="item in pageItems" :key="item">
                        <span
                            v-if="typeof item !== 'number'"
                            class="fleet-page-gap"
                            aria-hidden="true"
                            >…</span
                        >
                        <button
                            v-else
                            type="button"
                            class="fleet-page-button"
                            :class="{ active: item === (view?.page ?? 1) }"
                            :aria-label="`第 ${item} 页`"
                            :aria-current="item === (view?.page ?? 1) ? 'page' : undefined"
                            :disabled="loading || busy || !view"
                            @click="item !== view?.page && query({ page: item })"
                        >
                            {{ item }}
                        </button>
                    </template>
                    <button
                        v-if="pageCount > 1"
                        type="button"
                        class="fleet-page-button fleet-page-direction"
                        aria-label="下一页"
                        :disabled="loading || busy || !view || view.page >= pageCount"
                        @click="query({ page: view.page + 1 })"
                    >
                        ›
                    </button>
                </nav>
            </div>
        </footer>
    </section>
</template>

<style scoped>
.blacklist-page {
    display: flex;
    flex-direction: column;
    min-height: calc(100vh - var(--console-header-height));
    padding-bottom: 45px;
    background: var(--lab-surface);
    color: var(--lab-ink);
}
.blacklist-toolbar {
    display: flex;
    flex-wrap: nowrap;
    align-items: center;
    gap: 10px;
    height: 50px;
    padding: 7px 12px;
    border-bottom: 1px solid var(--lab-line);
    white-space: nowrap;
}
.blacklist-toolbar h1 {
    display: flex;
    align-items: center;
    gap: 4px;
    flex: 0 0 auto;
    margin: 0;
    font-size: 14px;
    font-weight: 700;
    line-height: 20px;
}
.blacklist-heading-icon {
    font-size: 13px;
}
.blacklist-count {
    flex: 0 0 auto;
    color: var(--lab-muted);
    font-size: 12px;
}
.blacklist-count strong {
    font-weight: 600;
}
.blacklist-search {
    flex: 0 0 310px;
    width: 310px;
    margin: 0;
}
.blacklist-search .form-control {
    height: 32px;
    padding: 6px 12px;
    border: 1px solid var(--lab-line);
    border-radius: 8px;
    background: var(--lab-bg);
    color: var(--lab-ink);
    font-size: 12px;
}
.blacklist-toolbar .btn {
    flex-shrink: 0;
    height: 32px;
    min-height: 32px;
    padding: 6px 14px;
    border: 1px solid var(--lab-line);
    border-radius: 7px;
    background: var(--lab-surface);
    color: var(--lab-ink);
    font-size: 12px;
}
.blacklist-toolbar .blacklist-bulk-release {
    border-color: #b4edc7;
    color: #30b465;
}
.blacklist-toolbar .blacklist-bulk-release:disabled {
    opacity: 0.75;
}
.blacklist-toolbar .blacklist-bulk-release:hover:not(:disabled),
.blacklist-row-release:hover:not(:disabled) {
    background: #effcf3;
}
.blacklist-scope-hint {
    flex: 1 1 auto;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    color: #a2a9b8;
    font-size: 12px;
}
.blacklist-message {
    display: flex;
    align-items: center;
    gap: 8px;
    min-height: 36px;
    padding: 6px 14px;
    border-bottom: 1px solid var(--lab-line);
}
.blacklist-error {
    color: #c54545;
    background: #fff7f7;
}
.blacklist-notice {
    color: #248259;
    background: #f0fbf5;
}
.blacklist-stale {
    color: var(--lab-muted);
}
.blacklist-table-wrap {
    flex: 1 0 auto;
    width: 100%;
}
.blacklist-table {
    width: 100%;
    min-width: calc(1280px - var(--console-rail-width));
    table-layout: fixed;
    border-collapse: collapse;
    font-size: 12px;
}
.blacklist-select-column {
    width: 44px;
}
.blacklist-action-column {
    width: 92px;
}
.blacklist-table th {
    height: 36px;
    padding: 0 10px;
    border-bottom: 1px solid var(--lab-line);
    background: #f2f3f8;
    color: #858d9f;
    font-size: 11px;
    font-weight: 600;
    text-align: left;
    white-space: nowrap;
}
.blacklist-table td {
    height: 56px;
    padding: 8px 10px;
    border-bottom: 1px solid var(--lab-line);
    vertical-align: middle;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
}
.blacklist-table .blacklist-select-cell {
    text-align: center;
}
.blacklist-table input[type='checkbox'] {
    display: inline-block;
    width: 13px;
    height: 13px;
    margin: 0;
    vertical-align: middle;
    accent-color: var(--lab-accent);
}
.blacklist-table .blacklist-device-id {
    font-weight: 500;
}
.blacklist-device-id a {
    color: inherit;
    text-decoration: none;
}
.blacklist-device-id a:hover {
    color: var(--lab-accent);
    text-decoration: underline;
}
.blacklist-table .blacklist-pending {
    color: var(--lab-muted);
}
.blacklist-row:hover,
.blacklist-row.is-selected {
    background: #f3f6ff;
}
.blacklist-row-release {
    height: 28px;
    min-height: 28px;
    padding: 4px 11px;
    border: 1px solid #b4edc7;
    border-radius: 6px;
    color: #30a961;
    background: var(--lab-surface);
}
.blacklist-empty-row td {
    height: 64px;
    padding: 0 12px;
    text-align: center;
    color: var(--lab-muted);
    font-size: 12px;
}
:global([data-bs-theme='dark'] .blacklist-table th) {
    background: #1e2737;
    color: #a2adc2;
}
:global([data-bs-theme='dark'] .blacklist-row:hover),
:global([data-bs-theme='dark'] .blacklist-row.is-selected) {
    background: #22304a;
}
:global([data-bs-theme='dark'] .blacklist-toolbar .blacklist-bulk-release),
:global([data-bs-theme='dark'] .blacklist-row-release) {
    border-color: #2f7252;
    color: #6bd39c;
}
:global([data-bs-theme='dark'] .blacklist-toolbar .blacklist-bulk-release:hover:not(:disabled)),
:global([data-bs-theme='dark'] .blacklist-row-release:hover:not(:disabled)) {
    background: #183b2d;
}
:global([data-bs-theme='dark'] .blacklist-error) {
    color: #f5aaaa;
    background: #382626;
}
:global([data-bs-theme='dark'] .blacklist-notice) {
    color: #8ddeba;
    background: #19382e;
}
</style>
