<script setup>
import { computed, ref, useId, watch } from 'vue';
import { useDeviceDemoPreview } from '../composables/useDeviceDemoPreview.js';
import fixture from '../fixtures/device-apps-demo.json';
import injectionFixture from '../fixtures/device-injection-match-demo.json';
import submissionFixture from '../fixtures/device-injection-submission-demo.json';
import { readAppsPresentation } from '../fixtures/apps-demo-presentation.js';

const props = defineProps({
    deviceId: Number,
    deviceSource: { type: String, default: '' },
});
const searchId = useId();
const { demoMode, loading, error, ready, feedback, contextKey, toggleDemo, refresh } =
    useDeviceDemoPreview(props, 'apps');
const query = ref('');
const showSystem = ref(false);
const localFeedback = ref('');
let feedbackRevision = 0;
const demoData = readAppsPresentation(fixture, injectionFixture, submissionFixture);
const fixtureProtocol = demoData.valid ? fixture.protocol : undefined;
const datasetId = demoData.valid ? fixture.datasetId : undefined;
const demoApplications = demoData.applications;
const configuredNotInstalled = demoData.configuredApplications;
const displayError = computed(() =>
    error.value === '预览状态不符合当前约定，请重试。'
        ? '应用预览状态不符合当前约定，请重试。'
        : error.value,
);
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
const configuredApplications = computed(() => {
    if (!demoMode.value) return [];
    const search = normalized(query.value.trim());
    return configuredNotInstalled.filter(
        (application) =>
            !search ||
            [application.name, application.packageName].some((value) =>
                normalized(value).includes(search),
            ),
    );
});
const groups = computed(() =>
    [
        { id: 'target', label: '🎯 注入目标' },
        { id: 'ordinary', label: '普通应用' },
        { id: 'system', label: '系统应用' },
    ]
        .map((group) => ({
            ...group,
            applications: applications.value.filter((item) => item.presentationGroup === group.id),
        }))
        .filter((group) => group.applications.length),
);
function changeDemo() {
    if (!ready.value) return;
    feedbackRevision++;
    toggleDemo();
    query.value = '';
    showSystem.value = false;
    localFeedback.value = '';
}
function clearFeedback() {
    feedbackRevision++;
    localFeedback.value = '';
}
function previewApplication(item, actionId) {
    const action = item.actions.find((entry) => entry.id === actionId);
    if (!demoMode.value || !action) return;
    feedbackRevision++;
    localFeedback.value = `「${item.name}」${action.label}仅为本地合成预览；未打开、注入或卸载设备应用。`;
}
async function refreshApps() {
    const key = contextKey.value;
    clearFeedback();
    const revision = feedbackRevision;
    await refresh();
    if (ready.value && key === contextKey.value && revision === feedbackRevision)
        localFeedback.value = '已读取预览状态；设备应用列表功能尚未接入。';
}
watch(
    contextKey,
    () => {
        query.value = '';
        showSystem.value = false;
        clearFeedback();
    },
    { flush: 'sync' },
);
</script>

