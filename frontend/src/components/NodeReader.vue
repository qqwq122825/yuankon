<script setup>
import { computed, ref, watch } from 'vue';
import { mutate } from '../api.js';
import DeviceControls from './DeviceControls.vue';

const props = defineProps({
    snapshot: Object,
    controlsDisabled: Boolean,
    dndEnabled: Boolean,
});
const emit = defineEmits(['action', 'text-input']);
const mode = ref('map'),
    scale = ref(55),
    q = ref(''),
    selected = ref(null),
    collapsed = ref(new Set()),
    translated = ref(null),
    useTranslation = ref(false),
    busy = ref(false),
    error = ref('');
const tabs = [
    ['map', '坐标'],
    ['tree', '节点树'],
    ['json', 'JSON'],
];
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
const filtered = computed(() =>
    nodes.value.filter((node) => {
        if (q.value)
            return `${node.class_name} ${node.view_id || ''} ${node.id}`
                .toLowerCase()
                .includes(q.value.toLowerCase());
        let parent = node.parent_id;
        const map = new Map(
            nodes.value
                .filter((item) => item.window === node.window)
                .map((item) => [item.id, item]),
        );
        while (parent) {
            if (collapsed.value.has(`${node.window}:${parent}`)) return false;
            parent = map.get(parent)?.parent_id;
        }
        return true;
    }),
);
const display = computed(() => props.snapshot?.payload?.display || { width: 1, height: 1 });
const windows = computed(() => props.snapshot?.payload?.windows || []);
const diagnostics = computed(() => props.snapshot?.payload?.diagnostics || {});
const packageName = computed(
    () => props.snapshot?.payload?.windows?.find((window) => window.active)?.package || '',
);

watch(
    () => [props.snapshot?.source, props.snapshot?.id],
    ([source], previous) => {
        if (!previous || source !== 'live' || previous[0] !== 'live') {
            selected.value = null;
            translated.value = null;
            useTranslation.value = live.value;
            collapsed.value = new Set();
            mode.value = 'map';
            q.value = '';
            return;
        }
        if (selected.value)
            selected.value = nodes.value.find((node) => node.key === selected.value.key) || null;
    },
    { immediate: true },
);

function label(node) {
    if (live.value && useTranslation.value) return props.snapshot?.labels?.[node.key] || '界面元素';
    if (!live.value && useTranslation.value && translated.value?.[node.key])
        return translated.value[node.key];
    return (
        (!live.value ? props.snapshot?.labels?.[node.key] : '') ||
        node.class_name.split('.').pop() ||
        node.id
    );
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
function toggle(node) {
    const next = new Set(collapsed.value);
    next.has(node.key) ? next.delete(node.key) : next.add(node.key);
    collapsed.value = next;
}
function nodeRecord(node) {
    const { key, ...record } = node;
    return record;
}
async function translate() {
    if (live.value) {
        useTranslation.value = !useTranslation.value;
        return;
    }
    if (useTranslation.value) {
        useTranslation.value = false;
        return;
    }
    busy.value = true;
    error.value = '';
    try {
        if (!translated.value)
            translated.value = (
                await mutate(`/api/snapshots/${props.snapshot.id}/translate`, 'POST')
            ).labels;
        useTranslation.value = true;
    } catch (e) {
        error.value = e.message;
    } finally {
        busy.value = false;
    }
}
function tabKey(event, index) {
    let next;
    if (event.key === 'ArrowRight') next = (index + 1) % tabs.length;
    else if (event.key === 'ArrowLeft') next = (index + tabs.length - 1) % tabs.length;
    else if (event.key === 'Home') next = 0;
    else if (event.key === 'End') next = tabs.length - 1;
    else return;
    event.preventDefault();
    mode.value = tabs[next][0];
    event.currentTarget.parentNode.children[next].focus();
}
</script>

<template>
    <div v-if="snapshot" class="node-reader" :class="{ 'node-reader-live': live }">
        <div class="reader-actions">
            <button
                class="btn btn-sm reader-translate"
                :disabled="busy || !Object.keys(snapshot.labels || {}).length"
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
        <div class="reader-tabs" role="tablist" aria-label="阅读器视图">
            <button
                v-for="([key, tabLabel], index) in tabs"
                :key="key"
                role="tab"
                :aria-selected="mode === key"
                :tabindex="mode === key ? 0 : -1"
                :class="{ active: mode === key }"
                @click="mode = key"
                @keydown="tabKey($event, index)"
            >
                {{ tabLabel }}
            </button>
        </div>
        <input
            v-if="mode !== 'json'"
            v-model="q"
            class="form-control reader-search"
            aria-label="搜索节点"
            placeholder="搜索节点 ID / 类名 / View ID"
        />
        <div v-if="live" class="reader-record-summary">
            <span>{{ windows.length }} 个窗口</span><span>{{ nodes.length }} 个节点</span
            ><strong v-if="diagnostics.truncated">设备遍历已截断</strong
            ><span v-else>本帧结构完整</span>
        </div>
        <div class="reader-body" :style="{ '--reader-size': `${(16 * scale) / 100}px` }">
            <div
                v-if="mode === 'map'"
                class="reader-map-stage"
                :style="{ aspectRatio: `${display.width} / ${display.height}` }"
                role="img"
                aria-label="无障碍节点坐标预览"
            >
                <div
                    v-for="node in filtered"
                    :key="node.key"
                    class="reader-map-node"
                    :class="{ selected: selected?.key === node.key }"
                    :style="nodeStyle(node)"
                    :title="node.class_name"
                    tabindex="0"
                    @click="selected = node"
                    @keydown.enter="selected = node"
                >
                    <span>{{ label(node) }}</span>
                </div>
            </div>
            <div v-else-if="mode === 'tree'">
                <div
                    v-for="node in filtered"
                    :key="node.key"
                    class="reader-node"
                    :style="{ paddingLeft: `${8 + node.depth * 8}px` }"
                >
                    <button
                        v-if="
                            nodes.some((n) => n.window === node.window && n.parent_id === node.id)
                        "
                        class="node-toggle"
                        :aria-label="`折叠或展开 ${node.id}`"
                        :aria-expanded="!collapsed.has(node.key)"
                        @click="toggle(node)"
                    >
                        {{ collapsed.has(node.key) ? '▸' : '▾' }}</button
                    ><button class="node-select" @click="selected = node">
                        <span
                            >{{ label(node) }}<small>{{ node.view_id || node.id }}</small></span
                        >
                    </button>
                </div>
            </div>
            <pre v-else>{{ JSON.stringify(snapshot.payload, null, 2) }}</pre>
            <div v-if="selected && mode !== 'json'" class="reader-properties">
                <strong>节点记录 {{ selected.id }}</strong>
                <pre>{{ JSON.stringify(nodeRecord(selected), null, 2) }}</pre>
            </div>
        </div>
        <div v-if="live" class="reader-record-note">
            完整显示本帧结构字段 · 正文与输入内容未采集
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
                snapshot.source === 'sample'
                    ? '固定合成标签 · 非设备正文'
                    : '仅显示结构和属性 · 正文已剔除'
            }}
        </footer>
    </div>
    <div v-else class="reader-pending" role="status">正在等待设备上报脱敏节点结构…</div>
</template>
