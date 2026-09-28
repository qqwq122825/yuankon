<script setup>
import { ref, onMounted, onUnmounted, watch } from 'vue';
import { api, formatDate } from '../api.js';
const props = defineProps({
    deviceId: Number,
    refreshKey: Number,
    status: String,
    toast: String,
    toastTone: String,
    controlsDisabled: Boolean,
    dndEnabled: Boolean,
});
const emit = defineEmits(['count', 'action']);
const actions = [
    ['BACK', '◀', '上一页'],
    ['HOME', '●', 'Home'],
    ['RECENTS', '■', '多任务'],
    ['LOCK', '🔒', '锁屏'],
    ['WAKE', '💡', '点亮'],
];
const frame = ref(null),
    error = ref(''),
    stageAspect = ref('9 / 16');
let timer,
    stopped = false,
    loading = false,
    queued = false,
    controller,
    aspectLocked = false;
const seenFrames = new Set();
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
        <div
            v-if="toast"
            role="status"
            class="viewer-action-toast"
            :class="toastTone === 'error' ? 'error' : 'success'"
        >
            {{ toast }}
        </div>
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
        <p v-if="status" role="status" class="viewer-capture-status">{{ status }}</p>
        <footer class="reader-foot">
            实时最新帧 · 关闭窗口即停止 · 最多暂存 5 分钟
            <span v-if="frame">接收：{{ formatDate(frame.receivedAt) }}</span>
            <button class="btn btn-sm" @click="load">刷新上报截图</button>
        </footer>
    </div>
</template>