<template>
    <section
        class="apps-preview"
        aria-label="应用列表"
        :aria-busy="loading"
        :data-state="loading ? 'loading' : error ? 'error' : 'not_connected'"
        :data-demo="demoMode"
        :data-protocol="fixtureProtocol"
        :data-dataset-id="datasetId"
    >
        <header
            class="apps-preview-heading"
            :data-protocol="fixtureProtocol"
            :data-dataset-id="datasetId"
        >
            <h2 class="apps-visually-hidden">应用列表</h2>
            <button type="button" class="apps-button" :disabled="loading" @click="refreshApps">
                <span aria-hidden="true">📱</span>获取应用列表
            </button>
            <button
                type="button"
                class="apps-button apps-button-demo"
                :aria-pressed="demoMode"
                :disabled="!ready"
                @click="changeDemo"
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
            <span class="apps-count" title="当前搜索和系统筛选后显示的已安装应用数量"
                >共 {{ applications.length }} 个应用</span
            >
            <label class="apps-system-toggle">
                <input v-model="showSystem" type="checkbox" @change="clearFeedback" />
                显示系统应用
            </label>
        </div>
        <p v-if="demoMode" class="apps-demo-notice">
            <strong>合成测试数据 · 非设备应用</strong>
            <span class="apps-match-counts">
                全局配置 {{ demoData.counts.registry }} · 已安装 {{ demoData.counts.installed }} ·
                注入目标 {{ demoData.counts.matched }}
            </span>
        </p>
        <p v-else class="apps-caption">未接入 · 当前接口仅提供应用列表预览空态。</p>
        <p v-if="loading" class="apps-loading" role="status">正在读取应用预览状态…</p>
        <div v-if="error" class="apps-error" role="alert">
            <span>{{ displayError }}</span>
            <button type="button" class="apps-button" :disabled="loading" @click="refreshApps">
                重试预览
            </button>
        </div>
        <p v-if="localFeedback || feedback" class="apps-preview-feedback" role="status">
            {{ localFeedback || feedback }}
        </p>
        <div class="apps-groups">
            <section
                v-for="group in groups"
                :key="group.id"
                class="apps-group"
                :data-app-group="group.id"
                :aria-label="group.label"
            >
                <h3 :class="{ 'is-target': group.id === 'target' }">
                    {{ group.label }} <span>{{ group.applications.length }}</span>
                </h3>
                <div class="apps-list">
                    <article
                        v-for="application in group.applications"
                        :key="application.id"
                        class="app-row"
                        :data-app-id="application.id"
                        :data-system="application.system"
                        :data-package="application.packageName"
                        :data-match-status="application.matchStatus"
                        :data-protocol="fixtureProtocol"
                        :data-dataset-id="datasetId"
                        data-synthetic="true"
                    >
                        <span class="app-icon" aria-hidden="true">{{ application.initial }}</span>
                        <div class="app-identity">
                            <div class="app-name-line">
                                <span
                                    class="app-status"
                                    :class="{
                                        'is-system': application.presentationGroup !== 'target',
                                        'is-submitted': application.matchStatus === 'submitted',
                                        'is-injected': application.matchStatus === 'injected',
                                    }"
                                >
                                    {{ application.statusLabel }}
                                </span>
                                <strong>{{ application.name }}</strong>
                            </div>
                            <span class="app-package">{{ application.packageName }}</span>
                        </div>
                        <div class="app-actions">
                            <button
                                v-for="action in application.actions"
                                :key="action.id"
                                type="button"
                                class="apps-button app-preview-button"
                                :class="`is-${action.tone}`"
                                :data-local-action="action.label"
                                :data-action-id="action.id"
                                :aria-label="`${action.label} ${application.name} 合成应用`"
                                @click="previewApplication(application, action.id)"
                            >
                                {{ action.label }}
                            </button>
                        </div>
                    </article>
                </div>
            </section>
            <section
                v-if="configuredApplications.length"
                class="apps-group"
                data-app-group="configured"
                aria-label="已配置未安装的合成应用"
            >
                <h3>
                    已配置未安装 <span>{{ configuredApplications.length }}</span>
                </h3>
                <div class="apps-list">
                    <article
                        v-for="application in configuredApplications"
                        :key="application.id"
                        class="app-configured-row"
                        :data-configured-id="application.id"
                        :data-package="application.packageName"
                        :data-protocol="fixtureProtocol"
                        :data-registry-protocol="injectionFixture.protocol"
                        :data-dataset-id="datasetId"
                        data-synthetic="true"
                    >
                        <span class="app-icon" aria-hidden="true">{{ application.initial }}</span>
                        <div class="app-identity">
                            <div class="app-name-line">
                                <span class="app-status is-configured"
                                    >已配置注入，本机未安装（示例）</span
                                >
                                <strong>{{ application.name }}</strong>
                            </div>
                            <span class="app-package">{{ application.packageName }}</span>
                        </div>
                    </article>
                </div>
            </section>
            <p
                v-if="
                    !applications.length &&
                    !configuredApplications.length &&
                    (demoMode || (!loading && !error))
                "
                class="apps-empty"
            >
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
.apps-group h3.is-target {
    color: #5366ff;
}
.apps-list {
    overflow: hidden;
    border: 1px solid var(--lab-line, #e5e8f0);
    border-radius: 8px;
    background: #fff;
}
.app-row,
.app-configured-row {
    display: flex;
    min-height: 70px;
    align-items: center;
    gap: 11px;
    border-bottom: 1px solid var(--lab-line, #e5e8f0);
    padding: 10px 12px;
}
.app-row:last-child,
.app-configured-row:last-child {
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
.app-status.is-submitted {
    border-color: #bde5d3;
    background: #ecfbf3;
    color: #009b70;
}
.app-status.is-injected {
    border-color: #cbd6fc;
    background: #edf2ff;
    color: #386cff;
}
.app-status.is-configured {
    border-color: #fae5ba;
    background: #fff8e8;
    color: #ce8a23;
}
.app-preview-button {
    min-width: 38px;
    min-height: 26px;
    padding: 4px 7px;
    font-size: 10px;
    color: var(--lab-ink, #353c4d);
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
.app-preview-button.is-inject {
    border-color: #5363ff;
    background: #5363ff;
    color: #fff;
}
.app-preview-button.is-reinject {
    border-color: #f59e0b;
    background: #f59e0b;
    color: #fff;
}
.app-preview-button.is-uninstall {
    border-color: #ff909d;
    color: #ff455e;
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
[data-bs-theme='dark'] .apps-group h3.is-target {
    color: #b4c2f2;
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
[data-bs-theme='dark'] .app-status.is-submitted {
    border-color: #31554a;
    background: #1c352e;
    color: #68dab2;
}
[data-bs-theme='dark'] .app-status.is-injected {
    border-color: #46588d;
    background: #26334f;
    color: #b4c2f2;
}
[data-bs-theme='dark'] .app-status.is-configured {
    border-color: #635238;
    background: #3d3424;
    color: #eac078;
}
[data-bs-theme='dark'] .app-preview-button {
    color: #a4b6ff;
}
[data-bs-theme='dark'] .app-preview-button.is-popup {
    border-color: #655184;
    background: #352b4b;
    color: #c7a5fa;
}
[data-bs-theme='dark'] .app-preview-button.is-banner,
[data-bs-theme='dark'] .app-preview-button.is-reinject {
    border-color: #796746;
    background: #3b3528;
    color: #e7c47d;
}
[data-bs-theme='dark'] .app-preview-button.is-inject {
    border-color: #4c648b;
    background: #293956;
    color: #adc2fa;
}
[data-bs-theme='dark'] .app-preview-button.is-uninstall {
    border-color: #a7616d;
    color: #ff9daa;
}
[data-bs-theme='dark'] .apps-error {
    border-color: #74434b;
    background: #3a2831;
    color: #ffb6be;
}
</style>
