<script setup>
import { computed, onUnmounted, ref, useId, watch } from 'vue';
import { api } from '../api.js';
import { session } from '../session.js';
import fixture from '../fixtures/device-apps-demo.json';

const props = defineProps({ deviceId: Number });
const previewModes = ['预览', '弹窗', '横幅', '模板', '重置'];
const searchId = useId();
const demoMode = ref(false);
const query = ref('');
const showSystem = ref(false);
const loading = ref(false);
const error = ref('');
const feedback = ref('');
const result = ref(null);
let controller;
let alive = true;
let feedbackRevision = 0;
const context = () =>
    JSON.stringify([
        props.deviceId,
        session.user?.id,
        session.user?.role,
        session.user?.projectId,
        session.user?.parentAccountId,
    ]);
const demoApplications =
    fixture.schemaVersion === 1 &&
    fixture.source === 'synthetic-ui-fixture' &&
    fixture.fixtureOnly === true &&
    Array.isArray(fixture.applications)
        ? fixture.applications
              .filter((item) => item?.synthetic === true)
              .map((item) => ({
                  id: String(item.id ?? ''),
                  name: String(item.name ?? ''),
                  packageName: String(item.packageName ?? ''),
                  initial: String(item.initial ?? 'A'),
                  system: item.system === true,
              }))
        : [];
