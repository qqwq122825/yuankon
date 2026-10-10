<script setup>
import { computed, ref, useId, watch } from 'vue';
import { useDeviceDemoPreview } from '../composables/useDeviceDemoPreview.js';
import fixture from '../fixtures/device-records-demo.json';
import catalogFixture from '../fixtures/device-apps-demo.json';
import { readRecordDemo } from '../fixtures/device-fixture-protocol.js';

const props = defineProps({
    deviceId: Number,
    deviceSource: { type: String, default: '' },
    observations: { type: Array, default: () => [] },
});
const keywordId = useId();
const {
    demoMode,
    loading,
    error,
    ready,
    feedback,
    contextKey,
    toggleDemo: toggleDemoPreview,
    refresh,
} = useDeviceDemoPreview(props, 'password');
const appFilter = ref('all');
const typeFilter = ref('all');
const keyword = ref('');
const appliedKeyword = ref('');
const localFeedback = ref('');
const metadataOpen = ref(false);
const displayError = computed(() =>
    error.value === '预览状态不符合当前约定，请重试。'
        ? '记录预览状态不符合当前约定，请重试。'
        : error.value,
);
const types = [
    { id: 'app', label: 'APP' },
    { id: 'keyboard', label: '键盘' },
    { id: 'pin', label: 'PIN' },
];
const typeLabels = new Map(types.map((type) => [type.id, type.label]));
const demoData = readRecordDemo(fixture, catalogFixture);
const fixtureProtocol = demoData.valid ? fixture.protocol : undefined;
const datasetId = demoData.valid ? fixture.datasetId : undefined;
const demoRecords = demoData.records.map((item) => ({
    ...item,
    typeLabel: typeLabels.get(item.type),
}));
const applications = computed(() =>
    demoMode.value
        ? Array.from(
              new Map(
                  demoRecords.map((item) => [
                      item.packageName,
                      { packageName: item.packageName, name: item.appName },
                  ]),
              ).values(),
          )
        : [],
);
const normalize = (value) => String(value).normalize('NFKC').toLowerCase();
const records = computed(() => {
    if (!demoMode.value) return [];
    const query = normalize(appliedKeyword.value.trim());
    return demoRecords.filter(
        (item) =>
            (appFilter.value === 'all' || item.packageName === appFilter.value) &&
            (typeFilter.value === 'all' || item.type === typeFilter.value) &&
            (!query ||
                [item.typeLabel, item.content, item.appName, item.packageName].some((value) =>
                    normalize(value).includes(query),
                )),
    );
});
const observations = computed(() =>
    props.observations
        .filter((item) => item?.scenario === 'password_field')
        .map((item) => ({
            scenario: metadataValue(item.scenario),
            channel: metadataValue(item.channel),
            case_id: metadataValue(item.case_id),
            text_returned: metadataValue(item.text_returned),
            synthetic_match: metadataValue(item.synthetic_match),
        })),
);
function metadataValue(value) {
    if (typeof value === 'boolean') return value ? 'true' : 'false';
    if (typeof value === 'number' && Number.isFinite(value)) return String(value);
    if (typeof value === 'string' && value.length) return value;
    return '—';
}
function recordTime(value) {
    const date = new Date(value);
    if (!Number.isFinite(date.getTime())) return '—';
    return new Intl.DateTimeFormat('zh-CN', {
        timeZone: 'Asia/Shanghai',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        hour12: false,
    }).format(date);
}
let feedbackRevision = 0;
function resetFilters() {
    appFilter.value = 'all';
    typeFilter.value = 'all';
    keyword.value = '';
    appliedKeyword.value = '';
}
function toggleDemo() {
    if (!ready.value) return;
    feedbackRevision++;
    toggleDemoPreview();
    resetFilters();
    localFeedback.value = '';
}
function applyFilters() {
    feedbackRevision++;
    appliedKeyword.value = keyword.value;
    localFeedback.value = '已应用本地筛选；未读取设备输入。';
}
async function refreshRecords() {
    const key = contextKey.value;
    feedbackRevision++;
    localFeedback.value = '';
    const revision = feedbackRevision;
    await refresh();
    if (ready.value && key === contextKey.value && revision === feedbackRevision)
        localFeedback.value = '已读取预览状态；设备记录功能尚未接入。';
}
watch(
    contextKey,
    () => {
        feedbackRevision++;
        resetFilters();
        metadataOpen.value = false;
        localFeedback.value = '';
    },
    { flush: 'sync' },
);
</script>

