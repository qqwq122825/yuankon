<script setup>
import { ref, onMounted, onUnmounted, watch } from 'vue';
import { api } from '../api.js';
const props = defineProps({
    deviceId: Number,
    refreshKey: Number,
    controlsDisabled: Boolean,
    dndEnabled: Boolean,
});
const emit = defineEmits(['count', 'action', 'text-input']);
const actions = [
    ['BACK', '◀', '上一页'],
    ['HOME', '●', 'Home'],
    ['RECENTS', '■', '多任务'],
    ['LOCK', '🔒', '锁屏'],
    ['WAKE', '💡', '点亮'],
];
const frame = ref(null),
    error = ref(''),
    inputText = ref(''),
    stageAspect = ref('9 / 20');
let timer,
    stopped = false,
    loading = false,
    queued = false,
    controller,
    aspectLocked = false;
const seenFrames = new Set();
function sendText() {
    if (props.controlsDisabled || !inputText.value.trim()) return;
    emit('text-input', inputText.value);
    inputText.value = '';
}
async function load() {
    if (stopped) return;
    if (loading) {
        queued = true;
        return;
    }
    loading = true;
    queued = false;
    controller = new AbortController();
    try {
        const result = await api(`/api/devices/${props.deviceId}/screenshot`, {
            signal: controller.signal,
        });
        if (!stopped) {
            const next = result.frame;
            if (next && !seenFrames.has(next.frameId)) {
                seenFrames.add(next.frameId);
                emit('count', seenFrames.size);
            }
            if (
                next &&
                !aspectLocked &&
                Number.isFinite(next.width) &&
                Number.isFinite(next.height) &&
                next.width > 0 &&
                next.height > 0
            ) {
                stageAspect.value = `${next.width} / ${next.height}`;
                aspectLocked = true;
            }
            frame.value = next;
            error.value = '';
        }
    } catch (e) {
        if (!stopped) {
            frame.value = null;
            error.value = e.message;
        }
    } finally {
        loading = false;
        if (queued && !stopped) queueMicrotask(load);
    }
}
onMounted(() => {
    load();
    timer = setInterval(() => {
        if (frame.value && Date.now() >= frame.value.expiresAt) frame.value = null;
        load();
    }, 3000);
});
watch(() => props.refreshKey, load);
onUnmounted(() => {
    stopped = true;
    clearInterval(timer);
    controller?.abort();
    frame.value = null;
});
</script>
<template>
    <div class="device-screenshot-viewer">
        <p v-if="error" role="alert">{{ error }}</p>
        <div class="live-screenshot-stage" :style="{ aspectRatio: stageAspect }">
            <img
                v-if="frame"
                class="live-screenshot-image"
                :src="frame.imageUrl"
                alt="设备实时上报的最新截图"
                @error="frame = null"
            />
            <p v-else class="empty-state">暂无有效截图；正在等待设备响应实时查看请求。</p>
        </div>
        <nav class="capture-action-bar" aria-label="设备快捷操作">
            <button
                v-for="[action, icon, label] in actions"
                :key="action"
                type="button"
                class="capture-action-button"
                :disabled="controlsDisabled"
                :aria-label="label"
                :title="label"
                @click="emit('action', action)"
            >
                {{ icon }}
            </button>
            <button
                type="button"
                class="capture-action-button"
                :class="{ active: dndEnabled }"
                :disabled="controlsDisabled"
                aria-label="切换勿扰"
                title="切换勿扰"
                @click="emit('action', 'DND_TOGGLE')"
            >
                {{ dndEnabled ? '🔔' : '🔕' }}
            </button>
        </nav>
        <form class="capture-text-bar" @submit.prevent="sendText">
            <input
                v-model="inputText"
                type="text"
                maxlength="500"
                :disabled="controlsDisabled"
                aria-label="发送到设备的文本"
                placeholder="输入文本…"
            />
            <button
                type="submit"
                :disabled="controlsDisabled || !inputText.trim()"
                aria-label="发送文本"
            >
                发送
            </button>
        </form>
    </div>
</template>
