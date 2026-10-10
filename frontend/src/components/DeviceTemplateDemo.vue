<script setup>
import { ref, useId, watch } from 'vue';

const props = defineProps({
    applications: { type: Array, default: () => [] },
});
const instanceId = useId();
const applications = ref([]);
const feedback = ref('');
let originals = [];

// Fixture state belongs to this component; no device record or parent object is changed.
function copyApplication(item, index) {
    return {
        id: String(item.id ?? `demo-${index + 1}`),
        name: String(item.name ?? `测试应用 ${index + 1}`),
        initial: String(item.initial ?? 'D').slice(0, 2),
        packageName: String(item.packageName ?? ''),
        status: item.status === 'submitted' ? 'submitted' : 'ready',
        time: String(item.time ?? '—'),
        fields: (Array.isArray(item.fields) ? item.fields : []).map((field) => ({
            label: String(field.label ?? '测试字段'),
            value: String(field.value ?? 'DEMO-EMPTY'),
        })),
        skip: Boolean(item.skip),
        expanded: item.status === 'submitted',
    };
}
function resetAll() {
    applications.value = originals.map(copyApplication);
    feedback.value = '已恢复全部合成示例；未下发设备指令。';
}
function resetApplication(index) {
    applications.value[index] = copyApplication(originals[index], index);
    feedback.value = `已恢复「${applications.value[index].name}」的本地示例。`;
}
function openApplication(item) {
    item.expanded = true;
    feedback.value = `已展开「${item.name}」的合成详情；未启动外部应用。`;
}
function changeSkip(item) {
    feedback.value = `「${item.name}」${item.skip ? '已跳过' : '已取消跳过'}本地示例；未下发设备指令。`;
}
watch(
    () => props.applications,
    (items) => {
        originals = items.map(copyApplication);
        applications.value = originals.map(copyApplication);
        feedback.value = '';
    },
    { deep: true, immediate: true },
);
defineExpose({ resetAll });
</script>

<template>
    <section class="template-demo" aria-label="合成模板快捷预览">
        <p class="template-demo-notice">合成测试数据 · 非设备记录</p>
        <div class="template-demo-body">
            <article
                v-for="(item, index) in applications"
                :key="item.id"
                class="template-demo-card"
                :class="{ 'is-submitted': item.status === 'submitted' }"
                :data-demo-app="item.id"
            >
                <div class="template-demo-app">
                    <span class="template-demo-icon" aria-hidden="true">{{ item.initial }}</span>
                    <div class="template-demo-identity">
                        <strong>{{ item.name }}</strong>
                        <div class="template-demo-state">
                            <span class="template-demo-badge">
                                {{ item.status === 'submitted' ? '已提交 (示例)' : '就绪 (示例)' }}
                            </span>
                            <time v-if="!item.expanded">{{ item.time }}</time>
                        </div>
                    </div>
                    <div class="template-demo-controls">
                        <label class="template-demo-skip">
                            <input
                                v-model="item.skip"
                                type="checkbox"
                                :aria-label="`跳过 ${item.name} 本地示例`"
                                @change="changeSkip(item)"
                            />
                            <span>跳过</span>
                        </label>
                        <button
                            type="button"
                            class="template-demo-open"
                            :aria-label="`打开 ${item.name} 合成详情`"
                            :aria-expanded="item.expanded"
                            :aria-controls="`${instanceId}-details-${index}`"
                            @click="openApplication(item)"
                        >
                            打开
                        </button>
                        <button
                            type="button"
                            class="template-demo-reset"
                            :aria-label="`重置 ${item.name} 本地预览`"
                            @click="resetApplication(index)"
                        >
                            重置预览
                        </button>
                    </div>
                </div>
                <div
                    v-if="item.expanded"
                    :id="`${instanceId}-details-${index}`"
                    class="template-demo-details"
                >
                    <strong class="template-demo-details-title">模板内容 (示例)</strong>
                    <div class="template-demo-details-meta">
                        <span>合成表单</span><time>{{ item.time }}</time>
                    </div>
                    <dl class="template-demo-fields">
                        <div v-for="(field, fieldIndex) in item.fields" :key="fieldIndex">
                            <dt>{{ field.label }}：</dt>
                            <dd>{{ field.value }}</dd>
                        </div>
                    </dl>
                    <p v-if="item.packageName" class="template-demo-package">
                        {{ item.packageName }}
                    </p>
                    <p v-if="!item.fields.length" class="template-demo-empty-fields">
                        此合成示例没有表单字段。
                    </p>
                </div>
            </article>
            <p v-if="!applications.length" class="template-demo-empty">暂无合成模板示例</p>
        </div>
        <footer class="template-demo-footer">
            <p>跳过 / 打开 / 重置仅影响本地预览</p>
            <p v-if="feedback" class="template-demo-feedback" role="status">{{ feedback }}</p>
        </footer>
    </section>
