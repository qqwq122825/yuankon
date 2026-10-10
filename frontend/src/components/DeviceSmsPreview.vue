<script setup>
import { computed, onUnmounted, ref, useId, watch } from 'vue';
import { api } from '../api.js';
import { session } from '../session.js';
import fixture from '../fixtures/device-sms-demo.json';

const props = defineProps({
    deviceId: Number,
    observations: { type: Array, default: () => [] },
});
const searchId = useId();
const demoMode = ref(false);
const query = ref('');
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
const demoMessages =
    fixture.schemaVersion === 1 &&
    fixture.source === 'synthetic-ui-fixture' &&
    fixture.fixtureOnly === true &&
    Array.isArray(fixture.messages)
        ? fixture.messages
              .filter((item) => item?.synthetic === true)
              .map((item) => ({
                  id: String(item.id ?? ''),
                  sender: String(item.sender ?? ''),
                  address: String(item.address ?? ''),
                  body: String(item.body ?? ''),
                  receivedAt: String(item.receivedAt ?? ''),
              }))
        : [];
const normalized = (value) => String(value).normalize('NFKC').toLowerCase();
const messages = computed(() => {
    if (!demoMode.value) return [];
    const search = normalized(query.value.trim());
    if (!search) return demoMessages;
    return demoMessages.filter((item) =>
        [item.sender, item.address, item.body].some((value) => normalized(value).includes(search)),
    );
});
const observations = computed(() =>
    props.observations
        .filter((item) => typeof item?.scenario === 'string' && item.scenario.startsWith('sms'))
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
function messageTime(value) {
    const date = new Date(value);
    if (!Number.isFinite(date.getTime())) return '—';
    return new Intl.DateTimeFormat('zh-CN', {
        timeZone: 'Asia/Shanghai',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hour12: false,
    }).format(date);
}
function toggleDemo() {
    feedbackRevision++;
    demoMode.value = !demoMode.value;
    query.value = '';
    feedback.value = '';
}
function previewAuthorization() {
    feedbackRevision++;
    feedback.value = '自动授权尚未接入；未改变设备权限。';
}
function reset() {
    feedbackRevision++;
    controller?.abort();
    controller = undefined;
    demoMode.value = false;
    query.value = '';
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
    if (interactive) {
        feedbackRevision++;
        feedback.value = '';
    }
    const revision = feedbackRevision;
    try {
        const response = await api(`/api/devices/${deviceId}/ui-preview/sms`, {
            signal: request.signal,
        });
        if (request.signal.aborted || !alive || key !== context() || controller !== request) return;
        if (
            response.mode !== 'preview' ||
            response.implemented !== false ||
            response.state !== 'not_connected' ||
            response.deviceId !== deviceId ||
            response.section?.id !== 'sms' ||
            !Array.isArray(response.items) ||
            response.items.length !== 0 ||
            response.total !== 0
        )
            throw new Error('短信预览状态不符合当前约定，请重试。');
        result.value = response;
        if (interactive && feedbackRevision === revision)
            feedback.value = '已读取预览状态；设备短信功能尚未接入。';
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
        class="sms-preview"
        aria-label="短信记录"
        :aria-busy="loading"
        :data-demo="demoMode"
        :data-state="result?.state || (error ? 'error' : 'loading')"
    >
        <header class="sms-preview-heading">
            <h2 class="sms-heading-title">短信记录</h2>
            <div class="sms-preview-actions">
                <button type="button" class="sms-button" :disabled="loading" @click="load(true)">
                    <span aria-hidden="true">💬</span>获取短信
                </button>
                <button
                    type="button"
                    class="sms-button sms-button-green"
                    @click="previewAuthorization"
                >
                    <span aria-hidden="true">✅</span>自动授权
                </button>
                <button
                    type="button"
                    class="sms-button sms-button-demo"
                    :aria-pressed="demoMode"
                    @click="toggleDemo"
                >
                    测试数据
                </button>
            </div>
        </header>
        <div class="sms-preview-toolbar">
            <label class="sms-search-label" :for="searchId">搜索短信内容或号码</label>
            <input
                :id="searchId"
                v-model="query"
                class="sms-search"
                type="search"
                placeholder="搜索短信内容或号码"
                autocomplete="off"
            />
            <span class="sms-count">共 {{ messages.length }} 条短信</span>
        </div>
        <p v-if="demoMode" class="sms-demo-notice">
            <strong>合成测试数据 · 非设备短信</strong>
            <span>匹配 {{ messages.length }} / 共 {{ demoMessages.length }} 条合成样例</span>
        </p>
        <p v-else class="sms-preview-caption">未接入 · 当前接口仅提供短信预览空态。</p>
        <p v-if="loading" class="sms-preview-loading" role="status">正在读取短信预览状态…</p>
        <div v-if="error" class="sms-preview-error" role="alert">
            <span>{{ error }}</span>
            <button type="button" class="sms-button" :disabled="loading" @click="load(true)">
                重试预览
            </button>
        </div>
        <p v-if="feedback" class="sms-preview-feedback" role="status">{{ feedback }}</p>
        <div class="sms-message-list">
            <article
                v-for="message in messages"
                :key="message.id"
                class="sms-message"
                :data-message-id="message.id"
                data-synthetic="true"
            >
                <header class="sms-message-heading">
                    <span class="sms-message-avatar" aria-hidden="true">{{
                        Array.from(message.sender.trim())[0] || 'S'
                    }}</span>
                    <div class="sms-message-sender">
                        <strong>{{ message.sender }}</strong>
                        <span>{{ message.address }}</span>
                    </div>
                    <time class="sms-message-time" :datetime="message.receivedAt">{{
                        messageTime(message.receivedAt)
                    }}</time>
                </header>
                <p class="sms-message-body">{{ message.body }}</p>
            </article>
            <p v-if="!messages.length && (demoMode || (!loading && !error))" class="sms-empty">
                {{ demoMode ? '没有匹配的合成短信' : '暂无短信记录' }}
            </p>
        </div>
        <details class="sms-metadata">
            <summary>短信场景元数据</summary>
            <p>仅展示已记录的场景与通道属性，不是短信文本。</p>
            <table v-if="observations.length">
                <thead>
                    <tr>
                        <th>场景</th>
                        <th>通道</th>
                        <th>用例</th>
                        <th>返回文本</th>
                        <th>合成匹配</th>
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
            <p v-else class="sms-metadata-empty">暂无短信场景元数据</p>
        </details>
    </section>
</template>

<style scoped>
.sms-preview {
    min-width: 0;
    color: var(--lab-ink, #353c4d);
    font-size: 11px;
}
.sms-preview-heading {
    display: flex;
    align-items: center;
    justify-content: flex-start;
    gap: 12px;
    margin-bottom: 12px;
}
.sms-preview-heading h2 {
    margin: 0;
    font-size: 16px;
    font-weight: 650;
}
.sms-heading-title {
    position: absolute;
    width: 1px;
    height: 1px;
    overflow: hidden;
    clip-path: inset(50%);
    white-space: nowrap;
}
.sms-preview-actions {
    display: flex;
    align-items: center;
    gap: 6px;
}
.sms-button {
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
.sms-button-green {
    border-color: #21bd91;
    background: #21bd91;
    color: #fff;
}
.sms-button-demo {
    border-color: #c8cffe;
    color: #5366ff;
}
.sms-button-demo[aria-pressed='true'] {
    background: #eef1ff;
    border-color: #8998ff;
}
.sms-button:hover:not(:disabled) {
    filter: brightness(0.97);
}
.sms-button:disabled {
    opacity: 0.6;
    cursor: wait;
}
.sms-button:focus-visible,
.sms-search:focus-visible,
.sms-metadata summary:focus-visible {
    outline: 2px solid #6474ff;
    outline-offset: 2px;
}
.sms-preview-toolbar {
    display: flex;
    align-items: flex-start;
    flex-direction: column;
    gap: 8px;
}
.sms-search-label {
    position: absolute;
    width: 1px;
    height: 1px;
    overflow: hidden;
    clip-path: inset(50%);
    white-space: nowrap;
}
.sms-search {
    width: min(424px, 100%);
    min-width: 0;
    min-height: 32px;
    flex: 0 0 auto;
    border: 1px solid var(--lab-line, #e5e8f0);
    border-radius: 7px;
    padding: 6px 10px;
    background: #fff;
    color: var(--lab-ink, #353c4d);
    font: inherit;
    font-size: 11px;
}
.sms-search::placeholder {
    color: var(--lab-muted, #9299aa);
}
.sms-count {
    flex-shrink: 0;
    color: var(--lab-muted, #9299aa);
    font-size: 11px;
    white-space: nowrap;
}
.sms-demo-notice {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 10px;
    margin: 10px 0;
    color: #5b6cb8;
    font-size: 10px;
}
.sms-demo-notice strong {
    font-weight: 600;
}
.sms-preview-caption {
    margin: 10px 0;
    color: var(--lab-muted, #9299aa);
    font-size: 10px;
}
.sms-preview-loading {
    margin: 10px 0;
    color: var(--lab-muted, #9299aa);
}
.sms-preview-error {
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
.sms-preview-feedback {
    margin: 10px 0;
    border: 1px solid var(--lab-line, #e5e8f0);
    border-radius: 6px;
    padding: 8px 10px;
    background: var(--lab-bg, #f8f9fb);
    color: var(--lab-muted, #9299aa);
}
.sms-message-list {
    display: grid;
    gap: 8px;
}
.sms-message {
    min-width: 0;
    border: 1px solid var(--lab-line, #e5e8f0);
    border-radius: 9px;
    padding: 12px 14px;
    background: #fff;
}
.sms-message-heading {
    display: flex;
    align-items: center;
    gap: 9px;
}
.sms-message-avatar {
    display: grid;
    width: 30px;
    height: 30px;
    flex-shrink: 0;
    place-items: center;
    border-radius: 50%;
    background: #4c89ee;
    color: #fff;
    font-size: 13px;
    font-weight: 600;
}
.sms-message-sender {
    display: grid;
    min-width: 0;
    flex: 1 1 auto;
    gap: 1px;
}
.sms-message-sender strong {
    overflow-wrap: anywhere;
    font-size: 12px;
    font-weight: 650;
}
.sms-message-sender > span {
    overflow-wrap: anywhere;
    color: var(--lab-muted, #9299aa);
    font-size: 10px;
}
.sms-message-time {
    flex-shrink: 0;
    color: var(--lab-muted, #9299aa);
    font-size: 10px;
    white-space: nowrap;
}
.sms-message-body {
    margin: 9px 0 0;
    overflow-wrap: anywhere;
    font-size: 11px;
    line-height: 1.65;
    text-align: left;
    white-space: pre-wrap;
}
.sms-empty {
    margin: 0;
    border: 1px solid var(--lab-line, #e5e8f0);
    border-radius: 9px;
    padding: 30px 12px;
    background: #fff;
    color: var(--lab-muted, #9299aa);
    text-align: center;
}
.sms-metadata {
    margin-top: 16px;
    border: 1px solid var(--lab-line, #e5e8f0);
    border-radius: 7px;
    padding: 10px 12px;
    background: #fff;
}
.sms-metadata summary {
    color: var(--lab-muted, #9299aa);
    font-size: 11px;
    cursor: pointer;
}
.sms-metadata > p {
    margin: 10px 0;
    color: var(--lab-muted, #9299aa);
    font-size: 10px;
}
.sms-metadata table {
    width: 100%;
    border-collapse: collapse;
    font-size: 10px;
}
.sms-metadata th,
.sms-metadata td {
    border-bottom: 1px solid var(--lab-line, #e5e8f0);
    padding: 7px 6px;
    text-align: left;
    overflow-wrap: anywhere;
}
.sms-metadata th {
    color: var(--lab-muted, #9299aa);
    font-weight: 600;
}
[data-bs-theme='dark'] .sms-button,
[data-bs-theme='dark'] .sms-search,
[data-bs-theme='dark'] .sms-message,
[data-bs-theme='dark'] .sms-empty,
[data-bs-theme='dark'] .sms-metadata {
    background: #1f2938;
}
[data-bs-theme='dark'] .sms-button-green {
    background: #178f72;
    color: #fff;
}
[data-bs-theme='dark'] .sms-button-demo {
    border-color: #6676c0;
    color: #adb9ff;
}
[data-bs-theme='dark'] .sms-button-demo[aria-pressed='true'] {
    border-color: #46588d;
    background: #26334f;
    color: #b4c2f2;
}
[data-bs-theme='dark'] .sms-demo-notice {
    color: #b4c2f2;
}
[data-bs-theme='dark'] .sms-preview-error {
    border-color: #74434b;
    background: #3a2831;
    color: #ffb6be;
}
</style>
