<script setup>
import { computed, ref, watch, inject, nextTick } from 'vue';
import { mutate } from '../api.js';
import { screenshotPoint } from '../screenshot-geometry.js';
import { readerNodeStyle } from '../reader-node-style.js';
import DeviceControls from './DeviceControls.vue';

const props = defineProps({
    snapshot: Object,
    latestFrame: Object,
    tapPending: Boolean,
    controlsDisabled: Boolean,
    dndEnabled: Boolean,
});
const emit = defineEmits(['action', 'text-input', 'tap', 'drag', 'touch', 'diagnostic']);
const headerTools = inject('viewerHeaderTools', ref(null));
const mapElement = ref(null);
const mapWidth = ref(300);
watch(mapElement, (element, previous, onCleanup) => {
    if (!element) return;
    const observer = new ResizeObserver(([entry]) => {
        mapWidth.value = entry.contentRect.width;
    });
    observer.observe(element);
    onCleanup(() => observer.disconnect());
});
const scale = ref(55),
    selected = ref(null),
    translated = ref(null),
    useTranslation = ref(false),
    busy = ref(false),
    error = ref('');
let pointerGesture;
const validDisplay = computed(
    () =>
        [display.value.width, display.value.height].every(Number.isFinite) &&
        Math.min(display.value.width, display.value.height) > 0,
);
const canTap = computed(
    () => live.value && validDisplay.value && !props.controlsDisabled && !props.tapPending,
);
function currentFrameId() {
    const frame = props.latestFrame;
    const now = Date.now();
    return typeof frame?.frameId === 'string' &&
        [frame.receivedAt, frame.expiresAt].every(Number.isFinite) &&
        now - frame.receivedAt <= 5000 &&
        frame.expiresAt > now
        ? frame.frameId
        : null;
}
function mapPoint(event) {
    return screenshotPoint(
        event.clientX,
        event.clientY,
        event.currentTarget.getBoundingClientRect(),
        display.value.width,
        display.value.height,
    );
}
function beginMapGesture(event) {
    if (event.button !== 0 || !canTap.value) return;
    const point = mapPoint(event);
    if (!point) return;
    pointerGesture = {
        id: crypto.randomUUID(),
        frameId: currentFrameId(),
        lastMoveAt: 0,
        lastX: event.clientX,
        lastY: event.clientY,
        startedAt: Date.now(),
    };
    event.currentTarget.setPointerCapture?.(event.pointerId);
    emit(
        'touch',
        withCurrentFrame({
            phase: 'down',
            gestureId: pointerGesture.id,
            ...point,
        }),
    );
}
function moveMapGesture(event) {
    if (!pointerGesture || !canTap.value) return;
    const point = mapPoint(event);
    if (!point) return;
    const now = Date.now();
    const distance = Math.hypot(
        event.clientX - pointerGesture.lastX,
        event.clientY - pointerGesture.lastY,
    );
    if (now - pointerGesture.lastMoveAt < 40 && distance < 4) return;
    pointerGesture.lastMoveAt = now;
    pointerGesture.lastX = event.clientX;
    pointerGesture.lastY = event.clientY;
    emit(
        'touch',
        withGestureFrame({
            phase: 'move',
            gestureId: pointerGesture.id,
            ...point,
        }),
    );
}
function finishMapGesture(event) {
    if (!pointerGesture || !canTap.value) {
        pointerGesture = null;
        return;
    }
    const gesture = pointerGesture;
    const point = mapPoint(event);
    if (!point) {
        pointerGesture = null;
        return;
    }
    emit(
        'touch',
        withGestureFrame({
            phase: 'up',
            gestureId: gesture.id,
            durationMs: Math.min(2500, Math.max(50, Date.now() - gesture.startedAt)),
            ...point,
        }),
    );
    pointerGesture = null;
}
function cancelMapGesture() {
    if (pointerGesture) {
        emit(
            'touch',
            withGestureFrame({
                phase: 'cancel',
                gestureId: pointerGesture.id,
            }),
        );
    }
    pointerGesture = null;
}
function withCurrentFrame(payload) {
    const frameId = currentFrameId();
    if (frameId) pointerGesture.frameId = frameId;
    return frameId ? { ...payload, frameId } : payload;
}
function withGestureFrame(payload) {
    const frameId = pointerGesture?.frameId || currentFrameId();
    return frameId ? { ...payload, frameId } : payload;
}
const live = computed(() => props.snapshot?.source === 'live');
const nodes = computed(() =>
    (props.snapshot?.payload?.windows || []).flatMap((window) => materializeWindowNodes(window)),
);
const display = computed(() => props.snapshot?.payload?.display || { width: 1, height: 1 });
const drawableNodes = computed(() =>
    nodes.value.filter((node) => {
        const [left, top, right, bottom] = node.bounds;
        return (
            node.geometry_status !== 'invalid' &&
            Math.min(display.value.width, right) > Math.max(0, left) &&
            Math.min(display.value.height, bottom) > Math.max(0, top)
        );
    }),
);
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

