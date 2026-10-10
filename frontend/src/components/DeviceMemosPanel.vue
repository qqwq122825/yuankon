<script setup>
import { computed, nextTick, onUnmounted, ref, watch } from 'vue';
import { api, formatDate } from '../api.js';
import { session } from '../session.js';
import demoFixture from '../fixtures/device-memos-demo.json';
import { readMemosDemo } from '../fixtures/device-fixture-protocol.js';

const props = defineProps({ deviceId: Number });
const demoData = readMemosDemo(demoFixture);
const verified = ref(false);
const requestedDemo = ref(false);
const demoMode = computed(() =>
    Boolean(demoData.valid && session.user && verified.value && requestedDemo.value),
);
function toggleDemo() {
    if (demoData.valid && verified.value && !loading.value)
        requestedDemo.value = !requestedDemo.value;
}
const labels = { none: '无标签', important: '重要', follow_up: '待跟进', handled: '已处理' };
const memos = ref([]);
const loading = ref(false);
const busy = ref(false);
const error = ref('');
const feedback = ref('');
const editor = ref(false);
const form = ref({ id: null, body: '', label: 'none' });
const textarea = ref(null);
const addButton = ref(null);
let loadController;
let writeController;
let alive = true;
let opener;
const context = () =>
    JSON.stringify([
        props.deviceId,
        session.user?.id,
        session.user?.role,
        session.user?.projectId,
        session.user?.parentAccountId,
    ]);
const validMemo = (item) =>
    item &&
    Number.isSafeInteger(item.id) &&
    item.id > 0 &&
    typeof item.body === 'string' &&
    item.body.trim().length > 0 &&
    item.body.length <= 500 &&
    Object.hasOwn(labels, item.label) &&
    typeof item.author === 'string' &&
    Number.isFinite(item.createdAt) &&
    Number.isFinite(item.updatedAt);
const current = (key, request) => alive && key === context() && !request.signal.aborted;

async function load() {
    loadController?.abort();
    verified.value = false;
    if (!session.user || !Number.isSafeInteger(props.deviceId) || props.deviceId < 1) return;
    const request = (loadController = new AbortController());
    const key = context();
    loading.value = true;
    error.value = '';
    try {
        const result = await api(`/api/devices/${props.deviceId}/memos`, {
            signal: request.signal,
        });
        if (!current(key, request) || loadController !== request) return;
        if (
            !result ||
            typeof result !== 'object' ||
            !Array.isArray(result.data) ||
            result.total !== result.data.length ||
            !result.data.every(validMemo) ||
            new Set(result.data.map((item) => item.id)).size !== result.data.length
        )
            throw new Error('备忘录响应格式不符，请重试。');
        verified.value = true;
        memos.value = result.data.map(({ id, body, label, author, createdAt, updatedAt }) => ({
            id,
            body,
            label,
            author,
            createdAt,
            updatedAt,
        }));
    } catch (failure) {
        if (current(key, request) && loadController === request && failure.name !== 'AbortError')
            error.value = failure.message;
    } finally {
        if (loadController === request) loading.value = false;
    }
}
async function edit(memo, event) {
    if (busy.value) return;
    opener = event?.currentTarget || addButton.value;
    form.value = memo
        ? { id: memo.id, body: memo.body, label: memo.label }
        : { id: null, body: '', label: 'none' };
    error.value = '';
    feedback.value = '';
    editor.value = true;
    await nextTick();
    if (alive && editor.value) textarea.value?.focus();
}
async function closeEditor() {
    editor.value = false;
    form.value = { id: null, body: '', label: 'none' };
    await nextTick();
    if (!alive || busy.value) return;
    (opener?.isConnected ? opener : addButton.value)?.focus();
}
async function write(method, id, body) {
    if (busy.value || !session.user) return;
    const key = context();
    const device = props.deviceId;
    const request = (writeController = new AbortController());
    let restoreFocus = false;
    loadController?.abort();
    loading.value = false;
    busy.value = true;
    error.value = '';
    feedback.value = '';
    try {
        const result = await api(`/api/devices/${device}/memos${id ? `/${id}` : ''}`, {
            method,
            body: JSON.stringify(body),
            signal: request.signal,
        });
        if (!current(key, request) || writeController !== request) return;
        if (
            !result ||
            typeof result !== 'object' ||
            (method === 'DELETE' ? result.ok !== true : !validMemo(result))
        )
            throw new Error('备忘录操作响应格式不符，请刷新核对。');
        if (method !== 'DELETE' || form.value.id === id) await closeEditor();
        if (!current(key, request)) return;
        feedback.value = method === 'DELETE' ? '备忘已删除。' : '备忘已保存。';
        await load();
        restoreFocus = true;
    } catch (failure) {
        if (current(key, request) && writeController === request && failure.name !== 'AbortError')
            error.value = failure.message;
    } finally {
        if (writeController === request && current(key, request)) {
            busy.value = false;
            if (restoreFocus) {
                await nextTick();
                if (writeController === request && current(key, request)) {
                    const target =
                        method !== 'DELETE' && opener?.isConnected ? opener : addButton.value;
                    target?.focus();
                }
            }
        }
    }
}
function save() {
    const body = form.value.body.trim();
    if (!body || body.length > 500 || !Object.hasOwn(labels, form.value.label)) {
        error.value = '请填写 1–500 字的备忘内容并选择有效标签。';
        return;
    }
    write(form.value.id ? 'PATCH' : 'POST', form.value.id, { body, label: form.value.label });
}
function remove(memo) {
    if (!busy.value && window.confirm('确认删除这条备忘？')) write('DELETE', memo.id, {});
}
watch(
    context,
    () => {
        loadController?.abort();
        writeController?.abort();
        loadController = undefined;
        writeController = undefined;
        memos.value = [];
        verified.value = false;
        requestedDemo.value = false;
        loading.value = false;
        busy.value = false;
        error.value = '';
        feedback.value = '';
        editor.value = false;
        form.value = { id: null, body: '', label: 'none' };
        opener = null;
        load();
    },
    { immediate: true, flush: 'sync' },
);
onUnmounted(() => {
    alive = false;
    loadController?.abort();
    writeController?.abort();
});
</script>