const normalized = (value) => String(value).normalize('NFKC').toLowerCase();
const applications = computed(() => {
    if (!demoMode.value) return [];
    const search = normalized(query.value.trim());
    return demoApplications.filter(
        (item) =>
            (showSystem.value || !item.system) &&
            (!search ||
                [item.name, item.packageName].some((value) => normalized(value).includes(search))),
    );
});
const groups = computed(() =>
    [
        { id: 'user', label: '常用应用', system: false },
        { id: 'system', label: '系统应用', system: true },
    ]
        .map((group) => ({
            ...group,
            applications: applications.value.filter((item) => item.system === group.system),
        }))
        .filter((group) => group.applications.length),
);
function toggleDemo() {
    feedbackRevision++;
    demoMode.value = !demoMode.value;
    query.value = '';
    showSystem.value = false;
    feedback.value = '';
}
function clearFeedback() {
    feedbackRevision++;
    feedback.value = '';
}
function previewApplication(item, mode = '预览') {
    if (!previewModes.includes(mode)) return;
    feedbackRevision++;
    if (mode === '重置') {
        feedback.value = '';
        feedback.value = `「${item.name}」已重置样例预览；未修改设备应用或业务记录。`;
        return;
    }
    feedback.value = `「${item.name}」${mode}仅为本地合成预览；未打开或修改设备应用。`;
}
function reset() {
    feedbackRevision++;
    controller?.abort();
    controller = undefined;
    demoMode.value = false;
    query.value = '';
    showSystem.value = false;
    loading.value = false;
    error.value = '';
    feedback.value = '';
    result.value = null;
}
async function load(interactive = false) {
    controller?.abort();
    if (!alive || !session.user || !Number.isSafeInteger(props.deviceId) || props.deviceId <= 0)
        return;
    const request = (controller = new AbortController());
    const key = context();
    const deviceId = props.deviceId;
    loading.value = true;
    error.value = '';
    result.value = null;
    if (interactive) clearFeedback();
    const revision = feedbackRevision;
    try {
        const response = await api(`/api/devices/${deviceId}/ui-preview/apps`, {
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
            response.section?.id !== 'apps' ||
            !Array.isArray(response.items) ||
            response.items.length !== 0 ||
            response.total !== 0
        )
            throw new Error('应用预览状态不符合当前约定，请重试。');
        result.value = response;
        if (interactive && revision === feedbackRevision)
            feedback.value = '已读取预览状态；设备应用列表功能尚未接入。';
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
        reset();
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
    <section
        class="apps-preview"
        aria-label="应用列表"
        :aria-busy="loading"
        :data-state="result?.state || (error ? 'error' : 'loading')"
        :data-demo="demoMode"
    >
        <header class="apps-preview-heading">
            <h2 class="apps-visually-hidden">应用列表</h2>
            <button type="button" class="apps-button" :disabled="loading" @click="load(true)">
                <span aria-hidden="true">📱</span>获取应用列表
            </button>
            <button
                type="button"
                class="apps-button apps-button-demo"
                :aria-pressed="demoMode"
                @click="toggleDemo"
            >
                测试数据
            </button>
        </header>
        <div class="apps-toolbar">
            <label class="apps-visually-hidden" :for="searchId">搜索应用名称或包名</label>
            <input
                :id="searchId"
                v-model="query"
                class="apps-search"
                type="search"
                placeholder="搜索应用名称或包名"
                autocomplete="off"
                @input="clearFeedback"
            />
            <span class="apps-count">共 {{ applications.length }} 个应用</span>
            <label class="apps-system-toggle">
                <input v-model="showSystem" type="checkbox" @change="clearFeedback" />
                显示系统应用
            </label>
        </div>
        <p v-if="demoMode" class="apps-demo-notice">
            <strong>合成测试数据 · 非设备应用</strong>
            <span
                >匹配 {{ applications.length }} / 共 {{ demoApplications.length }} 条合成样例</span
            >
        </p>
        <p v-else class="apps-caption">未接入 · 当前接口仅提供应用列表预览空态。</p>
        <p v-if="loading" class="apps-loading" role="status">正在读取应用预览状态…</p>
        <div v-if="error" class="apps-error" role="alert">
            <span>{{ error }}</span>
            <button type="button" class="apps-button" :disabled="loading" @click="load(true)">
                重试预览
            </button>
        </div>
        <p v-if="feedback" class="apps-preview-feedback" role="status">{{ feedback }}</p>
        <div class="apps-groups">
            <section
                v-for="group in groups"
                :key="group.id"
                class="apps-group"
                :data-app-group="group.id"
                :aria-label="group.label"
            >
                <h3>
                    {{ group.label }} <span>{{ group.applications.length }}</span>
                </h3>
                <div class="apps-list">
                    <article
                        v-for="application in group.applications"
                        :key="application.id"
                        class="app-row"
                        :data-app-id="application.id"
                        :data-system="application.system"
                    >
                        <span class="app-icon" aria-hidden="true">{{ application.initial }}</span>
                        <div class="app-identity">
                            <div class="app-name-line">
                                <span
                                    class="app-status"
                                    :class="{ 'is-system': application.system }"
                                >
                                    {{ application.system ? '系统样例' : '合成样例' }}
                                </span>
                                <strong>{{ application.name }}</strong>
                            </div>
                            <span class="app-package">{{ application.packageName }}</span>
                        </div>
                        <div class="app-actions">
                            <button
                                v-for="mode in previewModes"
                                :key="mode"
                                type="button"
                                class="apps-button app-preview-button"
                                :class="{
                                    'is-popup': mode === '弹窗',
                                    'is-banner': mode === '横幅',
                                    'is-template': mode === '模板',
                                    'is-reset': mode === '重置',
                                }"
                                :data-local-action="mode"
                                :aria-label="`${mode} ${application.name} 合成应用`"
                                @click="previewApplication(application, mode)"
                            >
                                {{ mode }}
                            </button>
                        </div>
                    </article>
                </div>
            </section>
            <p v-if="!applications.length && (demoMode || (!loading && !error))" class="apps-empty">
                {{ demoMode ? '没有匹配的合成应用' : '暂无应用记录' }}
            </p>
        </div>
    </section>
</template>

<style scoped>
.apps-preview {
    min-width: 0;
    color: var(--lab-ink, #353c4d);
    font-size: 11px;
}
.apps-preview-heading {
    display: flex;
    align-items: center;
    gap: 6px;
    margin-bottom: 12px;
}
.apps-visually-hidden {
    position: absolute;
    width: 1px;
    height: 1px;
    overflow: hidden;
    clip-path: inset(50%);
    white-space: nowrap;
}
.apps-button {
    display: inline-flex;
    min-height: 29px;
    align-items: center;
    justify-content: center;
    gap: 4px;
    border: 1px solid var(--lab-line, #e5e8f0);
    border-radius: 5px;
    padding: 5px 11px;
    background: #fff;
    color: var(--lab-ink, #353c4d);
    font: inherit;
    font-size: 11px;
    line-height: 1.4;
    white-space: nowrap;
    cursor: pointer;
}
.apps-button-demo {
    border-color: #c8cffe;
    color: #5366ff;
}
.apps-button-demo[aria-pressed='true'] {
    border-color: #8998ff;
    background: #eef1ff;
}
.apps-button:hover:not(:disabled) {
    filter: brightness(0.97);
}
.apps-button:disabled {
    opacity: 0.6;
    cursor: wait;
}
.apps-button:focus-visible,
.apps-search:focus-visible,
.apps-system-toggle:has(input:focus-visible) {
    outline: 2px solid #6474ff;
    outline-offset: 2px;
}
.apps-toolbar {
    display: flex;
    align-items: center;
    gap: 12px;
}
.apps-search {
    width: auto;
    min-width: 0;
    min-height: 32px;
    flex: 1 1 auto;
    border: 1px solid var(--lab-line, #e5e8f0);
    border-radius: 7px;
    padding: 6px 10px;
    background: #fff;
    color: var(--lab-ink, #353c4d);
    font: inherit;
    font-size: 11px;
}
.apps-search::placeholder {
    color: var(--lab-muted, #9299aa);
}
.apps-count {
    flex-shrink: 0;
    color: var(--lab-muted, #9299aa);
    white-space: nowrap;
}
.apps-system-toggle {
    display: inline-flex;
    flex-shrink: 0;
    align-items: center;
    gap: 5px;
    border-radius: 4px;
    color: var(--lab-muted, #9299aa);
    white-space: nowrap;
    cursor: pointer;
}
.apps-system-toggle input {
    width: 12px;
    height: 12px;
    margin: 0;
    accent-color: #5366ff;
}
.apps-demo-notice {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 10px;
    margin: 10px 0;
    color: #5b6cb8;
    font-size: 10px;
}
.apps-demo-notice strong {
    font-weight: 600;
}
.apps-caption,
.apps-loading {
    margin: 10px 0;
    color: var(--lab-muted, #9299aa);
    font-size: 10px;
}
.apps-error {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 10px;
    margin: 10px 0;
    border: 1px solid #f1cbd0;
    border-radius: 6px;
    padding: 8px 10px;
    background: #fff5f6;
    color: #b24a54;
}
.apps-preview-feedback {
    margin: 10px 0;
    border: 1px solid var(--lab-line, #e5e8f0);
    border-radius: 6px;
    padding: 8px 10px;
    background: var(--lab-bg, #f8f9fb);
    color: var(--lab-muted, #9299aa);
}
.apps-groups {
    display: grid;
    gap: 12px;
}
.apps-group h3 {
    display: flex;
    align-items: center;
    gap: 6px;
    margin: 0 0 7px;
    color: var(--lab-muted, #9299aa);
    font-size: 10px;
    font-weight: 500;
}
.apps-group h3 span {
    border-radius: 4px;
    padding: 1px 4px;
    background: #edf0f6;
    font-size: 9px;
}
.apps-list {
    overflow: hidden;
    border: 1px solid var(--lab-line, #e5e8f0);
    border-radius: 8px;
    background: #fff;
}
.app-row {
    display: flex;
    min-height: 70px;
    align-items: center;
    gap: 11px;
    border-bottom: 1px solid var(--lab-line, #e5e8f0);
    padding: 10px 12px;
}
.app-row:last-child {
    border-bottom: 0;
}
.app-icon {
    display: grid;
    width: 48px;
    height: 48px;
    flex-shrink: 0;
    place-items: center;
    border: 1px solid #d9e0f5;
    border-radius: 11px;
    background: #edf2ff;
    color: #6078c8;
    font-size: 19px;
    font-weight: 600;
}
.app-identity {
    display: grid;
    min-width: 0;
    flex: 1 1 auto;
    gap: 3px;
}
.app-name-line {
    display: flex;
    align-items: center;
    gap: 6px;
}
.app-name-line > strong {
    overflow-wrap: anywhere;
    font-size: 12px;
    font-weight: 650;
}
.app-package {
    overflow-wrap: anywhere;
    color: var(--lab-muted, #9299aa);
    font-size: 10px;
}
.app-status {
    flex-shrink: 0;
    border: 1px solid #ddd5fa;
    border-radius: 5px;
    padding: 2px 6px;
    background: #f5f1ff;
    color: #8670c0;
    font-size: 10px;
    white-space: nowrap;
}
.app-status.is-system {
    border-color: var(--lab-line, #e5e8f0);
    background: #f3f5f8;
    color: var(--lab-muted, #9299aa);
}
.app-preview-button {
    min-width: 38px;
    min-height: 26px;
    padding: 4px 7px;
    font-size: 10px;
    color: #6173c9;
}
.app-actions {
    display: flex;
    flex-shrink: 0;
    align-items: center;
    gap: 4px;
}
.app-preview-button.is-popup {
    border-color: #8b5cf6;
    background: #8b5cf6;
    color: #fff;
}
.app-preview-button.is-banner {
    border-color: #f59e0b;
    background: #f59e0b;
    color: #fff;
}
.app-preview-button.is-template {
    border-color: #5363ff;
    background: #5363ff;
    color: #fff;
}
.app-preview-button.is-reset {
    color: var(--lab-muted, #9299aa);
}
.apps-empty {
    margin: 0;
    border: 1px solid var(--lab-line, #e5e8f0);
    border-radius: 8px;
    padding: 30px 12px;
    background: #fff;
    color: var(--lab-muted, #9299aa);
    text-align: center;
}
[data-bs-theme='dark'] .apps-button,
[data-bs-theme='dark'] .apps-search,
[data-bs-theme='dark'] .apps-list,
[data-bs-theme='dark'] .apps-empty {
    background: #1f2938;
}
[data-bs-theme='dark'] .apps-button-demo {
    border-color: #6676c0;
    color: #adb9ff;
}
[data-bs-theme='dark'] .apps-button-demo[aria-pressed='true'] {
    border-color: #46588d;
    background: #26334f;
    color: #b4c2f2;
}
[data-bs-theme='dark'] .apps-demo-notice {
    color: #b4c2f2;
}
[data-bs-theme='dark'] .apps-group h3 span {
    background: #293448;
}
[data-bs-theme='dark'] .app-icon {
    border-color: #485778;
    background: #293956;
    color: #adc2fa;
}
[data-bs-theme='dark'] .app-status {
    border-color: #574772;
    background: #332b46;
    color: #c7b2ee;
}
[data-bs-theme='dark'] .app-status.is-system {
    border-color: var(--lab-line, #e5e8f0);
    background: #263143;
    color: var(--lab-muted, #9299aa);
}
[data-bs-theme='dark'] .app-preview-button {
    color: #a4b6ff;
}
[data-bs-theme='dark'] .app-preview-button.is-popup {
    border-color: #655184;
    background: #352b4b;
    color: #c7a5fa;
}
[data-bs-theme='dark'] .app-preview-button.is-banner {
    border-color: #796746;
    background: #3b3528;
    color: #e7c47d;
}
[data-bs-theme='dark'] .app-preview-button.is-template {
    border-color: #4c648b;
    background: #293956;
    color: #adc2fa;
}
[data-bs-theme='dark'] .app-preview-button.is-reset {
    color: var(--lab-muted, #9299aa);
}
[data-bs-theme='dark'] .apps-error {
    border-color: #74434b;
    background: #3a2831;
    color: #ffb6be;
}
</style>