watch(
    () => props.snapshot?.id,
    async (id, previous, onCleanup) => {
        let cancelled = false;
        onCleanup(() => {
            cancelled = true;
        });
        await nextTick();
        if (cancelled || !live.value || !mapElement.value) return;
        const painted = Array.from(mapElement.value.querySelectorAll('.reader-map-node'));
        emit('diagnostic', {
            stage: 'nodes_rendered',
            snapshotId: id,
            receivedNodeCount: nodes.value.length,
            renderedNodeCount: painted.length,
            nodeKeys: painted.slice(0, 200).map((element) => element.dataset.nodeKey),
            nodeKeysTruncated: painted.length > 200,
            zeroAreaNodeCount: nodes.value.filter(
                (node) => node.bounds[2] <= node.bounds[0] || node.bounds[3] <= node.bounds[1],
            ).length,
        });
    },
    { immediate: true },
);

function rawText(node) {
    return [node.text, node.content_description, node.contentDescription]
        .map((value) => (typeof value === 'string' ? value.trim() : ''))
        .find(Boolean);
}
function materializeWindowNodes(window) {
    const uploaded = (window.nodes || []).map((node) => ({
        ...node,
        key: `${window.id}:${node.id}`,
        window: window.id,
    }));
    const visible = uploaded.filter((node) => !isInactiveUploadedPatternDot(node));
    return [...visible, ...syntheticPatternDots(window, uploaded)];
}
function isInactiveUploadedPatternDot(node) {
    return isPatternDot(node) && node.flags?.clickable !== false;
}
function syntheticPatternDots(window, base) {
    const generated = [];
    for (const root of base.filter(isPatternViewRoot)) {
        const existing = new Set(
            base
                .filter(
                    (node) =>
                        node.parent_id === root.id &&
                        isPatternDot(node) &&
                        node.flags?.clickable === false,
                )
                .map((node) => patternDotNumber(node)),
        );
        if (existing.size >= 9) continue;
        const [left, top, right, bottom] = root.bounds || [];
        if (![left, top, right, bottom].every(Number.isFinite) || right <= left || bottom <= top)
            continue;
        const width = right - left;
        const height = bottom - top;
        const side = Math.min(width, height);
        const cell = side / 3;
        const dot = Math.max(24, Math.round(cell * 0.6));
        const originX = left + (width - side) / 2;
        const originY = top + (height - side) / 2;
        for (let number = 1; number <= 9; number += 1) {
            if (existing.has(String(number))) continue;
            const column = (number - 1) % 3;
            const row = Math.floor((number - 1) / 3);
            const centerX = originX + cell * (column + 0.5);
            const centerY = originY + cell * (row + 0.5);
            generated.push({
                id: `${root.id}:synthetic-pattern-${number}`,
                parent_id: root.id,
                class_name: 'android.view.View',
                view_id: null,
                bounds: [
                    Math.round(centerX - dot / 2),
                    Math.round(centerY - dot / 2),
                    Math.round(centerX + dot / 2),
                    Math.round(centerY + dot / 2),
                ],
                flags: {
                    visible: true,
                    enabled: true,
                    clickable: true,
                    scrollable: false,
                    editable: false,
                    password: false,
                    sensitive: false,
                    focused: false,
                },
                text_present: true,
                depth: (root.depth || 0) + 1,
                geometry_status: 'valid',
                text: `已添加圆点 ${number}`,
                content_description: `已添加圆点 ${number}`,
                text_policy: 'synthetic',
                synthetic: true,
                key: `${window.id}:${root.id}:synthetic-pattern-${number}`,
                window: window.id,
            });
        }
    }
    return generated;
}
function isPatternViewRoot(node) {
    return /(^|:)lockPatternView$/i.test(node.view_id || '');
}
function originalLabel(node) {
    return rawText(node) || (live.value ? '' : node.class_name.split('.').pop() || node.id);
}
function label(node) {
    if (useTranslation.value && translated.value?.[node.key]) return translated.value[node.key];
    if (live.value && useTranslation.value) return props.snapshot?.labels?.[node.key] || '界面元素';
    return originalLabel(node);
}
function nodeIcon(node) {
    const text = rawText(node),
        view = node.view_id || '',
        klass = node.class_name || '';
    if (
        /ImageView$/.test(klass) &&
        (/lock/i.test(view) || /锁|locked/i.test(text) || /keyguard/i.test(view))
    )
        return '🔒';
    return '';
}
function patternDotNumber(node) {
    const match = (rawText(node) || '').match(/^已添加圆点\s*(\d+)$/);
    return match?.[1] || '';
}
function isPatternDot(node) {
    return Boolean(patternDotNumber(node));
}
function isActivePatternDot(node) {
    return isPatternDot(node) && !node.flags?.clickable;
}
function displayLabel(node) {
    return patternDotNumber(node) || label(node);
}
function isActionNode(node) {
    if (isPatternDot(node)) return false;
    const flags = node.flags || {};
    const klass = node.class_name || '';
    return Boolean(
        /Button$/.test(klass) ||
        (flags.clickable &&
            (rawText(node) ||
                /ImageButton$/.test(klass) ||
                /button|icon|key/i.test(node.view_id || ''))),
    );
}
function isSensitiveNode(node) {
    const flags = node.flags || {};
    return Boolean(flags.password || flags.sensitive || flags.editable);
}
function nodeClasses(node) {
    return {
        selected: selected.value?.key === node.key,
        'reader-map-node-action': isActionNode(node),
        'reader-map-node-sensitive': isSensitiveNode(node),
        'reader-map-node-pattern': isPatternDot(node),
        'reader-map-node-pattern-active': isActivePatternDot(node),
    };
}
function nodeStyle(node) {
    const icon = nodeIcon(node);
    return readerNodeStyle(
        node,
        display.value,
        mapWidth.value,
        scale.value,
        icon || displayLabel(node) || '',
        { icon: Boolean(icon) },
    );
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
        <Teleport :to="headerTools || 'body'" :disabled="!live || !headerTools">
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
                ><span v-if="live && !headerTools" class="reader-package" :title="packageName">{{
                    packageName || '当前窗口'
                }}</span
                ><RouterLink v-else-if="!live" to="/settings/translation">设置</RouterLink>
            </div>
        </Teleport>
        <p v-if="error" role="alert" class="reader-error">{{ error }}</p>
        <div v-if="live && diagnostics.truncated" class="reader-record-summary">
            <strong class="reader-summary-status">设备遍历已截断</strong>
        </div>
        <div class="reader-body" :style="{ '--reader-size': `${(16 * scale) / 100}px` }">
            <div
                ref="mapElement"
                class="reader-map-stage"
                :class="{ 'reader-tap-enabled': canTap }"
                @pointerdown="beginMapGesture"
                @pointermove="moveMapGesture"
                @pointerup="finishMapGesture"
                @pointercancel="cancelMapGesture"
                :style="{ aspectRatio: `${display.width} / ${display.height}` }"
                role="img"
                aria-label="无障碍节点坐标预览"
            >
                <div
                    v-for="node in drawableNodes"
                    :key="node.key"
                    :data-node-key="node.key"
                    class="reader-map-node"
                    :class="nodeClasses(node)"
                    :style="nodeStyle(node)"
                    :title="displayLabel(node) || node.class_name"
                    tabindex="0"
                    @click="selected = node"
                    @keydown.enter="selected = node"
                >
                    <span v-if="nodeIcon(node)" class="reader-node-icon" aria-hidden="true">{{
                        nodeIcon(node)
                    }}</span>
                    <span v-else-if="displayLabel(node)">{{ displayLabel(node) }}</span>
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
