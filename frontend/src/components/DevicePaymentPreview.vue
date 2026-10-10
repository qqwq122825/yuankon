<script setup>
import { computed, ref, useId, watch } from 'vue';
import { useDeviceDemoPreview } from '../composables/useDeviceDemoPreview.js';
import fixture from '../fixtures/device-payments-demo.json';
import catalogFixture from '../fixtures/device-apps-demo.json';
import { readPaymentDemo } from '../fixtures/device-fixture-protocol.js';

const props = defineProps({
    deviceId: Number,
    deviceSource: { type: String, default: '' },
});
const searchId = useId();
const { demoMode, loading, error, ready, feedback, contextKey, toggleDemo, refresh } =
    useDeviceDemoPreview(props, 'payments');
const query = ref('');
const selectedAppId = ref('');
const demoData = readPaymentDemo(fixture, catalogFixture);
const fixtureProtocol = demoData.valid ? fixture.protocol : undefined;
const datasetId = demoData.valid ? fixture.datasetId : undefined;
const demoApplications = demoData.applications;
const demoRecords = demoData.records;
const normalize = (value) => String(value).normalize('NFKC').toLowerCase();
const applications = computed(() => {
    if (!ready.value || !demoMode.value) return [];
    const search = normalize(query.value.trim());
    return demoApplications
        .filter(
            (item) =>
                !search ||
                [item.name, item.packageName].some((value) => normalize(value).includes(search)),
        )
        .map((item) => ({
            ...item,
            total: demoRecords.filter((record) => record.appId === item.id).length,
        }));
});
const selectedApplication = computed(
    () =>
        applications.value.find((item) => item.id === selectedAppId.value) ||
        applications.value[0] ||
        null,
);
const records = computed(() =>
    selectedApplication.value
        ? demoRecords.filter((item) => item.appId === selectedApplication.value.id)
        : [],
);
const successTotal = computed(() => records.value.filter((item) => item.success).length);
const distinctTotal = computed(() => new Set(records.value.map((item) => item.value)).size);
function resetSelection() {
    query.value = '';
    selectedAppId.value = demoApplications[0]?.id || '';
}
function changeDemoMode() {
    toggleDemo();
    resetSelection();
}
function recordTime(value) {
    return new Intl.DateTimeFormat('zh-CN', {
        timeZone: 'Asia/Shanghai',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hour12: false,
    }).format(new Date(value));
}
watch(contextKey, resetSelection, { immediate: true, flush: 'sync' });
</script>

