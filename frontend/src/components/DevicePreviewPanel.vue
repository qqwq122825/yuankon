<script setup>
import { computed, onUnmounted, ref, watch } from 'vue';
import { api } from '../api.js';
import { session } from '../session.js';
import FloatingViewer from './FloatingViewer.vue';
import DeviceLockEventDemo from './DeviceLockEventDemo.vue';
import DeviceTemplateDemo from './DeviceTemplateDemo.vue';
import demoFixture from '../fixtures/device-ui-demo.json';
import { readLockDemo } from '../fixtures/device-fixture-protocol.js';
import { UI_DEMO_PROTOCOL } from '../fixtures/device-demo-protocol.js';
import injectionFixture from '../fixtures/device-injection-match-demo.json';
import { matchInjectionDemo } from '../fixtures/injection-demo-match.js';
import injectionSubmissionFixture from '../fixtures/device-injection-submission-demo.json';
import { attachInjectionSubmissions } from '../fixtures/injection-submission-demo.js';

const props = defineProps({
    deviceId: Number,
    deviceSource: { type: String, default: '' },
    sectionId: String,
    sections: { type: Array, default: () => [] },
    tools: { type: Array, default: () => [] },
    active: Boolean,
    resetKey: Number,
    actionBusy: Boolean,
    actionFeedback: { type: String, default: '' },
    actionError: Boolean,
    fixedSection: Boolean,
    instanceKey: { type: String, default: 'general' },
    panelTitle: { type: String, default: '' },
    initialPosition: { type: Object, default: () => ({ left: 126, top: 360 }) },
});
const emit = defineEmits(['close', 'activate', 'select', 'action']);
const allowedSections = new Set([
    'analysis',
    'tools',
    'sms',
    'apps',
    'gallery',
    'password',
    'payments',
    'templates',
    'input-events',
    'diagnostic',
]);
const allowedActions = new Set([
    'analyze-sample',
    'screen-preview',
    'camera-preview',
    'permissions-preview',
    'diagnostic-preview',
    'export-preview',
    'apps-preview',
    'gallery-preview',
    'refresh-preview',
]);
const loading = ref(false);
const error = ref('');
const result = ref(null);
const requestedDemo = ref(false);
const demoResetKey = ref(0);
const demoFeedback = ref('');
let demoInitialized = false;
const demoCapable = computed(
    () => props.fixedSection && ['password', 'templates'].includes(props.sectionId),
);
const ready = computed(() => Boolean(session.user && result.value));
const demoMode = computed(() => ready.value && demoCapable.value && requestedDemo.value);
const lockData = readLockDemo(demoFixture);
const lockEvents = lockData.lockEvents;
const injectionMatch = attachInjectionSubmissions(
    matchInjectionDemo(injectionFixture),
    injectionSubmissionFixture,
);
const applications = injectionMatch.applications;
const submittedCount = ref(injectionMatch.submittedCount);
const demoMeta = computed(() =>
    props.sectionId === 'password'
        ? `${lockEvents.length} 条`
        : `已提交 ${submittedCount.value}/${injectionMatch.matchedCount}`,
);
function syncSubmittedCount(count) {
    if (Number.isSafeInteger(count) && count >= 0 && count <= applications.length)
        submittedCount.value = count;
}
function toggleDemo() {
    if (!ready.value || !demoCapable.value) return;
    demoInitialized = true;
    requestedDemo.value = !requestedDemo.value;
    demoFeedback.value = '';
    demoResetKey.value++;
}
function resetDemo() {
    if (!demoMode.value) return;
    demoResetKey.value++;
    demoFeedback.value = '测试数据已恢复；未执行设备操作。';
}
const sections = computed(() => props.sections.filter((item) => allowedSections.has(item.id)));
const tools = computed(() => props.tools.filter((item) => allowedActions.has(item.id)));
const label = computed(
    () => sections.value.find((item) => item.id === props.sectionId)?.label || '模块预览',
);
const title = computed(
    () => props.panelTitle || (label.value.endsWith('预览') ? label.value : `${label.value}预览`),
);
const selectorId = computed(() => `device-preview-section-${props.instanceKey}`);
const context = () =>
    JSON.stringify([
        props.deviceId,
        props.deviceSource,
        props.sectionId,
        props.fixedSection,
        session.user?.id,
        session.user?.role,
        session.user?.projectId,
        session.user?.parentAccountId,
    ]);
