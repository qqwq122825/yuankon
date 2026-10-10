<script setup>
import { computed, ref, useId, watch } from 'vue';
import { useDeviceDemoPreview } from '../composables/useDeviceDemoPreview.js';
import fixture from '../fixtures/device-injection-records-demo.json';
import catalogFixture from '../fixtures/device-apps-demo.json';
import { readInjectionRecordsDemo } from '../fixtures/device-fixture-protocol.js';

const props = defineProps({
    deviceId: Number,
    deviceSource: { type: String, default: '' },
});
const { demoMode, loading, error, ready, feedback, contextKey, toggleDemo, refresh } =
    useDeviceDemoPreview(props, 'templates');
const instanceId = useId();
const dialog = ref(null);
const dialogKind = ref('manual');
const selectedApplicationId = ref('');
const dialogApplicationId = ref('');
const dismissed = ref(new Set());
const localFeedback = ref('');
const demoData = readInjectionRecordsDemo(fixture, catalogFixture);
const fixtureProtocol = demoData.valid ? fixture.protocol : undefined;
const datasetId = demoData.valid ? fixture.datasetId : undefined;
const fixtureApplications = demoData.applications;
const applicationMap = new Map(fixtureApplications.map((item) => [item.id, item]));
const fixtureRecords = demoData.records.map((item) => ({
    ...item,
    application: applicationMap.get(item.applicationId),
}));
function fieldSeparator(label) {
    return /^[A-Za-z][A-Za-z0-9_-]*$/.test(label) ? ':' : '：';
}
const applications = computed(() => (demoMode.value ? fixtureApplications : []));
const trackedApplications = computed(() =>
    applications.value.filter((item) => !dismissed.value.has(item.id)),
);
const records = computed(() =>
    demoMode.value
        ? fixtureRecords.filter(
              (item) =>
                  !selectedApplicationId.value ||
                  item.applicationId === selectedApplicationId.value,
          )
        : [],
);
const dialogApplication = computed(() =>
    demoMode.value ? applicationMap.get(dialogApplicationId.value) : null,
);
const dialogRecord = computed(() =>
    demoMode.value
        ? fixtureRecords.find((item) => item.applicationId === dialogApplicationId.value)
        : null,
);
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
function closeDialog() {
    if (dialog.value?.open) dialog.value.close();
}
function resetLocalState() {
    closeDialog();
    selectedApplicationId.value = '';
    dialogApplicationId.value = '';
    dismissed.value = new Set();
    localFeedback.value = '';
}
function changeDemo() {
    resetLocalState();
    toggleDemo();
}
async function refreshRecords() {
    resetLocalState();
    await refresh();
}
function selectApplication(applicationId) {
    if (!demoMode.value || !applicationMap.has(applicationId)) return;
    selectedApplicationId.value = applicationId;
    localFeedback.value = `已筛选「${applicationMap.get(applicationId).name}」的合成记录。`;
}
function showAllRecords() {
    selectedApplicationId.value = '';
    localFeedback.value = '';
}
function dismissApplication(application) {
    if (!demoMode.value) return;
    dismissed.value = new Set([...dismissed.value, application.id]);
    localFeedback.value = `已取消「${application.name}」的本地追踪示例；刷新可恢复。`;
}
function openDialog(kind) {
    if (!demoMode.value || !ready.value || !applications.value.length) return;
    dialogKind.value = kind;
    dialogApplicationId.value = selectedApplicationId.value || applications.value[0].id;
    if (!dialog.value?.open) dialog.value?.showModal();
}
function showLocalExample() {
    if (!demoMode.value || !applicationMap.has(dialogApplicationId.value)) return;
    selectedApplicationId.value = dialogApplicationId.value;
    dismissed.value = new Set(
        [...dismissed.value].filter((id) => id !== dialogApplicationId.value),
    );
    localFeedback.value = `已展示「${dialogApplication.value.name}」的固定合成样例；本地演示不下发。`;
    closeDialog();
}
watch(contextKey, resetLocalState, { flush: 'sync' });
watch(demoMode, (active) => {
    if (!active) resetLocalState();
});
</script>

