<script setup>
import { computed } from 'vue';

const props = defineProps({
    tools: { type: Array, default: () => [] },
    loading: Boolean,
    error: { type: String, default: '' },
    busy: Boolean,
    feedback: { type: String, default: '' },
    feedbackError: Boolean,
});
const emit = defineEmits(['action', 'retry', 'inspect']);

// This fixed catalogue is presentation only; the parent owns the preview request.
const catalogue = [
    {
        id: 'view',
        title: '画面查看',
        tools: [
            { id: 'screen-preview', label: '屏幕预览', icon: '🖥️' },
            { id: 'camera-preview', label: '相机预览', icon: '📷' },
        ],
    },
    {
        id: 'apps',
        title: '应用预览',
        tools: [
            { id: 'apps-preview', label: '应用预览', icon: '📱' },
            { id: 'gallery-preview', label: '图库预览', icon: '🖼️' },
        ],
    },
    {
        id: 'diagnostic',
        title: '状态检查',
        tools: [
            { id: 'permissions-preview', label: '权限状态', icon: '🛡️' },
            { id: 'diagnostic-preview', label: '诊断预览', icon: '🩺' },
            { id: 'refresh-preview', label: '刷新预览', icon: '🔄' },
        ],
    },
    {
        id: 'data',
        title: '数据预览',
        tools: [{ id: 'export-preview', label: '导出预览', icon: '📄' }],
    },
    {
        id: 'analysis',
        title: 'AI 分析',
        tools: [{ id: 'analyze-sample', label: '分析合成样本', icon: '✨' }],
    },
];
const groups = computed(() => {
    const available = new Set(props.tools.map((tool) => tool?.id));
    return catalogue
        .map((group) => ({
            ...group,
            tools: group.tools.filter((tool) => available.has(tool.id)),
        }))
        .filter((group) => group.tools.length);
});
</script>

<template>
    <section class="toolbox-preview" aria-label="设备工具箱预览" :aria-busy="loading || busy">
        <header class="toolbox-preview-heading">
            <div>
                <h2>工具箱</h2>
                <p>UI 预览 · 设备功能尚未接入</p>
            </div>
            <button
                type="button"
                class="toolbox-preview-inspect"
                :disabled="busy"
                @click="emit('inspect', $event)"
            >
                模块状态
            </button>
        </header>

        <p v-if="loading" class="toolbox-preview-empty" role="status">正在读取工具目录…</p>
        <div v-else-if="error" class="toolbox-preview-error" role="alert">
            <p>{{ error }}</p>
            <button
                type="button"
                class="toolbox-preview-inspect"
                :disabled="busy"
                @click="emit('retry')"
            >
                重试预览
            </button>
        </div>
        <div v-else-if="groups.length" class="toolbox-preview-groups">
            <section
                v-for="group in groups"
                :key="group.id"
                class="toolbox-preview-group"
                :data-tool-group="group.id"
                :aria-label="group.title"
            >
                <h3>{{ group.title }}</h3>
                <div class="toolbox-preview-grid">
                    <button
                        v-for="tool in group.tools"
                        :key="tool.id"
                        type="button"
                        class="toolbox-preview-tool"
                        :data-preview-action="tool.id"
                        :disabled="busy"
                        @click="emit('action', tool.id)"
                    >
                        <span class="toolbox-preview-icon" aria-hidden="true">{{ tool.icon }}</span>
                        <span>{{ tool.label }}</span>
                    </button>
                </div>
            </section>
        </div>
        <p v-else class="toolbox-preview-empty">工具目录为空，暂无可预览工具。</p>

        <p
            v-if="feedback"
            class="toolbox-preview-feedback"
            :class="{ 'is-error': feedbackError }"
            :role="feedbackError ? 'alert' : 'status'"
        >
            {{ feedback }}
        </p>
    </section>
</template>