<template>
    <section
        class="memos-panel"
        aria-label="备忘录"
        :aria-busy="loading || busy"
        :data-demo="demoMode"
        :data-protocol="demoData.valid ? demoFixture.protocol : undefined"
        :data-dataset-id="demoData.valid ? demoFixture.datasetId : undefined"
    >
        <header class="memos-heading">
            <h2>备忘录</h2>
            <div class="memos-actions">
                <button
                    type="button"
                    class="memos-button"
                    :disabled="!demoData.valid || !verified || loading || busy"
                    :aria-pressed="demoMode"
                    @click="toggleDemo"
                >
                    测试数据
                </button>
                <button
                    type="button"
                    class="memos-button"
                    aria-label="刷新备忘录"
                    :disabled="loading || busy"
                    @click="load"
                >
                    刷新
                </button>
                <button
                    ref="addButton"
                    type="button"
                    class="memos-button primary"
                    :disabled="busy"
                    @click="edit(null, $event)"
                >
                    ＋ 添加
                </button>
            </div>
        </header>
        <div v-if="error" class="memos-error" role="alert">
            <span>{{ error }}</span>
            <button type="button" class="memos-button" :disabled="loading || busy" @click="load">
                重试备忘录
            </button>
        </div>
        <p v-if="feedback" class="memos-feedback" role="status">{{ feedback }}</p>
        <div v-if="demoMode" class="memos-demo-list">
            <p class="memos-count">共 {{ demoData.items.length }} 条 · 合成测试数据（只读）</p>
            <article
                v-for="memo in demoData.items"
                :key="memo.id"
                class="memos-item memos-demo-item"
                :data-item-id="memo.id"
            >
                <header class="memos-item-heading">
                    <span class="memos-tag" :class="`label-${memo.label}`">{{
                        labels[memo.label]
                    }}</span
                    ><small>{{ memo.author }} · {{ formatDate(Date.parse(memo.updatedAt)) }}</small>
                </header>
                <p class="memos-body">{{ memo.body }}</p>
            </article>
        </div>
        <form
            v-if="editor"
            class="memos-editor"
            @submit.prevent="save"
            @keydown.esc.prevent="!busy && closeEditor()"
        >
            <textarea
                ref="textarea"
                v-model="form.body"
                aria-label="备忘内容"
                maxlength="500"
                required
                :disabled="busy"
                placeholder="填写备忘内容…"
            ></textarea>
            <div class="memos-editor-footer">
                <div class="memos-labels" role="group" aria-label="备忘标签">
                    <button
                        v-for="(label, key) in labels"
                        :key="key"
                        type="button"
                        class="memos-label"
                        :class="[`label-${key}`, { selected: form.label === key }]"
                        :aria-pressed="form.label === key"
                        :disabled="busy"
                        @click="form.label = key"
                    >
                        {{ label }}
                    </button>
                </div>
                <span class="memos-length">{{ form.body.length }} / 500</span>
                <button
                    type="submit"
                    class="memos-button primary"
                    :disabled="busy || !form.body.trim()"
                >
                    {{ form.id ? '更新' : '保存' }}
                </button>
                <button type="button" class="memos-button" :disabled="busy" @click="closeEditor">
                    取消
                </button>
            </div>
        </form>
        <p v-if="loading" class="memos-loading" role="status">正在读取备忘录…</p>
        <p v-if="memos.length" class="memos-count">共 {{ memos.length }} 条</p>
        <div class="memos-list">
            <article
                v-for="memo in memos"
                :key="memo.id"
                class="memos-item"
                :data-memo-id="memo.id"
            >
                <header class="memos-item-heading">
                    <span class="memos-tag" :class="`label-${memo.label}`">{{
                        labels[memo.label]
                    }}</span>
                    <small
                        >{{ memo.author }} ·
                        {{ formatDate(memo.updatedAt || memo.createdAt) }}</small
                    >
                    <div class="memos-item-actions">
                        <button
                            type="button"
                            class="memos-button"
                            :disabled="busy"
                            @click="edit(memo, $event)"
                        >
                            编辑
                        </button>
                        <button
                            type="button"
                            class="memos-button danger"
                            :disabled="busy"
                            @click="remove(memo)"
                        >
                            删除
                        </button>
                    </div>
                </header>
                <p class="memos-body">{{ memo.body }}</p>
            </article>
        </div>
        <p v-if="!loading && !error && !editor && !memos.length && !demoMode" class="memos-empty">
            暂无备忘录，点击“＋ 添加”开始记录
        </p>
    </section>
