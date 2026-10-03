<script setup>
import { ref, onMounted, onUnmounted, watch, nextTick } from 'vue';
import { api } from '../api.js';
import DeviceControls from './DeviceControls.vue';
import { screenshotPoint } from '../screenshot-geometry.js';
const props = defineProps({
    deviceId: Number,
    refreshKey: Number,
    controlsDisabled: Boolean,
    dndEnabled: Boolean,
    tapPending: Boolean,
    latestFrame: Object,
});
const emit = defineEmits(['count', 'action', 'text-input', 'tap', 'diagnostic']);
const frame = ref(null),
    error = ref(''),
    stageAspect = ref(null),
    imageLoaded = ref(false);
let timer,
    stopped = false,
    loading = false,
    queued = false,
    controller,
    pressedFrameId,
    loadGeneration = 0,
    imageController,
    downloading = false,
    pendingFrame = null,
    lastLiveAt = 0,
    displayedUrl;
const seenFrames = new Set();
function acceptFrame(next) {
    if (next && !seenFrames.has(next.frameId)) {
        seenFrames.add(next.frameId);
        emit('count', seenFrames.size);
    }
    if (
        next &&
        Number.isFinite(next.width) &&
        Number.isFinite(next.height) &&
        next.width > 0 &&
        next.height > 0
    ) {
        stageAspect.value = `${next.width} / ${next.height}`;
    }
    if (frame.value?.frameId !== next?.frameId) imageLoaded.value = false;
    frame.value = next;
    error.value = '';
}
function acceptLiveFrame(next) {
    if (!next || stopped) return;
    if (
        !Number.isFinite(next.width) ||
        !Number.isFinite(next.height) ||
        next.width <= 0 ||
        next.height <= 0 ||
        typeof next.frameId !== 'string' ||
        typeof next.imageUrl !== 'string' ||
        !next.imageUrl.startsWith(`/api/devices/${props.deviceId}/screenshot/`) ||
        !Number.isFinite(next.expiresAt) ||
        next.expiresAt <= Date.now()
    )
        return;
    lastLiveAt = Date.now();
    loadGeneration++;
    controller?.abort();
    queued = false;
    pendingFrame = next;
    downloadLatest();
}
async function downloadLatest() {
    if (stopped || downloading || !pendingFrame) return;
    const next = pendingFrame;
    pendingFrame = null;
    if (next.frameId === frame.value?.frameId) return;
    downloading = true;
    imageController = new AbortController();
    const downloadStarted = performance.now();
    try {
        const response = await fetch(next.imageUrl, {
            credentials: 'same-origin',
            signal: imageController.signal,
        });
        if (!response.ok || !response.headers.get('content-type')?.startsWith('image/jpeg'))
            throw new Error('截图已被替换，等待下一帧');
        const blob = await response.blob();
        emit('diagnostic', {
            stage: 'image_downloaded',
            frameId: next.frameId,
            elapsedMs: Math.round(performance.now() - downloadStarted),
            bytes: blob.size,
        });
        if (!stopped) {
            const url = URL.createObjectURL(blob);
            const decodingStarted = performance.now();
            const decoded = new Image();
            decoded.src = url;
            try {
                await decoded.decode();
                if (decoded.naturalWidth !== next.width || decoded.naturalHeight !== next.height)
                    throw new Error('截图尺寸不匹配');
            } catch (e) {
                URL.revokeObjectURL(url);
                throw e;
            }
            if (stopped || next.expiresAt <= Date.now()) {
                URL.revokeObjectURL(url);
                return;
            }
            const oldUrl = displayedUrl;
            displayedUrl = url;
            acceptFrame({ ...next, imageUrl: url });
            emit('diagnostic', {
                stage: 'image_decoded',
                frameId: next.frameId,
                elapsedMs: Math.round(performance.now() - decodingStarted),
            });
            await nextTick();
            if (oldUrl) URL.revokeObjectURL(oldUrl);
        }
    } catch (e) {
        if (!stopped && e.name !== 'AbortError') {
            error.value = e.message;
            emit('diagnostic', {
                stage: 'image_failed',
                frameId: next.frameId,
                message: e.message,
            });
        }
    } finally {
        downloading = false;
        if (!stopped && pendingFrame) queueMicrotask(downloadLatest);
    }
}
watch(() => props.latestFrame, acceptLiveFrame, { immediate: true });
async function load() {
    if (stopped) return;
    if (loading) {
        queued = true;
        return;
    }
    const generation = ++loadGeneration;
    loading = true;
    queued = false;
    controller = new AbortController();
    try {
        const result = await api(`/api/devices/${props.deviceId}/screenshot`, {
            signal: controller.signal,
        });
        if (!stopped && generation === loadGeneration) {
            if (result.frame) acceptLiveFrame(result.frame);
        }
    } catch (e) {
        if (!stopped && generation === loadGeneration && e.name !== 'AbortError') {
            error.value = e.message;
        }
    } finally {
        loading = false;
        if (queued && !stopped) queueMicrotask(load);
    }
}
function tap(event) {
    if (
        event.button !== 0 ||
        pressedFrameId !== frame.value?.frameId ||
        props.controlsDisabled ||
        props.tapPending ||
        !imageLoaded.value ||
        !frame.value ||
        Date.now() >= frame.value.expiresAt
    )
        return;
    const point = screenshotPoint(
        event.clientX,
        event.clientY,
        event.currentTarget.getBoundingClientRect(),
        frame.value.width,
        frame.value.height,
    );
    if (point) emit('tap', { ...point, frameId: frame.value.frameId });
}
onMounted(() => {
    if (!frame.value) load();
    timer = setInterval(() => {
        if (frame.value && Date.now() >= frame.value.expiresAt) frame.value = null;
        if (Date.now() - lastLiveAt >= 3000) load();
    }, 3000);
});
watch(
    () => props.refreshKey,
    () => {
        if (!props.latestFrame) load();
    },
);
onUnmounted(() => {
    stopped = true;
    clearInterval(timer);
    controller?.abort();
    imageController?.abort();
    pendingFrame = null;
    if (displayedUrl) URL.revokeObjectURL(displayedUrl);
    frame.value = null;
});
</script>
<template>
    <div class="device-screenshot-viewer">
        <p v-if="error" role="alert">{{ error }}</p>
        <div
            class="live-screenshot-stage"
            :class="{ 'live-screenshot-waiting': !stageAspect }"
            :style="{ aspectRatio: stageAspect }"
        >
            <img
                v-if="frame"
                class="live-screenshot-image"
                :src="frame.imageUrl"
                :data-frame-id="frame.frameId"
                @pointerdown="pressedFrameId = frame.frameId"
                :class="{ 'tap-enabled': imageLoaded && !controlsDisabled && !tapPending }"
                :title="'设备截图：单击发送到手机，需手机点击运行操作'"
                draggable="false"
                @load="imageLoaded = $event.currentTarget.dataset.frameId === frame?.frameId"
                @click.stop="tap"
                alt="设备实时上报的最新截图"
                @error="error = '图片显示失败，等待下一帧'"
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