let controller;
let alive = true;
async function load() {
    controller?.abort();
    result.value = null;
    error.value = '';
    if (
        !alive ||
        !session.user ||
        !Number.isSafeInteger(props.deviceId) ||
        props.deviceId <= 0 ||
        !allowedSections.has(props.sectionId)
    )
        return;
    const request = (controller = new AbortController());
    const key = context();
    const deviceId = props.deviceId;
    const sectionId = props.sectionId;
    loading.value = true;
    try {
        const response = await api(`/api/devices/${deviceId}/ui-preview/${sectionId}`, {
            signal: request.signal,
        });
        if (request.signal.aborted || !alive || key !== context() || controller !== request) return;
        if (
            !response ||
            typeof response !== 'object' ||
            response.mode !== 'preview' ||
            response.implemented !== false ||
            response.state !== 'not_connected' ||
            response.deviceId !== deviceId ||
            response.section?.id !== sectionId ||
            !Array.isArray(response.items) ||
            response.items.length !== 0 ||
            response.total !== 0
        )
            throw new Error('预览接口状态不符合当前约定，请重试。');
        result.value = response;
        if (!demoInitialized) {
            requestedDemo.value = demoCapable.value && props.deviceSource === 'sample';
            demoInitialized = true;
        }
    } catch (failure) {
        if (
            !request.signal.aborted &&
            failure.name !== 'AbortError' &&
            alive &&
            key === context() &&
            controller === request
        )
            error.value = failure.message;
    } finally {
        if (controller === request) loading.value = false;
    }
}
watch(
    context,
    () => {
        controller?.abort();
        controller = undefined;
        result.value = null;
        requestedDemo.value = false;
        demoInitialized = false;
        loading.value = false;
        error.value = '';
        demoFeedback.value = '';
        demoResetKey.value++;
        load();
    },
    { immediate: true, flush: 'sync' },
);
onUnmounted(() => {
    alive = false;
    controller?.abort();
});
</script>

<template>
    <FloatingViewer
        :title="title"
        meta="UI 预览"
        :initial-position="initialPosition"
        :reset-key="resetKey"
        :active="active"
        variant="preview"
        @activate="emit('activate')"
        @close="emit('close')"
    >
        <template v-if="demoCapable" #heading-title>
            <strong :class="{ 'device-demo-heading-quick': sectionId === 'templates' }">
                <span aria-hidden="true">{{ sectionId === 'password' ? '🔐' : '💉' }}</span>
                {{ title }}
            </strong>
        </template>
        <template v-if="demoCapable" #heading-actions>
            <span v-if="demoMode" class="device-demo-count">{{ demoMeta }}</span>
            <button
                type="button"
                class="btn device-demo-toggle"
                :aria-pressed="demoMode"
                :disabled="!ready"
                @click="toggleDemo"
            >
                测试数据
            </button>
            <button
                v-if="demoMode && sectionId === 'templates'"
                type="button"
                class="btn device-demo-reset"
                aria-label="重置测试数据"
                @click="resetDemo"
            >
                ↻
            </button>
        </template>
        <section
            class="device-preview-panel"
            :aria-busy="loading || actionBusy"
            :data-section="sectionId"
            :data-instance="instanceKey"
            :data-demo="demoMode"
            :data-demo-capable="demoCapable"
            :data-protocol="
                sectionId === 'password'
                    ? lockData.valid
                        ? UI_DEMO_PROTOCOL
                        : undefined
                    : injectionMatch.valid
                      ? injectionMatch.protocol
                      : undefined
            "
            :data-dataset-id="
                (sectionId === 'password' ? lockData.valid : injectionMatch.valid)
                    ? demoFixture.datasetId
                    : undefined
            "
        >
            <template v-if="demoMode && demoCapable">
                <DeviceLockEventDemo
                    v-if="sectionId === 'password'"
                    :key="demoResetKey"
                    :records="lockEvents"
                />
                <DeviceTemplateDemo
                    v-else
                    :key="demoResetKey"
                    :applications="applications"
                    :match-summary="injectionMatch"
                    @submitted-count="syncSubmittedCount"
                />
                <p v-if="demoFeedback" class="device-demo-feedback" role="status">
                    {{ demoFeedback }}
                </p>
            </template>
            <template v-else>
                <div class="device-preview-panel-selector">
                    <strong v-if="fixedSection">{{ title }}</strong>
                    <label v-else :for="selectorId">预览栏目</label>
                    <select
                        v-if="!fixedSection"
                        :id="selectorId"
                        class="form-select"
                        aria-label="选择预览栏目"
                        :value="sectionId"
                        :disabled="actionBusy"
                        @change="emit('select', $event.target.value)"
                    >
                        <option v-for="item in sections" :key="item.id" :value="item.id">
                            {{ item.label }}
                        </option>
                    </select>
                </div>
                <p class="device-preview-state">
                    <span class="device-preview-state-dot"></span>未接入 · 仅界面与接口预览
                </p>
                <div v-if="error" class="device-preview-error" role="alert">
                    <p>{{ error }}</p>
                    <button type="button" class="btn" @click="load">重试预览</button>
                </div>
                <div v-else class="device-preview-empty">
                    <strong>{{ loading ? '正在读取预览状态…' : '当前模块未接入' }}</strong>
                    <span v-if="result">{{ result.message }}</span>
                    <span v-if="result" class="device-preview-count">共 {{ result.total }} 项</span>
                </div>
                <div
                    v-if="actionFeedback"
                    class="device-preview-feedback"
                    :class="{ error: actionError }"
                    :role="actionError ? 'alert' : 'status'"
                >
                    {{ actionFeedback }}
                </div>
                <div class="device-preview-actions">
                    <button
                        v-for="tool in tools"
                        :key="tool.id"
                        type="button"
                        class="btn device-preview-action"
                        :data-preview-action="tool.id"
                        :disabled="loading || actionBusy"
                        @click="emit('action', tool.id)"
                    >
                        {{ tool.label }}
                    </button>
                </div>
                <p class="device-preview-footnote">预览接口不读取原文，也不下发设备指令。</p>
            </template>
        </section>
    </FloatingViewer>