<template>
    <section
        class="record-preview"
        aria-label="密码记录"
        :aria-busy="loading"
        :data-demo="demoMode"
        :data-state="loading ? 'loading' : error ? 'error' : 'not_connected'"
        :data-protocol="fixtureProtocol"
        :data-dataset-id="datasetId"
    >
        <h2 class="record-heading-title">密码记录</h2>
        <form
            class="record-filters"
            aria-label="记录筛选"
            :data-protocol="fixtureProtocol"
            :data-dataset-id="datasetId"
            @submit.prevent="applyFilters"
        >
            <select
                v-model="appFilter"
                class="record-app-filter"
                aria-label="记录应用"
                @change="applyFilters"
            >
                <option value="all">全部应用</option>
                <option
                    v-for="application in applications"
                    :key="application.packageName"
                    :value="application.packageName"
                >
                    {{ application.name }}
                </option>
            </select>
            <select
                v-model="typeFilter"
                class="record-type-filter"
                aria-label="记录类型"
                @change="applyFilters"
            >
                <option value="all">全部类型</option>
                <option v-for="type in types" :key="type.id" :value="type.id">
                    {{ type.label }}
                </option>
            </select>
            <label class="record-keyword-label" :for="keywordId">记录关键词</label>
            <input
                :id="keywordId"
                v-model="keyword"
                class="record-keyword"
                type="search"
                placeholder="搜索关键词…"
                autocomplete="off"
            />
            <button type="submit" class="record-button record-search-button">搜索</button>
            <div class="record-preview-status">
                <span class="record-count">共 {{ records.length }} 条记录</span>
                <span v-if="demoMode" class="record-demo-notice">合成测试数据 · 非设备记录</span>
                <span v-else class="record-preview-caption" title="仅预览界面与研究元数据"
                    >未接入 · UI 预览</span
                >
            </div>
            <div class="record-preview-actions">
                <button
                    type="button"
                    class="record-button"
                    :disabled="loading"
                    @click="refreshRecords"
                >
                    刷新
                </button>
                <button
                    type="button"
                    class="record-button record-demo-button"
                    :aria-pressed="demoMode"
                    :disabled="!ready"
                    @click="toggleDemo"
                >
                    测试数据
                </button>
            </div>
        </form>
        <p v-if="loading" class="record-preview-loading" role="status">正在读取记录预览状态…</p>
        <div v-if="error" class="record-preview-error" role="alert">
            <span>{{ displayError }}</span>
            <button type="button" class="record-button" :disabled="loading" @click="refreshRecords">
                重试预览
            </button>
        </div>
        <p v-if="localFeedback || feedback" class="record-preview-feedback" role="status">
            {{ localFeedback || feedback }}
        </p>
        <table class="record-table">
            <colgroup>
                <col class="record-type-column" />
                <col class="record-content-column" />
                <col class="record-app-column" />
                <col class="record-time-column" />
            </colgroup>
            <thead>
                <tr>
                    <th scope="col">类型</th>
                    <th scope="col">内容</th>
                    <th scope="col">应用</th>
                    <th scope="col">时间</th>
                </tr>
            </thead>
            <tbody>
                <tr
                    v-for="record in records"
                    :key="record.id"
                    class="record-row"
                    :data-record-id="record.id"
                    :data-package="record.packageName"
                    :data-protocol="fixtureProtocol"
                    :data-dataset-id="datasetId"
                    data-synthetic="true"
                >
                    <td class="record-type">
                        <span class="record-type-label" :data-type="record.type">{{
                            record.typeLabel
                        }}</span>
                    </td>
                    <td class="record-content" :title="record.content">{{ record.content }}</td>
                    <td class="record-app" :title="record.packageName">{{ record.appName }}</td>
                    <td class="record-time">
                        <time :datetime="record.occurredAt">{{
                            recordTime(record.occurredAt)
                        }}</time>
                    </td>
                </tr>
            </tbody>
        </table>
        <p v-if="!records.length && (demoMode || (!loading && !error))" class="record-empty">
            {{ demoMode ? '没有匹配的合成记录' : '暂无密码记录' }}
        </p>
        <details
            class="record-metadata"
            :open="metadataOpen"
            @toggle="metadataOpen = $event.target.open"
        >
            <summary>密码场景元数据</summary>
            <p>采集端报告 · 仅展示已记录的五项属性，不含原文。</p>
            <table v-if="observations.length" class="record-metadata-table">
                <thead>
                    <tr>
                        <th>场景</th>
                        <th>通道</th>
                        <th>测试编号</th>
                        <th>是否返回文本</th>
                        <th>合成值匹配</th>
                    </tr>
                </thead>
                <tbody>
                    <tr v-for="(observation, index) in observations" :key="index">
                        <td>{{ observation.scenario }}</td>
                        <td>{{ observation.channel }}</td>
                        <td>{{ observation.case_id }}</td>
                        <td>{{ observation.text_returned }}</td>
                        <td>{{ observation.synthetic_match }}</td>
                    </tr>
                </tbody>
            </table>
            <p v-else class="record-metadata-empty">暂无密码场景元数据</p>
        </details>
    </section>
