<script setup>
import { computed } from 'vue';
import { useDeviceDemoPreview } from '../composables/useDeviceDemoPreview.js';
import fixture from '../fixtures/device-gallery-demo.json';
import { readGalleryDemo } from '../fixtures/device-fixture-protocol.js';
import landscapeUrl from '../../public/demo/gallery-landscape.svg?url&no-inline';
import geometryUrl from '../../public/demo/gallery-geometry.svg?url&no-inline';
const props = defineProps({ deviceId: Number, deviceSource: { type: String, default: '' } });
const {
    demoMode: requestedDemoMode,
    loading,
    error,
    ready,
    feedback,
    toggleDemo,
    refresh,
} = useDeviceDemoPreview(props, 'gallery', { defaultSample: false });
const demoData = readGalleryDemo(fixture);
const demoMode = computed(() => demoData.valid && requestedDemoMode.value);
const items = computed(() => (demoMode.value ? demoData.items : []));
const assets = { landscape: landscapeUrl, geometry: geometryUrl };
const displayError = computed(() =>
    error.value === '预览状态不符合当前约定，请重试。'
        ? '相册预览状态不符合当前约定，请重试。'
        : error.value,
);
</script>

<template>
    <section
        class="gallery-preview"
        aria-label="相册图片"
        :aria-busy="loading"
        :data-state="ready ? 'not_connected' : error ? 'error' : 'loading'"
        :data-demo="demoMode"
        :data-protocol="demoData.valid ? fixture.protocol : undefined"
        :data-dataset-id="demoData.valid ? fixture.datasetId : undefined"
    >
        <div class="gallery-toolbar">
            <button
                type="button"
                class="gallery-button"
                :disabled="loading"
                title="相册 UI 预览，尚未接入设备相册"
                @click="refresh"
            >
                <span aria-hidden="true">🖼️</span>获取相册
            </button>
            <button
                type="button"
                class="gallery-button"
                :disabled="!ready || !demoData.valid"
                :aria-pressed="demoMode"
                @click="toggleDemo"
            >
                测试数据
            </button>
        </div>
        <p
            v-if="displayError || feedback"
            class="gallery-feedback"
            :class="{ error }"
            :role="error ? 'alert' : 'status'"
        >
            {{ displayError || (feedback ? '相册功能尚未接入，当前仅刷新预览状态。' : '') }}
        </p>
        <p v-if="!items.length" class="gallery-empty" role="status">
            {{ loading ? '正在读取相册预览状态…' : '暂无相册数据，点击「获取相册」加载' }}
        </p>
        <template v-if="items.length">
            <p class="gallery-count">共 {{ items.length }} 张 · 合成测试数据</p>
            <div class="gallery-grid">
                <figure
                    v-for="item in items"
                    :key="item.id"
                    class="gallery-item"
                    :data-item-id="item.id"
                >
                    <img
                        :src="assets[item.assetId]"
                        :alt="item.title + ' · 合成图片'"
                        :width="item.width"
                        :height="item.height"
                    />
                    <figcaption>{{ item.title }} · {{ item.width }} × {{ item.height }}</figcaption>
                </figure>
            </div>
        </template>
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
    gap: 8px;
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
[data-bs-theme='dark'] .gallery-feedback.error {
    color: #ffb6be;
}
.gallery-count {
    margin: 16px 0 10px;
    color: var(--lab-muted);
    font-size: 11px;
}
.gallery-grid {
    display: grid;
    grid-template-columns: repeat(2, 240px);
    gap: 12px;
}
.gallery-item {
    margin: 0;
    border: 1px solid var(--lab-line);
    border-radius: 12px;
    overflow: hidden;
    background: var(--lab-surface);
}
.gallery-item img {
    display: block;
    width: 100%;
    height: auto;
}
.gallery-item figcaption {
    padding: 9px 12px;
    font-size: 11px;
}
</style>
