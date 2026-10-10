<script setup>
import { onUnmounted, ref, watch } from 'vue';
import { api } from '../api.js';
import { session } from '../session.js';

const props = defineProps({ deviceId: Number });
const loading = ref(false);
const error = ref('');
const feedback = ref('');
const result = ref(null);
let controller;
let alive = true;
const context = () =>
    JSON.stringify([
        props.deviceId,
        session.user?.id,
        session.user?.role,
        session.user?.projectId,
        session.user?.parentAccountId,
    ]);
function reset() {
    controller?.abort();
    controller = undefined;
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
    feedback.value = '';
    result.value = null;
    try {
        const response = await api(`/api/devices/${deviceId}/ui-preview/gallery`, {
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
            response.section?.id !== 'gallery' ||
            !Array.isArray(response.items) ||
            response.items.length !== 0 ||
            response.total !== 0
        )
            throw new Error('相册预览状态不符合当前约定，请重试。');
        result.value = response;
        if (interactive) feedback.value = '相册功能尚未接入，当前仅刷新预览状态。';
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
        class="gallery-preview"
        aria-label="相册图片"
        :aria-busy="loading"
        :data-state="result?.state || (error ? 'error' : 'loading')"
    >
        <div class="gallery-toolbar">
            <button
                type="button"
                class="gallery-button"
                :disabled="loading"
                title="相册 UI 预览，尚未接入设备相册"
                @click="load(true)"
            >
                <span aria-hidden="true">🖼️</span>获取相册
            </button>
        </div>
        <p
            v-if="error || feedback"
            class="gallery-feedback"
            :class="{ error }"
            :role="error ? 'alert' : 'status'"
        >
            {{ error || feedback }}
        </p>
        <p class="gallery-empty" role="status">
            {{ loading ? '正在读取相册预览状态…' : '暂无相册数据，点击「获取相册」加载' }}
        </p>
    </section>
</template>

<style scoped>
.gallery-preview {
    position: relative;
    min-height: 230px;
    color: var(--lab-ink);
}
.gallery-toolbar {
    display: flex;
    align-items: center;
    min-height: 34px;
}
.gallery-button {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 5px;
    height: 34px;
    border: 1px solid var(--lab-line, #e5e8f0);
    border-radius: 7px;
    padding: 0 13px;
    background: var(--lab-surface, #fff);
    color: var(--lab-ink);
    font-family: inherit;
    font-size: 11px;
    font-weight: 600;
    line-height: 16px;
    white-space: nowrap;
    cursor: pointer;
}
.gallery-button:disabled {
    opacity: 0.55;
    cursor: wait;
}
.gallery-button:focus-visible {
    outline: 2px solid #5364ff;
    outline-offset: 2px;
}
.gallery-empty {
    margin: 0;
    padding: 88px 12px 0;
    color: var(--lab-muted, #9299aa);
    font-size: 11px;
    font-weight: 400;
    line-height: 18px;
    text-align: center;
}
.gallery-feedback {
    position: absolute;
    top: 42px;
    left: 0;
    right: 0;
    margin: 0;
    color: var(--lab-muted, #9299aa);
    font-size: 11px;
    line-height: 18px;
}
.gallery-feedback.error {
    color: #ba4b52;
}
:global([data-bs-theme='dark']) .gallery-feedback.error {
    color: #ffb6be;
}
</style>
