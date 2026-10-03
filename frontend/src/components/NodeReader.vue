<script setup>
import { computed, ref, watch, onMounted, onUnmounted } from 'vue';
import { mutate } from '../api.js';
import { screenshotPoint, readerTapFrame } from '../screenshot-geometry.js';
import DeviceControls from './DeviceControls.vue';

const props = defineProps({
    snapshot: Object,
    latestFrame: Object,
    tapPending: Boolean,
    controlsDisabled: Boolean,
    dndEnabled: Boolean,
});
const emit = defineEmits(['action', 'text-input', 'tap']);
const scale = ref(55),
    selected = ref(null),
    translated = ref(null),
    useTranslation = ref(false),
    busy = ref(false),
    error = ref('');
const clock = ref(Date.now());
let freshnessTimer, pressedSnapshot;
onMounted(() => {
    freshnessTimer = setInterval(() => {
        clock.value = Date.now();
    }, 250);
});
onUnmounted(() => clearInterval(freshnessTimer));
const tapFrameId = computed(() => readerTapFrame(props.snapshot, props.latestFrame, clock.value));
const canTap = computed(() => !!tapFrameId.value && !props.controlsDisabled && !props.tapPending);
function tapMap(event) {
    if (event.button !== 0 || pressedSnapshot !== props.snapshot?.id || !canTap.value) return;
    const frameId = readerTapFrame(props.snapshot, props.latestFrame);
    if (!frameId) return;
    const point = screenshotPoint(
        event.clientX,
        event.clientY,
        event.currentTarget.getBoundingClientRect(),
        display.value.width,
        display.value.height,
    );
    if (point) emit('tap', { ...point, frameId });
}
const live = computed(() => props.snapshot?.source === 'live');
const nodes = computed(() =>
    (props.snapshot?.payload?.windows || []).flatMap((window) =>
        window.nodes.map((node) => ({
            ...node,
            key: `${window.id}:${node.id}`,
            window: window.id,
        })),
    ),
);
const display = computed(() => props.snapshot?.payload?.display || { width: 1, height: 1 });
const diagnostics = computed(() => props.snapshot?.payload?.diagnostics || {});
const packageName = computed(
    () => props.snapshot?.payload?.windows?.find((window) => window.active)?.package || '',
);
const translatableLabels = computed(() =>
    Object.fromEntries(
        nodes.value.map((node) => [node.key, rawText(node)]).filter(([, value]) => value),
    ),
);
const canTranslate = computed(() =>
    live.value
        ? Object.keys(translatableLabels.value).length > 0
        : Object.keys(props.snapshot?.labels || {}).length > 0,
);

watch(
    () => [props.snapshot?.source, props.snapshot?.id],
    ([source], previous) => {
        if (!previous || source !== 'live' || previous[0] !== 'live') {
            selected.value = null;
            translated.value = null;
            useTranslation.value = false;
            return;
        }
        if (selected.value)
            selected.value = nodes.value.find((node) => node.key === selected.value.key) || null;
    },
    { immediate: true },
);

function rawText(node) {
    return [node.text, node.content_description, node.contentDescription]
        .map((value) => (typeof value === 'string' ? value.trim() : ''))
        .find(Boolean);
}
function originalLabel(node) {
    return rawText(node) || (live.value ? '' : node.class_name.split('.').pop() || node.id);
}
function label(node) {
    if (useTranslation.value && translated.value?.[node.key]) return translated.value[node.key];
    if (live.value && useTranslation.value) return props.snapshot?.labels?.[node.key] || '界面元素';
    return originalLabel(node);
}
function nodeStyle(node) {
    const width = display.value.width || 1,
        height = display.value.height || 1,
        left = Math.max(0, Math.min(width, node.bounds[0])),
        top = Math.max(0, Math.min(height, node.bounds[1])),
        right = Math.max(left, Math.min(width, node.bounds[2])),
        bottom = Math.max(top, Math.min(height, node.bounds[3]));
    return {
        left: `${(left / width) * 100}%`,
        top: `${(top / height) * 100}%`,
        width: `${((right - left) / width) * 100}%`,
        height: `${((bottom - top) / height) * 100}%`,
        zIndex: Math.min(40, (node.depth || 0) + 1),
    };
}
function nodeRecord(node) {
    const { key, ...record } = node;
    return record;
}
async function translate() {
    if (useTranslation.value) {
        useTranslation.value = false;
        return;
    }
    busy.value = true;
    error.value = '';
    try {
        if (!translated.value)
            translated.value = live.value
                ? (await mutate('/api/translate', 'POST', { labels: translatableLabels.value }))
                      .labels
                : (await mutate(`/api/snapshots/${props.snapshot.id}/translate`, 'POST')).labels;
        useTranslation.value = true;
    } catch (e) {
        error.value = e.message;
    } finally {
        busy.value = false;
    }
}
</script>

