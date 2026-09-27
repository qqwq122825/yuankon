<script setup>
import { ref, onMounted, onUnmounted } from 'vue';
import { api, formatDate } from '../api.js';
const props = defineProps({ deviceId: Number });
const frame = ref(null),
    error = ref('');
let timer,
    stopped = false,
    loading = false,
    controller;
async function load() {
    if (loading || stopped) return;
    loading = true;
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
    }
}
onMounted(() => {
    load();
    timer = setInterval(() => {
        if (frame.value && Date.now() >= frame.value.expiresAt) frame.value = null;
        load();
    }, 3000);
});
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
        alt="设备主动上报的单张截图"
        @error="frame = null"
    />
    <p v-else class="empty-state">暂无有效截图，请在手机端确认并发送一张截图。</p>
    <footer class="reader-foot">
        单张上报 · 非实时画面 · 最多暂存 5 分钟
        <span v-if="frame">接收：{{ formatDate(frame.receivedAt) }}</span>
        <button class="btn btn-sm" @click="load">刷新上报截图</button>
    </footer>
</template>