<style scoped>
.toolbox-preview {
    min-width: 0;
    border: 1px solid var(--lab-line, #e4e7ef);
    border-radius: 10px;
    padding: 16px;
    background: var(--lab-card, #fff);
    color: var(--lab-ink, #252c3c);
}
.toolbox-preview-heading {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    margin-bottom: 16px;
}
.toolbox-preview-heading h2 {
    margin: 0;
    font-size: 14px;
    font-weight: 650;
}
.toolbox-preview-heading p {
    margin: 4px 0 0;
    color: var(--lab-muted, #8f98a9);
    font-size: 10px;
}
.toolbox-preview-inspect {
    min-height: 27px;
    flex-shrink: 0;
    border: 1px solid var(--lab-line, #e4e7ef);
    border-radius: 5px;
    padding: 4px 9px;
    background: var(--lab-card, #fff);
    color: var(--lab-ink, #252c3c);
    font: inherit;
    font-size: 11px;
    cursor: pointer;
}
.toolbox-preview-groups {
    display: grid;
    gap: 16px;
}
.toolbox-preview-group h3 {
    margin: 0 0 6px;
    color: var(--lab-muted, #8f98a9);
    font-size: 10px;
    font-weight: 500;
}
.toolbox-preview-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, 112px);
    gap: 6px;
}
.toolbox-preview-tool {
    display: flex;
    width: 112px;
    height: 62px;
    align-items: center;
    justify-content: center;
    flex-direction: column;
    gap: 4px;
    border: 1px solid var(--lab-line, #e4e7ef);
    border-radius: 5px;
    padding: 6px;
    background: var(--lab-card, #fff);
    color: var(--lab-ink, #252c3c);
    font: inherit;
    font-size: 11px;
    line-height: 1.25;
    cursor: pointer;
}
.toolbox-preview-icon {
    font-size: 16px;
    line-height: 20px;
}
.toolbox-preview-tool:hover:not(:disabled),
.toolbox-preview-inspect:hover:not(:disabled) {
    border-color: #a8b4ff;
    background: #f7f8ff;
}
.toolbox-preview-tool:focus-visible,
.toolbox-preview-inspect:focus-visible {
    outline: 2px solid #6474ff;
    outline-offset: 2px;
}
.toolbox-preview-tool:disabled,
.toolbox-preview-inspect:disabled {
    opacity: 0.6;
    cursor: wait;
}
.toolbox-preview-empty {
    margin: 0;
    padding: 28px 10px;
    color: var(--lab-muted, #8f98a9);
    font-size: 11px;
    text-align: center;
}
.toolbox-preview-error {
    display: flex;
    align-items: center;
    gap: 10px;
    border: 1px solid #f5c9cc;
    border-radius: 6px;
    padding: 10px;
    background: #fff6f7;
    color: #b94149;
    font-size: 11px;
}
.toolbox-preview-error p {
    margin: 0;
}
.toolbox-preview-feedback {
    margin: 14px 0 0;
    border: 1px solid var(--lab-line, #e4e7ef);
    border-radius: 6px;
    padding: 9px 10px;
    background: var(--lab-bg, #f8f9fb);
    color: var(--lab-muted, #8f98a9);
    font-size: 11px;
}
.toolbox-preview-feedback.is-error {
    border-color: #f5c9cc;
    background: #fff6f7;
    color: #b94149;
}
:global([data-bs-theme='dark']) .toolbox-preview,
:global([data-bs-theme='dark']) .toolbox-preview-tool,
:global([data-bs-theme='dark']) .toolbox-preview-inspect {
    background: #1f2938;
}
:global([data-bs-theme='dark']) .toolbox-preview-tool:hover:not(:disabled),
:global([data-bs-theme='dark']) .toolbox-preview-inspect:hover:not(:disabled) {
    border-color: #7e91ff;
    background: #29344d;
}
:global([data-bs-theme='dark']) .toolbox-preview-error,
:global([data-bs-theme='dark']) .toolbox-preview-feedback.is-error {
    border-color: #74434b;
    background: #3a2831;
    color: #ffb6be;
}
</style>