</template>

<style scoped>
.memos-panel {
    color: #263042;
}
.memos-heading {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    margin-bottom: 16px;
}
.memos-heading h2 {
    font-size: 15px;
    margin: 0;
    font-weight: 700;
}
.memos-actions,
.memos-item-actions {
    display: flex;
    gap: 6px;
}
.memos-button {
    border: 1px solid #e1e5ee;
    border-radius: 7px;
    background: #fff;
    color: #354055;
    padding: 6px 11px;
    min-height: 30px;
    font-size: 11px;
    font-weight: 600;
    cursor: pointer;
}
.memos-button.primary {
    background: #5363ff;
    border-color: #5363ff;
    color: #fff;
}
.memos-button.danger {
    color: #ef4444;
}
.memos-button:disabled,
.memos-label:disabled {
    opacity: 0.5;
    cursor: default;
}
.memos-button:focus-visible,
.memos-label:focus-visible,
.memos-editor textarea:focus-visible {
    outline: 2px solid #6271ff;
    outline-offset: 2px;
}
.memos-empty {
    text-align: center;
    color: #8c95a7;
    padding: 44px 12px;
    margin: 0;
    font-size: 12px;
}
.memos-count,
.memos-loading,
.memos-feedback {
    color: #8490a4;
    margin: 10px 0;
    font-size: 11px;
}
.memos-error {
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: 12px;
    color: #cf3849;
    font-size: 12px;
    margin: 12px 0;
}
.memos-list {
    display: grid;
    gap: 10px;
}
.memos-item,
.memos-editor {
    border: 1px solid #e3e7f0;
    border-radius: 12px;
    background: #fff;
    padding: 14px 16px;
    margin-bottom: 12px;
}
.memos-item-heading {
    display: flex;
    align-items: center;
    gap: 10px;
}
.memos-item-heading small {
    color: #99a2b2;
    font-size: 10px;
}
.memos-item-actions {
    margin-left: auto;
}
.memos-tag,
.memos-label {
    font-size: 10px;
    border-radius: 6px;
    padding: 4px 8px;
    background: #f1f3f8;
    color: #7e899b;
}
.label-important {
    background: #fff4d9;
    color: #b8862a;
}
.label-follow_up {
    background: #eff0ff;
    color: #6561e7;
}
.label-handled {
    background: #eafaef;
    color: #22a171;
}
.memos-body {
    white-space: pre-wrap;
    overflow-wrap: anywhere;
    margin: 12px 0 0;
    font-size: 12px;
    line-height: 1.65;
}
.memos-editor textarea {
    display: block;
    width: 100%;
    min-height: 100px;
    border: 1px solid #e1e5ee;
    border-radius: 7px;
    background: #fff;
    color: inherit;
    padding: 10px;
    font-size: 12px;
    resize: vertical;
}
.memos-editor-footer {
    display: flex;
    align-items: center;
    gap: 7px;
    margin-top: 10px;
}
.memos-labels {
    display: flex;
    gap: 6px;
}
.memos-label {
    border: 1px solid transparent;
    cursor: pointer;
}
.memos-label.selected {
    border-color: #7280ff;
}
.memos-length {
    margin-left: auto;
    color: #99a2b2;
    font-size: 10px;
}
[data-bs-theme='dark'] .memos-panel {
    color: #dbe4f2;
}
[data-bs-theme='dark'] .memos-item,
[data-bs-theme='dark'] .memos-editor,
[data-bs-theme='dark'] .memos-editor textarea,
[data-bs-theme='dark'] .memos-button:not(.primary) {
    background: #1f2938;
    border-color: #344155;
    color: #dbe4f2;
}
[data-bs-theme='dark'] .memos-button.danger {
    color: #ff8a96;
}
[data-bs-theme='dark'] .memos-label,
[data-bs-theme='dark'] .memos-tag {
    background: #2a3547;
    color: #bac5d7;
}
</style>