</template>

<style scoped>
.template-demo {
    --demo-violet: #8a5cff;
    --demo-green: #009b70;
    --demo-muted: #98a1b3;
    --demo-gray-bg: #f2f3f8;
    --demo-green-bg: #f3faf7;
    --demo-inset-bg: #edf8f3;
    --demo-green-line: #d3eee3;
    --demo-icon-bg: #e9ecf3;
    display: flex;
    min-width: 0;
    min-height: 0;
    flex: 1 1 auto;
    flex-direction: column;
    color: var(--lab-ink, #252c3c);
    font-size: 10px;
    line-height: 1.5;
}
.template-demo-notice {
    flex: 0 0 auto;
    margin: 0;
    padding: 6px 10px;
    border-bottom: 1px solid var(--lab-line, #dfe3ec);
    color: var(--demo-muted);
    font-size: 9px;
}
.template-demo-body {
    display: grid;
    min-height: 0;
    max-height: 300px;
    flex: 1 1 auto;
    align-content: start;
    gap: 7px;
    overflow-y: auto;
    overscroll-behavior: contain;
    padding: 8px;
    scrollbar-width: thin;
    scrollbar-color: #cfd5e3 transparent;
}
.template-demo-card {
    min-width: 0;
    padding: 9px;
    border: 1px solid var(--lab-line, #dfe3ec);
    border-radius: 12px;
    background: var(--demo-gray-bg);
}
.template-demo-card.is-submitted {
    border-color: var(--demo-green-line);
    background: var(--demo-green-bg);
}
.template-demo-app {
    display: flex;
    min-width: 0;
    align-items: center;
    gap: 8px;
}
.template-demo-icon {
    display: grid;
    width: 31px;
    height: 34px;
    flex-shrink: 0;
    place-items: center;
    border: 1px solid var(--lab-line, #dfe3ec);
    border-radius: 10px;
    background: var(--demo-icon-bg);
    box-shadow: 0 2px 3px #19283f08;
    color: var(--demo-muted);
    font-size: 15px;
    font-weight: 700;
}
.template-demo-identity {
    min-width: 0;
    flex: 1;
}
.template-demo-identity > strong {
    display: block;
    overflow-wrap: anywhere;
    font-size: 12px;
    font-weight: 650;
    line-height: 1.25;
}
.template-demo-state {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 3px;
    margin-top: 4px;
    color: var(--demo-muted);
    font-size: 9px;
}
.template-demo-badge {
    border-radius: 4px;
    padding: 1px 3px;
    background: #ecf0ff;
    color: #386cff;
    font-size: 9px;
    line-height: 1.25;
}
.is-submitted .template-demo-badge {
    background: #e8fbf2;
    color: var(--demo-green);
}
.template-demo-controls {
    display: flex;
    flex-shrink: 0;
    align-items: center;
    gap: 3px;
}
.template-demo-controls button,
.template-demo-skip {
    display: inline-flex;
    height: 25px;
    align-items: center;
    justify-content: center;
    gap: 3px;
    border: 1px solid var(--lab-line, #dfe3ec);
    border-radius: 8px;
    padding: 0 5px;
    font: inherit;
    font-size: 9px;
    white-space: nowrap;
    cursor: pointer;
}
.template-demo-skip {
    background: var(--demo-gray-bg);
    color: var(--lab-muted, #798294);
}
.template-demo-skip input {
    width: 11px;
    height: 11px;
    margin: 0;
    accent-color: #8b93a2;
}
.template-demo-open {
    border-color: #bee8d6 !important;
    background: #e9f7f0;
    color: var(--demo-green);
}
.template-demo-reset {
    border-color: #dacdff !important;
    background: #f0ecff;
    color: var(--demo-violet);
}
.template-demo-controls button:hover {
    filter: brightness(0.97);
}
.template-demo-controls button:focus-visible,
.template-demo-skip:has(input:focus-visible) {
    outline: 2px solid var(--demo-violet);
    outline-offset: 2px;
}
.template-demo-details {
    margin-top: 9px;
    border: 1px solid var(--demo-green-line);
    border-radius: 10px;
    padding: 8px 9px;
    background: var(--demo-inset-bg);
}
.template-demo-details-title {
    color: var(--demo-green);
    font-size: 11px;
    font-weight: 600;
}
.template-demo-details-meta {
    display: flex;
    justify-content: space-between;
    gap: 6px;
    margin: 5px 0 3px;
    color: var(--demo-muted);
    font-size: 9px;
}
.template-demo-details-meta time {
    white-space: nowrap;
}
.template-demo-fields {
    margin: 0;
}
.template-demo-fields > div {
    display: flex;
    align-items: baseline;
    gap: 5px;
}
.template-demo-fields dt {
    flex-shrink: 0;
    color: var(--demo-green);
    font-size: 10px;
    font-weight: 600;
}
.template-demo-fields dd {
    min-width: 0;
    margin: 0;
    overflow-wrap: anywhere;
    font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
    font-size: 12px;
    font-weight: 650;
    letter-spacing: 0.4px;
}
.template-demo-package,
.template-demo-empty-fields {
    margin: 4px 0 0;
    overflow-wrap: anywhere;
    color: var(--demo-muted);
    font-size: 9px;
}
.template-demo-empty {
    margin: 0;
    padding: 22px 10px;
    color: var(--demo-muted);
    text-align: center;
}
.template-demo-footer {
    position: sticky;
    bottom: 0;
    flex: 0 0 auto;
    border-top: 1px solid var(--lab-line, #dfe3ec);
    padding: 10px 9px;
    background: var(--demo-gray-bg);
    color: var(--demo-muted);
    font-size: 9px;
    text-align: center;
}
.template-demo-footer p {
    margin: 0;
}
.template-demo-feedback {
    margin-top: 4px !important;
    color: var(--lab-muted, #798294);
    font-size: 9px;
}
:global([data-bs-theme='dark']) .template-demo {
    --demo-green: #68dab2;
    --demo-violet: #b596ff;
    --demo-muted: #9faac0;
    --demo-gray-bg: #222b3c;
    --demo-green-bg: #1d302c;
    --demo-inset-bg: #1c352e;
    --demo-green-line: #31554a;
    --demo-icon-bg: #2c3648;
}
:global([data-bs-theme='dark']) .template-demo-badge {
    background: #293656;
    color: #94b1ff;
}
:global([data-bs-theme='dark']) .is-submitted .template-demo-badge {
    background: #234438;
    color: var(--demo-green);
}
:global([data-bs-theme='dark']) .template-demo-open {
    border-color: #3b6255 !important;
    background: #254639;
}
:global([data-bs-theme='dark']) .template-demo-reset {
    border-color: #574676 !important;
    background: #352b4b;
}
</style>
