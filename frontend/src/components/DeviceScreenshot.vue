<script setup>
import { ref, onMounted, onUnmounted, watch } from 'vue';
import { api, formatDate } from '../api.js';
const props = defineProps({ deviceId: Number, refreshKey: Number, status: String });
const frame = ref(null),
    error = ref('');
let timer,
    stopped = false,
    loading = false,
    queued = false,
    controller;
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
            frame.value = result.frame;
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
    <p v-if="error" role="alert">{{ error }}</p>
    <img
        v-if="frame"
        class="snapshot-image"
        :src="frame.imageUrl"
        alt="设备实时上报的最新截图"
        @error="frame = null"
    />
    <p v-else class="empty-state">暂无有效截图；正在等待设备响应实时查看请求。</p>
    <p v-if="status" role="status" class="viewer-capture-status">{{ status }}</p>
    <footer class="reader-foot">
        实时最新帧 · 关闭窗口即停止 · 最多暂存 5 分钟
        <span v-if="frame">接收：{{ formatDate(frame.receivedAt) }}</span>
        <button class="btn btn-sm" @click="load">刷新上报截图</button>
    </footer>
</template>
