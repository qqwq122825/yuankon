<script setup>
import { ref, onMounted, onUnmounted, watch } from 'vue';
import { api } from '../api.js';
import DeviceControls from './DeviceControls.vue';
const props = defineProps({
    deviceId: Number,
    refreshKey: Number,
    controlsDisabled: Boolean,
    dndEnabled: Boolean,
});
const emit = defineEmits(['count', 'action', 'text-input']);
const frame = ref(null),
    error = ref(''),
    stageAspect = ref('9 / 19.5');
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
        <div class="live-screenshot-stage" :style="{ aspectRatio: stageAspect }">
            <img
                v-if="frame"
                class="live-screenshot-image"
                :src="frame.imageUrl"
                alt="设备实时上报的最新截图"
                @error="frame = null"
            />
            <p v-else class="empty-state" role="status">
                暂无有效截图；正在等待设备响应实时查看请求。
            </p>
        </div>
        <DeviceControls
            :disabled="controlsDisabled"
            :dnd-enabled="dndEnabled"
            placeholder="输入文本…"
            @action="emit('action', $event)"
            @text-input="emit('text-input', $event)"
        />
    </div>
</template>