</template>

<style scoped>
.device-demo-heading-quick {
    color: #9462ff;
}
.device-demo-count {
    white-space: nowrap;
    padding: 2px 6px;
    border-radius: 7px;
    background: var(--lab-bg);
    color: var(--lab-muted);
    font-size: 10px;
}
.device-demo-toggle {
    padding: 2px 4px;
    font-size: 9px;
    white-space: nowrap;
    border: 1px solid var(--lab-line);
    border-radius: 6px;
    background: var(--lab-surface);
    color: var(--lab-muted);
}
.device-demo-toggle[aria-pressed='true'] {
    color: #5364ff;
    background: #eef1ff;
    border-color: #a8b1ff;
}
.device-demo-reset {
    color: #9462ff;
    padding: 2px 3px;
    font-size: 13px;
}
:global(.console-detail .floating-viewer-preview .floating-heading .btn.device-demo-toggle) {
    min-width: 0;
    width: auto;
    padding: 0 5px;
    font-size: 9px;
}
:global(.console-detail .floating-viewer-preview .floating-heading .btn.device-demo-reset) {
    min-width: 22px;
    width: 22px;
    padding: 0;
    font-size: 13px;
}
:global(
    .console-detail
        .floating-viewer-preview:has(.device-preview-panel[data-demo-capable='true'])
        .floating-heading-actions
) {
    gap: 4px;
}
.device-demo-feedback {
    margin: 0;
    padding: 5px 8px;
    border-top: 1px solid var(--lab-line);
    color: var(--lab-muted);
    font-size: 9px;
    flex: 0 0 auto;
}
.device-demo-toggle:focus-visible,
.device-demo-reset:focus-visible {
    outline: 2px solid #5364ff;
    outline-offset: 2px;
}
.device-preview-panel[data-demo='true'] {
    display: flex;
    flex-direction: column;
    min-height: 0;
    flex: 1 1 auto;
}
:global(.floating-viewer-preview:has(.device-preview-panel[data-demo='true']) .floating-content) {
    display: flex;
    overflow: hidden;
}
:global(
    .floating-viewer-preview:has(.device-preview-panel[data-demo-capable='true']) .floating-heading
) {
    min-height: 42px;
}
[data-bs-theme='dark'] .device-demo-toggle[aria-pressed='true'] {
    color: #b5c0ff;
    background: #293253;
    border-color: #6472c7;
}
.device-preview-panel {
    color: var(--lab-ink);
    font-size: 11px;
}
.device-preview-panel-selector {
    display: grid;
    gap: 6px;
    padding: 12px;
    border-bottom: 1px solid var(--lab-line);
}
.device-preview-panel-selector label {
    color: var(--lab-muted);
    font-size: 10px;
}
.device-preview-panel-selector .form-select {
    min-height: 30px;
    padding: 5px 25px 5px 9px;
    border-radius: 7px;
    font-size: 11px;
}
.device-preview-state {
    display: flex;
    align-items: center;
    gap: 6px;
    margin: 0;
    padding: 10px 12px;
    border-bottom: 1px solid var(--lab-line);
    background: var(--lab-bg);
    color: var(--lab-muted);
    font-size: 10px;
}
.device-preview-state-dot {
    width: 6px;
    height: 6px;
    border-radius: 50%;
    background: #a7afc1;
}
.device-preview-empty {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 8px;
    min-height: 115px;
    padding: 16px;
    text-align: center;
    color: var(--lab-muted);
}
.device-preview-empty strong {
    font-size: 12px;
    font-weight: 600;
}
.device-preview-empty span {
    line-height: 1.6;
}
.device-preview-count {
    font-size: 10px;
}
.device-preview-error,
.device-preview-feedback {
    padding: 10px 12px;
    background: #f2f5ff;
    color: #5668d7;
}
.device-preview-error,
.device-preview-feedback.error {
    background: #fff4f4;
    color: #ba4b52;
}
.device-preview-error p {
    margin-bottom: 8px;
}
.device-preview-actions {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 6px;
    padding: 10px 12px;
    border-top: 1px solid var(--lab-line);
}
.device-preview-action {
    padding: 5px 3px;
    min-height: 30px;
    border: 1px solid var(--lab-line);
    border-radius: 7px;
    font-size: 10px;
}
.device-preview-footnote {
    margin: 0;
    padding: 8px 12px 12px;
    color: var(--lab-muted);
    font-size: 9px;
    line-height: 1.5;
}
[data-bs-theme='dark'] .device-preview-error,
[data-bs-theme='dark'] .device-preview-feedback.error {
    background: #382733;
    color: #e7a9ad;
}
[data-bs-theme='dark'] .device-preview-feedback {
    background: #24324c;
    color: #aebcf5;
}
</style>
