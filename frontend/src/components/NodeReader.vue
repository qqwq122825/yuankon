<script setup>
import { computed, ref, watch } from 'vue';
import { mutate } from '../api.js';
const props = defineProps({ snapshot: Object });
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
const nodes = computed(() =>
    props.snapshot.payload.windows.flatMap((w) =>
        w.nodes.map((n) => ({ ...n, key: `${w.id}:${n.id}`, window: w.id })),
    ),
);
const filtered = computed(() =>
    nodes.value.filter((n) => {
        if (q.value)
            return `${n.class_name} ${n.view_id || ''} ${n.id}`
                .toLowerCase()
                .includes(q.value.toLowerCase());
        let parent = n.parent_id;
        const map = new Map(nodes.value.filter((x) => x.window === n.window).map((x) => [x.id, x]));
        while (parent) {
            if (collapsed.value.has(`${n.window}:${parent}`)) return false;
            parent = map.get(parent)?.parent_id;
        }
        return true;
    }),
);
watch(
    () => props.snapshot.id,
    () => {
        selected.value = null;
        translated.value = null;
        useTranslation.value = false;
        collapsed.value = new Set();
    },
);
function label(node) {
    return (
        (useTranslation.value ? translated.value : props.snapshot.labels)?.[node.key] ||
        node.class_name.split('.').pop()
    );
}
function toggle(node) {
    const next = new Set(collapsed.value);
    next.has(node.key) ? next.delete(node.key) : next.add(node.key);
    collapsed.value = next;
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
    <div class="reader-actions">
        <button
            class="btn btn-sm"
            :disabled="busy || !Object.keys(snapshot.labels).length"
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
        ><RouterLink to="/settings/translation">设置</RouterLink>
    </div>
    <p v-if="error" role="alert" class="reader-error">{{ error }}</p>
    <div class="reader-tabs" role="tablist" aria-label="阅读器视图">
        <button
            v-for="([key, label], index) in tabs"
            :key="key"
            role="tab"
            :aria-selected="mode === key"
            :tabindex="mode === key ? 0 : -1"
            :class="{ active: mode === key }"
            @click="mode = key"
            @keydown="tabKey($event, index)"
        >
            {{ label }}
        </button>
    </div>
    <input
        v-if="mode !== 'json'"
        v-model="q"
        class="form-control reader-search"
        aria-label="搜索节点"
        placeholder="搜索节点 ID / 类名"
    />
    <div class="reader-body" :style="{ '--reader-size': `${(16 * scale) / 100}px` }">
        <svg
            v-if="mode === 'map'"
            class="reader-map"
            :viewBox="`0 0 ${snapshot.payload.display.width} ${snapshot.payload.display.height}`"
            role="img"
            aria-label="只读节点坐标映射"
        >
            <rect width="100%" height="100%" fill="var(--lab-surface)" />
            <g
                v-for="node in filtered"
                :key="node.key"
                tabindex="0"
                role="button"
                :aria-label="`节点 ${node.id}`"
                @click="selected = node"
                @keydown.enter="selected = node"
            >
                <rect
                    :x="node.bounds[0]"
                    :y="node.bounds[1]"
                    :width="node.bounds[2] - node.bounds[0]"
                    :height="node.bounds[3] - node.bounds[1]"
                    :fill="selected?.key === node.key ? '#6975ec33' : 'transparent'"
                    stroke="#858fe1"
                    stroke-width="0.6"
                />
                <text
                    v-if="node.text_present"
                    :x="node.bounds[0] + 3"
                    :y="node.bounds[1] + 12"
                    :font-size="(16 * scale) / 100"
                    fill="var(--lab-ink)"
                >
                    {{ label(node) }}
                </text>
            </g>
        </svg>
        <div v-else-if="mode === 'tree'">
            <div
                v-for="node in filtered"
                :key="node.key"
                class="reader-node"
                :style="{ paddingLeft: `${8 + node.depth * 8}px` }"
            >
                <button
                    v-if="nodes.some((n) => n.window === node.window && n.parent_id === node.id)"
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
            <strong>{{ selected.id }}</strong>
            <pre>{{
                JSON.stringify(
                    {
                        class: selected.class_name,
                        bounds: selected.bounds,
                        flags: selected.flags,
                        text_policy: selected.text_policy,
                    },
                    null,
                    2,
                )
            }}</pre>
        </div>
    </div>
    <footer class="reader-foot">
        {{
            snapshot.source === 'sample'
                ? '固定合成标签 · 非设备正文'
                : '仅显示结构和属性 · 正文已剔除'
        }}
    </footer>
</template>