<template>
    <section
        class="injection-records-preview"
        aria-label="注入记录"
        :aria-busy="loading"
        :data-demo="demoMode"
        :data-state="loading ? 'loading' : error ? 'error' : 'not_connected'"
        :data-protocol="fixtureProtocol"
        :data-dataset-id="datasetId"
    >
        <header
            class="injection-toolbar"
            :data-protocol="fixtureProtocol"
            :data-dataset-id="datasetId"
        >
            <h2 class="injection-visually-hidden">注入记录</h2>
            <button
                type="button"
                class="btn btn-white btn-sm"
                :disabled="loading"
                @click="refreshRecords"
            >
                <span aria-hidden="true">💉</span>刷新记录
            </button>
            <button
                type="button"
                class="btn btn-white btn-sm"
                :disabled="!demoMode"
                @click="openDialog('manual')"
            >
                <span aria-hidden="true">🎯</span>手动注入APP
            </button>
            <button
                type="button"
                class="btn btn-white btn-sm"
                :disabled="!demoMode"
                @click="openDialog('popup')"
            >
                <span aria-hidden="true">💬</span>弹窗注入
            </button>
            <button
                type="button"
                class="btn btn-outline-primary btn-sm injection-demo-toggle"
                :aria-pressed="demoMode"
                :disabled="!ready"
                @click="changeDemo"
            >
                测试数据
            </button>
        </header>
        <p v-if="demoMode" class="injection-demo-notice">合成测试数据 · 非设备记录</p>
        <p v-if="loading" class="injection-caption" role="status">正在读取预览状态…</p>
        <p v-if="error" class="injection-error" role="alert">{{ error }}</p>
        <p v-if="localFeedback || feedback" class="injection-feedback" role="status">
            {{ localFeedback || feedback }}
        </p>

        <template v-if="ready">
            <section class="injection-tracking" aria-label="注入追踪状态">
                <h3>注入追踪状态</h3>
                <div class="injection-tracking-list">
                    <div
                        v-for="application in trackedApplications"
                        :key="application.id"
                        class="injection-tracking-chip"
                        :class="{ 'is-selected': selectedApplicationId === application.id }"
                        :data-app-id="application.id"
                        :data-package="application.packageName"
                        :data-protocol="fixtureProtocol"
                        :data-dataset-id="datasetId"
                        data-synthetic="true"
                    >
                        <button
                            type="button"
                            class="injection-chip-name"
                            @click="selectApplication(application.id)"
                        >
                            {{ application.name }}
                        </button>
                        <span class="injection-chip-status">已提交 (示例)</span>
                        <button
                            type="button"
                            class="injection-chip-remove"
                            :aria-label="`取消 ${application.name} 本地追踪示例`"
                            @click="dismissApplication(application)"
                        >
                            ×
                        </button>
                    </div>
                    <p v-if="!trackedApplications.length" class="injection-tracking-empty">
                        {{ demoMode ? '暂无本地追踪示例，刷新记录可恢复' : '暂无注入追踪状态' }}
                    </p>
                </div>
            </section>
            <div v-if="demoMode" class="injection-records-heading">
                <span>共 {{ records.length }} 条合成记录</span>
                <button
                    v-if="selectedApplicationId"
                    type="button"
                    class="btn btn-white btn-sm"
                    @click="showAllRecords"
                >
                    全部记录
                </button>
            </div>
            <div class="injection-records-list">
                <article
                    v-for="record in records"
                    :key="record.id"
                    class="injection-demo-record"
                    :data-record-id="record.id"
                    :data-app-id="record.applicationId"
                    :data-package="record.application.packageName"
                    :data-protocol="fixtureProtocol"
                    :data-dataset-id="datasetId"
                    data-synthetic="true"
                >
                    <header class="injection-record-heading">
                        <span class="injection-record-icon" aria-hidden="true">{{
                            record.application.initial
                        }}</span>
                        <div class="injection-record-identity">
                            <strong>{{ record.application.name }}</strong>
                            <span>{{ record.application.packageName }}</span>
                        </div>
                        <time class="injection-record-time" :datetime="record.occurredAt">{{
                            recordTime(record.occurredAt)
                        }}</time>
                        <span class="injection-record-status">✓ 已提交 (示例)</span>
                    </header>
                    <div class="injection-record-body">
                        <span class="injection-record-kind">合成表单</span>
                        <dl class="injection-record-fields">
                            <div v-for="field in record.fields" :key="field.label">
                                <dt>{{ field.label }}{{ fieldSeparator(field.label) }}</dt>
                                <dd class="injection-field-value">{{ field.value }}</dd>
                            </div>
                        </dl>
                    </div>
                </article>
                <div v-if="!records.length" class="injection-empty">
                    <p>暂无注入记录</p>
                    <span>开启「测试数据」可查看固定合成样例。</span>
                </div>
            </div>
        </template>

        <dialog
            ref="dialog"
            class="injection-demo-dialog"
            :aria-labelledby="`${instanceId}-dialog-title`"
            :aria-describedby="`${instanceId}-dialog-description`"
        >
            <header class="injection-dialog-heading">
                <h3 :id="`${instanceId}-dialog-title`">
                    {{ dialogKind === 'manual' ? '本地手动演示' : '本地弹窗演示' }}
                </h3>
                <button
                    type="button"
                    class="injection-dialog-close"
                    aria-label="关闭本地演示"
                    @click="closeDialog"
                >
                    ×
                </button>
            </header>
            <div class="injection-dialog-body">
                <p :id="`${instanceId}-dialog-description`" class="injection-dialog-notice">
                    本地演示不下发 · 仅展示固定假数据
                </p>
                <label :for="`${instanceId}-dialog-app`">演示应用</label>
                <select
                    :id="`${instanceId}-dialog-app`"
                    v-model="dialogApplicationId"
                    class="form-select"
                    autofocus
                >
                    <option
                        v-for="application in applications"
                        :key="application.id"
                        :value="application.id"
                    >
                        {{ application.name }}
                    </option>
                </select>
                <div v-if="dialogRecord && dialogApplication" class="injection-dialog-example">
                    <strong>{{ dialogApplication.name }}</strong>
                    <span class="injection-dialog-package">{{
                        dialogApplication.packageName
                    }}</span>
                    <dl class="injection-record-fields">
                        <div v-for="field in dialogRecord.fields" :key="field.label">
                            <dt>{{ field.label }}{{ fieldSeparator(field.label) }}</dt>
                            <dd>{{ field.value }}</dd>
                        </div>
                    </dl>
                </div>
            </div>
            <footer class="injection-dialog-footer">
                <button type="button" class="btn btn-white btn-sm" @click="closeDialog">
                    关闭
                </button>
                <button
                    v-if="dialogKind === 'manual'"
                    type="button"
                    class="btn btn-primary btn-sm"
                    :disabled="!dialogApplication"
                    @click="showLocalExample"
                >
                    展示示例
                </button>
            </footer>
        </dialog>
    </section>