<template>
    <div v-if="snapshot" class="node-reader" :class="{ 'node-reader-live': live }">
        <div class="reader-actions">
            <button
                class="btn btn-sm reader-translate"
                :disabled="busy || !canTranslate"
                @click="translate"
            >
                {{ busy ? '翻译中' : useTranslation ? '原文' : '翻译' }}</button
            ><button
                class="btn btn-sm"
                aria-label="缩小阅读器字号"
                :disabled="scale <= 35"
                @click="scale -= 5"
            >
                A−</button
            ><output>{{ scale }}%</output
            ><button
                class="btn btn-sm"
                aria-label="放大阅读器字号"
                :disabled="scale >= 100"
                @click="scale += 5"
            >
                A＋</button
            ><span v-if="live" class="reader-package" :title="packageName">{{
                packageName || '当前窗口'
            }}</span
            ><RouterLink v-else to="/settings/translation">设置</RouterLink>
        </div>
        <p v-if="error" role="alert" class="reader-error">{{ error }}</p>
        <div v-if="live && diagnostics.truncated" class="reader-record-summary">
            <strong class="reader-summary-status">设备遍历已截断</strong>
        </div>
        <div class="reader-body" :style="{ '--reader-size': `${(16 * scale) / 100}px` }">
            <div
                class="reader-map-stage"
                :class="{ 'reader-tap-enabled': canTap }"
                @pointerdown="pressedSnapshot = snapshot.id"
                @click="tapMap"
                :style="{ aspectRatio: `${display.width} / ${display.height}` }"
                role="img"
                aria-label="无障碍节点坐标预览"
            >
                <div
                    v-for="node in nodes"
                    :key="node.key"
                    class="reader-map-node"
                    :class="{ selected: selected?.key === node.key }"
                    :style="nodeStyle(node)"
                    :title="node.class_name"
                    tabindex="0"
                    @click="selected = node"
                    @keydown.enter="selected = node"
                >
                    <span v-if="label(node)">{{ label(node) }}</span>
                </div>
            </div>
            <div v-if="selected && !live" class="reader-properties">
                <strong>原始节点记录 {{ selected.id }}</strong>
                <pre>{{ JSON.stringify(nodeRecord(selected), null, 2) }}</pre>
            </div>
        </div>
        <DeviceControls
            v-if="live"
            :disabled="controlsDisabled"
            :dnd-enabled="dndEnabled"
            @action="emit('action', $event)"
            @text-input="emit('text-input', $event)"
        />
        <footer v-else class="reader-foot">
            {{
                snapshot.source === 'sample' ? '固定合成标签 · 非设备正文' : '显示已保存的节点字段'
            }}
        </footer>
    </div>
    <div v-else class="node-reader node-reader-live node-reader-pending-shell">
        <div class="reader-pending" role="status">正在等待设备上报节点结构…</div>
        <DeviceControls
            :disabled="controlsDisabled"
            :dnd-enabled="dndEnabled"
            @action="emit('action', $event)"
            @text-input="emit('text-input', $event)"
        />
    </div>
</template>