<template>
    <section
        class="payment-preview"
        aria-label="支付密码"
        :aria-busy="loading"
        :data-demo="demoMode"
        :data-state="error ? 'error' : loading ? 'loading' : 'not_connected'"
        :data-protocol="fixtureProtocol"
        :data-dataset-id="datasetId"
    >
        <div
            class="payment-preview-toolbar"
            :data-protocol="fixtureProtocol"
            :data-dataset-id="datasetId"
        >
            <span class="payment-source">
                {{ demoMode && ready ? '合成测试数据 · 非设备记录' : '未接入 · UI 预览' }}
            </span>
            <div class="payment-toolbar-actions">
                <button
                    type="button"
                    class="payment-button payment-demo-button"
                    :aria-pressed="demoMode"
                    :disabled="!ready"
                    @click="changeDemoMode"
                >
                    测试数据
                </button>
                <button type="button" class="payment-button" :disabled="loading" @click="refresh">
                    刷新
                </button>
            </div>
        </div>
        <p v-if="loading" class="payment-loading" role="status">正在读取预览状态…</p>
        <p v-if="error" class="payment-error" role="alert">{{ error }}</p>
        <p v-if="feedback && !error" class="payment-feedback" role="status">{{ feedback }}</p>
        <div class="payment-layout">
            <aside class="payment-app-sidebar" aria-label="支付应用">
                <div class="payment-search-wrap">
                    <label class="payment-search-label" :for="searchId">支付应用搜索</label>
                    <input
                        :id="searchId"
                        v-model="query"
                        type="search"
                        class="payment-search"
                        placeholder="搜索应用名或包名..."
                        :disabled="!ready || !demoMode"
                    />
                </div>
                <div class="payment-app-list">
                    <button
                        v-for="application in applications"
                        :key="application.id"
                        type="button"
                        class="payment-app"
                        :data-app-id="application.id"
                        :data-package="application.packageName"
                        :data-protocol="fixtureProtocol"
                        :data-dataset-id="datasetId"
                        data-synthetic="true"
                        :aria-pressed="selectedApplication?.id === application.id"
                        @click="selectedAppId = application.id"
                    >
                        <span class="payment-app-icon" aria-hidden="true">💳</span>
                        <span class="payment-app-description">
                            <strong>{{ application.name }}</strong>
                            <span class="payment-app-package">{{ application.packageName }}</span>
                            <span class="payment-app-meta">
                                <span class="payment-app-count">{{ application.total }}条</span>
                                <span>{{ application.ageLabel }}</span>
                            </span>
                        </span>
                    </button>
                    <p v-if="ready && !applications.length" class="payment-no-apps">
                        {{ demoMode ? '未找到匹配应用' : '暂无应用记录' }}
                    </p>
                </div>
            </aside>
            <div class="payment-record-area">
                <header class="payment-app-heading">
                    <h2>{{ selectedApplication?.name || '支付密码' }}</h2>
                    <p>{{ selectedApplication?.packageName || '选择测试数据查看页面样例' }}</p>
                </header>
                <div class="payment-stats" aria-label="支付样例统计">
                    <div class="payment-stat">
                        <strong class="payment-stat-total">{{ records.length }}</strong>
                        <span>总记录数</span>
                    </div>
                    <div class="payment-stat payment-stat--success">
                        <strong class="payment-stat-success">{{ successTotal }}</strong>
                        <span>成功样例</span>
                    </div>
                    <div class="payment-stat payment-stat--distinct">
                        <strong class="payment-stat-distinct">{{ distinctTotal }}</strong>
                        <span>不同测试值</span>
                    </div>
                </div>
                <div class="payment-record-list">
                    <article
                        v-for="record in records"
                        :key="record.id"
                        class="payment-record"
                        :data-record-id="record.id"
                        :data-app-id="record.appId"
                        :data-package="selectedApplication.packageName"
                        :data-protocol="fixtureProtocol"
                        :data-dataset-id="datasetId"
                        data-synthetic="true"
                    >
                        <div class="payment-record-heading">
                            <time :datetime="record.occurredAt">
                                <span aria-hidden="true">◷</span>
                                {{ recordTime(record.occurredAt) }}
                            </time>
                            <span class="payment-record-status" :data-success="record.success">
                                {{ record.success ? '✓ 成功' : '未匹配' }}
                            </span>
                        </div>
                        <p class="payment-value">{{ record.value }}</p>
                        <p class="payment-record-kind">
                            <span aria-hidden="true">🔑</span> {{ record.kind }} · 合成样例
                        </p>
                    </article>
                    <p v-if="ready && !records.length" class="payment-empty">
                        {{
                            demoMode
                                ? '暂无匹配的支付密码样例'
                                : '暂无支付密码记录，点击「测试数据」查看合成样例'
                        }}
                    </p>
                </div>
            </div>
        </div>
    </section>
</template>