</template>

<style scoped>
.injection-records-preview {
    color: var(--lab-ink, #353c4d);
    font-size: 11px;
}
.injection-visually-hidden {
    position: absolute;
    width: 1px;
    height: 1px;
    overflow: hidden;
    clip-path: inset(50%);
    white-space: nowrap;
}
.injection-toolbar {
    display: flex;
    align-items: center;
    gap: 8px;
    margin-bottom: 12px;
}
.injection-toolbar .btn {
    min-height: 30px;
    gap: 5px;
    font-size: 11px;
}
.injection-demo-toggle {
    margin-left: auto;
}
.injection-demo-toggle[aria-pressed='true'] {
    background: #eef1ff;
}
.injection-demo-notice,
.injection-caption,
.injection-feedback,
.injection-error {
    margin: 0 0 12px;
    color: var(--lab-muted, #9299aa);
    font-size: 10px;
}
.injection-demo-notice {
    color: #5b6cb8;
}
.injection-error {
    color: #c85261;
}
.injection-tracking h3 {
    margin: 0 0 8px;
    color: var(--lab-muted, #9299aa);
    font-size: 11px;
    font-weight: 500;
}
.injection-tracking-list {
    display: flex;
    min-height: 33px;
    flex-wrap: wrap;
    align-items: center;
    gap: 7px;
}
.injection-tracking-chip {
    display: inline-flex;
    min-height: 32px;
    align-items: center;
    gap: 10px;
    border: 1px solid var(--lab-line, #e9ebf3);
    border-radius: 7px;
    padding: 4px 8px 4px 10px;
    background: var(--lab-bg, #f7f8fc);
}
.injection-tracking-chip.is-selected {
    border-color: #b7c0ff;
    background: #eef1ff;
}
.injection-chip-name,
.injection-chip-remove {
    border: 0;
    padding: 0;
    background: transparent;
    font: inherit;
    cursor: pointer;
}
.injection-chip-name {
    color: var(--lab-ink, #353c4d);
    font-weight: 600;
}
.injection-chip-status {
    color: #5366ff;
    font-size: 10px;
    white-space: nowrap;
}
.injection-chip-remove {
    width: 18px;
    height: 20px;
    color: #ff5966;
    font-size: 18px;
    line-height: 1;
}
.injection-tracking-empty {
    margin: 0;
    color: var(--lab-muted, #9299aa);
    font-size: 10px;
}
.injection-records-heading {
    display: flex;
    min-height: 26px;
    align-items: center;
    justify-content: space-between;
    margin: 14px 0 7px;
    color: var(--lab-muted, #9299aa);
    font-size: 10px;
}
.injection-records-heading .btn {
    min-height: 24px;
    padding: 2px 8px;
    font-size: 10px;
}
.injection-records-list {
    display: grid;
    gap: 9px;
}
.injection-demo-record {
    overflow: hidden;
    border: 1px solid var(--lab-line, #e9ebf3);
    border-radius: 10px;
    background: var(--lab-surface, #fff);
}
.injection-record-heading {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 11px 14px;
}
.injection-record-icon {
    display: grid;
    width: 34px;
    height: 34px;
    flex: 0 0 auto;
    place-items: center;
    border-radius: 8px;
    background: var(--lab-bg, #f7f8fc);
    color: var(--lab-muted, #9299aa);
    font-size: 15px;
    font-weight: 600;
}
.injection-record-identity {
    display: grid;
    gap: 2px;
}
.injection-record-identity strong {
    font-size: 12px;
    font-weight: 600;
}
.injection-record-identity span,
.injection-record-time {
    color: var(--lab-muted, #9299aa);
    font-size: 10px;
}
.injection-record-time {
    margin-left: auto;
    white-space: nowrap;
}
.injection-record-status {
    border-radius: 12px;
    padding: 2px 8px;
    background: #ebfbf4;
    color: #13ac83;
    font-size: 10px;
    white-space: nowrap;
}
.injection-record-body {
    display: flex;
    align-items: center;
    gap: 20px;
    border-top: 1px solid var(--lab-line, #e9ebf3);
    padding: 10px 14px;
}
.injection-record-kind {
    color: var(--lab-muted, #9299aa);
    font-size: 10px;
}
.injection-record-fields {
    display: flex;
    flex-wrap: wrap;
    gap: 6px 24px;
    margin: 0;
}
.injection-record-fields div {
    display: flex;
    align-items: baseline;
    gap: 3px;
}
.injection-record-fields dt {
    color: var(--lab-muted, #9299aa);
    font-weight: 500;
}
.injection-record-fields dd {
    margin: 0;
    font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
    font-size: 12px;
    font-weight: 600;
}
.injection-empty {
    padding: 90px 20px;
    color: var(--lab-muted, #9299aa);
    text-align: center;
}
.injection-empty p {
    margin: 0 0 4px;
    font-size: 12px;
}
.injection-empty span {
    font-size: 10px;
}
.injection-demo-dialog {
    width: 390px;
    max-width: none;
    border: 1px solid var(--lab-line, #e9ebf3);
    border-radius: 12px;
    padding: 0;
    background: var(--lab-surface, #fff);
    color: var(--lab-ink, #353c4d);
    box-shadow: 0 18px 50px #18223a29;
}
.injection-demo-dialog::backdrop {
    background: #18223a45;
}
.injection-dialog-heading {
    display: flex;
    align-items: center;
    justify-content: space-between;
    border-bottom: 1px solid var(--lab-line, #e9ebf3);
    padding: 12px 16px;
    background: var(--lab-bg, #f7f8fc);
}
.injection-dialog-heading h3 {
    margin: 0;
    font-size: 14px;
    font-weight: 600;
}
.injection-dialog-close {
    width: 25px;
    height: 25px;
    border: 0;
    border-radius: 5px;
    padding: 0;
    background: transparent;
    color: var(--lab-muted, #9299aa);
    font-size: 24px;
    cursor: pointer;
}
.injection-dialog-body {
    display: grid;
    gap: 8px;
    padding: 15px 16px;
    font-size: 11px;
}
.injection-dialog-notice {
    margin: 0 0 4px;
    color: #5b6cb8;
    font-size: 10px;
}
.injection-dialog-body .form-select {
    min-height: 32px;
    font-size: 11px;
}
.injection-dialog-example {
    display: grid;
    gap: 4px;
    margin-top: 4px;
    border: 1px solid var(--lab-line, #e9ebf3);
    border-radius: 8px;
    padding: 12px;
    background: var(--lab-bg, #f7f8fc);
}
.injection-dialog-package {
    color: var(--lab-muted, #9299aa);
    font-size: 10px;
}
.injection-dialog-example .injection-record-fields {
    display: grid;
    gap: 7px;
    margin-top: 7px;
}
.injection-dialog-footer {
    display: flex;
    justify-content: flex-end;
    gap: 8px;
    border-top: 1px solid var(--lab-line, #e9ebf3);
    padding: 11px 16px;
}
.injection-dialog-footer .btn {
    font-size: 11px;
}
.injection-chip-name:focus-visible,
.injection-chip-remove:focus-visible,
.injection-dialog-close:focus-visible {
    outline: 2px solid #6474ff;
    outline-offset: 2px;
}
[data-bs-theme='dark'] .injection-demo-toggle[aria-pressed='true'],
[data-bs-theme='dark'] .injection-tracking-chip.is-selected {
    background: #252d4d;
}
[data-bs-theme='dark'] .injection-record-status {
    background: #183e35;
    color: #5fd1ad;
}
[data-bs-theme='dark'] .injection-demo-notice,
[data-bs-theme='dark'] .injection-dialog-notice {
    color: #a1afe9;
}
</style>