</template>

<style scoped>
.record-preview {
    min-width: 0;
    color: var(--lab-ink, #353c4d);
    font-size: 11px;
}
.record-heading-title,
.record-keyword-label {
    position: absolute;
    width: 1px;
    height: 1px;
    overflow: hidden;
    clip-path: inset(50%);
    white-space: nowrap;
}
.record-filters {
    display: flex;
    align-items: center;
    gap: 8px;
    margin-bottom: 10px;
}
.record-filters select,
.record-keyword,
.record-button {
    height: 29px;
    flex: 0 0 auto;
    border: 1px solid var(--lab-line, #e5e8f0);
    border-radius: 5px;
    background: #fff;
    color: var(--lab-ink, #353c4d);
    font: inherit;
    font-size: 11px;
}
.record-filters select {
    padding: 4px 8px;
}
.record-app-filter {
    width: 160px;
}
.record-type-filter {
    width: 90px;
}
.record-keyword {
    width: 165px;
    padding: 5px 10px;
}
.record-keyword::placeholder {
    color: var(--lab-muted, #9299aa);
}
.record-button {
    padding: 4px 10px;
    white-space: nowrap;
    cursor: pointer;
}
.record-search-button {
    width: 52px;
    padding: 4px 0;
    font-weight: 600;
}
.record-preview-actions {
    display: flex;
    align-items: center;
    gap: 6px;
    margin-left: auto;
}
.record-demo-button {
    border-color: #c8cffe;
    color: #5366ff;
}
.record-demo-button[aria-pressed='true'] {
    background: #eef1ff;
    border-color: #8998ff;
}
.record-button:hover:not(:disabled) {
    filter: brightness(0.97);
}
.record-button:disabled {
    opacity: 0.6;
    cursor: wait;
}
.record-button:focus-visible,
.record-filters select:focus-visible,
.record-keyword:focus-visible,
.record-metadata summary:focus-visible {
    outline: 2px solid #6474ff;
    outline-offset: 2px;
}
.record-preview-status {
    display: flex;
    align-items: center;
    gap: 8px;
    min-width: 0;
    color: var(--lab-muted, #9299aa);
    font-size: 10px;
    white-space: nowrap;
}
.record-count {
    white-space: nowrap;
}
.record-demo-notice {
    color: #5b6cb8;
}
.record-preview-loading {
    margin: 10px 0;
    color: var(--lab-muted, #9299aa);
}
.record-preview-error,
.record-preview-feedback {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 10px;
    margin: 10px 0;
    border: 1px solid var(--lab-line, #e5e8f0);
    border-radius: 6px;
    padding: 8px 10px;
    background: var(--lab-bg, #f8f9fb);
    color: var(--lab-muted, #9299aa);
}
.record-preview-error {
    border-color: #f1cbd0;
    background: #fff5f6;
    color: #b24a54;
}
.record-table {
    width: 100%;
    table-layout: fixed;
    border-collapse: collapse;
}
.record-type-column {
    width: 9%;
}
.record-content-column {
    width: 42%;
}
.record-app-column {
    width: 15%;
}
.record-time-column {
    width: 34%;
}
.record-table .record-row {
    display: table-row;
    height: 34px;
    padding: 0;
    border: 0;
}
.record-table th,
.record-table td {
    height: 34px;
    padding: 7px 12px;
    border-bottom: 1px solid var(--lab-line, #e5e8f0);
    overflow: hidden;
    text-align: left;
    text-overflow: ellipsis;
    white-space: nowrap;
}
.record-table th {
    background: #f0f2f7;
    color: #7b8497;
    font-size: 10px;
    font-weight: 600;
}
.record-type {
    font-weight: 600;
}
.record-type-label[data-type='app'],
.record-type-label[data-type='pin'] {
    display: inline-block;
    border-radius: 10px;
    padding: 1px 7px;
    font-size: 10px;
    font-weight: 500;
    line-height: 14px;
}
.record-type-label[data-type='app'] {
    background: #fff9e9;
    color: #f59e0b;
}
.record-type-label[data-type='pin'] {
    background: #eef1ff;
    color: #5366ff;
}
.record-content {
    font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
    font-size: 11px;
}
.record-app,
.record-time {
    color: var(--lab-muted, #9299aa);
    font-size: 10px;
}
.record-empty {
    margin: 0;
    padding: 28px 12px;
    border-bottom: 1px solid var(--lab-line, #e5e8f0);
    color: var(--lab-muted, #9299aa);
    text-align: center;
}
.record-metadata {
    margin-top: 12px;
}
.record-metadata[open] {
    border: 1px solid var(--lab-line, #e5e8f0);
    border-radius: 7px;
    padding: 10px 12px;
    background: #fff;
}
.record-metadata summary {
    width: fit-content;
    color: var(--lab-muted, #9299aa);
    font-size: 10px;
    line-height: 16px;
    cursor: pointer;
}
.record-metadata > p {
    margin: 10px 0;
    color: var(--lab-muted, #9299aa);
    font-size: 10px;
}
.record-metadata-table {
    width: 100%;
    border-collapse: collapse;
    font-size: 10px;
}
.record-metadata-table th,
.record-metadata-table td {
    border-bottom: 1px solid var(--lab-line, #e5e8f0);
    padding: 7px 6px;
    overflow-wrap: anywhere;
    text-align: left;
}
.record-metadata-table th {
    color: var(--lab-muted, #9299aa);
    font-weight: 600;
}
[data-bs-theme='dark'] .record-filters select,
[data-bs-theme='dark'] .record-keyword,
[data-bs-theme='dark'] .record-button,
[data-bs-theme='dark'] .record-metadata[open] {
    background: #1f2938;
}
[data-bs-theme='dark'] .record-type-label[data-type='app'] {
    background: #3e3422;
    color: #efbd64;
}
[data-bs-theme='dark'] .record-type-label[data-type='pin'] {
    background: #283451;
    color: #adb9ff;
}
[data-bs-theme='dark'] .record-table th {
    background: #222d40;
    color: #a8b4cd;
}
[data-bs-theme='dark'] .record-demo-button {
    border-color: #6676c0;
    color: #adb9ff;
}
[data-bs-theme='dark'] .record-demo-button[aria-pressed='true'] {
    border-color: #46588d;
    background: #26334f;
    color: #b4c2f2;
}
[data-bs-theme='dark'] .record-demo-notice {
    color: #b4c2f2;
}
[data-bs-theme='dark'] .record-preview-error {
    border-color: #74434b;
    background: #3a2831;
    color: #ffb6be;
}
</style>