<style scoped>
.payment-preview {
    position: relative;
    margin: -16px;
    color: var(--lab-ink, #252c3a);
    font-size: 12px;
}
.payment-preview-toolbar {
    position: absolute;
    top: 14px;
    right: 16px;
    display: flex;
    align-items: center;
    justify-content: space-between;
    min-height: 34px;
    gap: 12px;
}
.payment-source {
    color: var(--lab-muted, #939aab);
    font-size: 10px;
}
.payment-toolbar-actions {
    display: flex;
    gap: 6px;
}
.payment-button {
    min-height: 30px;
    padding: 5px 10px;
    border: 1px solid var(--lab-line, #e5e8f0);
    border-radius: 6px;
    background: #fff;
    color: var(--lab-ink, #252c3a);
    font: inherit;
    cursor: pointer;
}
.payment-demo-button {
    border-color: #c8cffe;
    color: #5366ff;
}
.payment-demo-button[aria-pressed='true'] {
    border-color: #8998ff;
    background: #eef1ff;
}
.payment-button:disabled,
.payment-search:disabled {
    opacity: 0.6;
    cursor: not-allowed;
}
.payment-button:hover:not(:disabled),
.payment-app:hover {
    filter: brightness(0.98);
}
.payment-button:focus-visible,
.payment-app:focus-visible,
.payment-search:focus-visible {
    outline: 2px solid #6474ff;
    outline-offset: 2px;
}
.payment-loading,
.payment-feedback,
.payment-error {
    margin: 0;
    padding: 8px 16px;
    color: var(--lab-muted, #939aab);
    font-size: 11px;
}
.payment-error {
    padding: 8px 10px;
    border: 1px solid #f1cbd0;
    border-radius: 6px;
    background: #fff5f6;
    color: #b24a54;
}
.payment-layout {
    display: grid;
    grid-template-columns: 260px minmax(0, 1fr);
    min-height: calc(100dvh - 44px);
    background: var(--lab-bg, #f8f9fb);
}
.payment-app-sidebar {
    min-width: 0;
    border-right: 1px solid var(--lab-line, #e5e8f0);
    background: #fff;
}
.payment-search-wrap {
    padding: 10px;
    border-bottom: 1px solid var(--lab-line, #e5e8f0);
}
.payment-search-label {
    position: absolute;
    width: 1px;
    height: 1px;
    padding: 0;
    overflow: hidden;
    clip-path: inset(50%);
    white-space: nowrap;
}
.payment-search {
    width: 100%;
    min-height: 34px;
    padding: 7px 12px;
    border: 1px solid var(--lab-line, #e5e8f0);
    border-radius: 9px;
    background: #f2f3f8;
    color: var(--lab-ink, #252c3a);
    font: inherit;
}
.payment-search::placeholder {
    color: var(--lab-muted, #939aab);
}
.payment-app-list {
    padding: 6px;
}
.payment-app {
    display: flex;
    align-items: center;
    width: 100%;
    min-height: 72px;
    padding: 10px 11px;
    border: 1px solid transparent;
    border-radius: 10px;
    background: transparent;
    color: inherit;
    gap: 10px;
    text-align: left;
    cursor: pointer;
    font: inherit;
}
.payment-app[aria-pressed='true'] {
    border-color: #c8cffe;
    background: #eef1ff;
}
.payment-app-icon {
    display: grid;
    flex: 0 0 36px;
    height: 38px;
    border-radius: 11px;
    background: #f2f3f8;
    place-items: center;
    font-size: 16px;
}
.payment-app-description {
    display: flex;
    flex-direction: column;
    min-width: 0;
    gap: 1px;
}
.payment-app-description strong {
    font-size: 12px;
    font-weight: 600;
}
.payment-app-package {
    overflow: hidden;
    color: var(--lab-muted, #939aab);
    font-size: 10px;
    text-overflow: ellipsis;
    white-space: nowrap;
}
.payment-app-meta {
    display: flex;
    align-items: center;
    gap: 6px;
    color: var(--lab-muted, #939aab);
    font-size: 10px;
}
.payment-app-count {
    border-radius: 10px;
    padding: 0 7px;
    background: #5366ff;
    color: #fff;
    line-height: 16px;
}
.payment-no-apps {
    padding: 16px 8px;
    color: var(--lab-muted, #939aab);
    text-align: center;
    font-size: 11px;
}
.payment-record-area {
    min-width: 0;
}
.payment-app-heading {
    padding: 15px 340px 15px 20px;
    border-bottom: 1px solid var(--lab-line, #e5e8f0);
    background: #fff;
}
.payment-app-heading h2 {
    margin: 0 0 4px;
    font-size: 14px;
    font-weight: 600;
    line-height: 20px;
}
.payment-app-heading p {
    margin: 0;
    color: var(--lab-muted, #939aab);
    font-size: 11px;
    line-height: 16px;
}
.payment-stats {
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    padding: 15px 20px;
    border-bottom: 1px solid var(--lab-line, #e5e8f0);
    background: #fff;
    gap: 10px;
}
.payment-stat {
    display: flex;
    align-items: center;
    justify-content: center;
    flex-direction: column;
    min-height: 75px;
    border: 1px solid var(--lab-line, #e5e8f0);
    border-radius: 13px;
    background: #f2f3f8;
    gap: 3px;
}
.payment-stat strong {
    color: #5366ff;
    font-size: 24px;
    font-weight: 700;
    line-height: 30px;
}
.payment-stat span {
    color: var(--lab-muted, #939aab);
    font-size: 10px;
}
.payment-stat--success strong {
    color: #0fbe88;
}
.payment-stat--distinct strong {
    color: var(--lab-ink, #252c3a);
}
.payment-record-list {
    display: grid;
    padding: 15px 20px 20px;
    gap: 8px;
}
.payment-record {
    min-height: 125px;
    padding: 13px 14px;
    border: 1px solid var(--lab-line, #e5e8f0);
    border-radius: 13px;
    background: #fff;
}
.payment-record-heading {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 10px;
    font-size: 10px;
}
.payment-record-heading time {
    color: var(--lab-muted, #939aab);
}
.payment-record-status {
    border-radius: 10px;
    padding: 1px 10px;
    background: #ecfcf5;
    color: #14b886;
    font-size: 9px;
    line-height: 16px;
}
.payment-record-status[data-success='false'] {
    background: #fff9e9;
    color: #9a6700;
}
.payment-value {
    margin: 14px 0 12px;
    font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
    font-size: 20px;
    letter-spacing: 2px;
    line-height: 25px;
    text-align: center;
}
.payment-record-kind {
    margin: 0;
    color: var(--lab-muted, #939aab);
    font-size: 10px;
    line-height: 16px;
    text-align: center;
}
.payment-empty {
    margin: 0;
    padding: 60px 16px;
    color: var(--lab-muted, #939aab);
    font-size: 12px;
    text-align: center;
}
[data-bs-theme='dark'] .payment-button,
[data-bs-theme='dark'] .payment-app-sidebar,
[data-bs-theme='dark'] .payment-app-heading,
[data-bs-theme='dark'] .payment-stats,
[data-bs-theme='dark'] .payment-record {
    background: #1f2938;
}
[data-bs-theme='dark'] .payment-search,
[data-bs-theme='dark'] .payment-app-icon,
[data-bs-theme='dark'] .payment-stat {
    background: #222d40;
}
[data-bs-theme='dark'] .payment-demo-button,
[data-bs-theme='dark'] .payment-app[aria-pressed='true'] {
    border-color: #6676c0;
    color: #adb9ff;
}
[data-bs-theme='dark'] .payment-demo-button[aria-pressed='true'],
[data-bs-theme='dark'] .payment-app[aria-pressed='true'] {
    background: #26334f;
}
[data-bs-theme='dark'] .payment-record-status {
    background: #203c37;
    color: #8bdac0;
}
[data-bs-theme='dark'] .payment-record-status[data-success='false'] {
    background: #3e3422;
    color: #efbd64;
}
[data-bs-theme='dark'] .payment-error {
    border-color: #74434b;
    background: #3a2831;
    color: #ffb6be;
}
</style>
