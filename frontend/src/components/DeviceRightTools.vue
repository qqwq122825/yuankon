<script setup>
import { ref, watch } from 'vue';

const props = defineProps({
    deviceId: { type: Number, required: true },
    canScreenshot: Boolean,
    canReader: Boolean,
});
const emit = defineEmits(['screenshot', 'reader']);

// The reference catalogue is presentation only. Only the two existing viewers emit events.
const groups = [
    {
        id: 'remote',
        label: '画面与远程',
        tools: [
            { id: 'screenshot', label: 'BM截图', tone: 'primary', view: 'screenshot' },
            { id: 'reader', label: '打开阅读器', tone: '', view: 'reader' },
            { id: 'hd-preview', label: '打开HD投屏', tone: 'primary' },
            { id: 'camera-preview', label: '打开摄像头', tone: 'primary' },
        ],
    },
    {
        id: 'screen',
        label: '黑屏控制',
        tools: [
            { id: 'black-pure-preview', label: '开启纯黑黑屏', tone: 'muted' },
            { id: 'black-system-preview', label: '开启系统黑屏', tone: 'muted' },
            { id: 'black-update-preview', label: '开启更新黑屏', tone: 'muted' },
            { id: 'black-close-preview', label: '关闭黑屏', tone: 'mint' },
        ],
    },
    {
        id: 'policy',
        label: '设备策略',
        tools: [
            { id: 'uninstall-on-preview', label: '防卸载开', tone: '' },
            { id: 'uninstall-off-preview', label: '防卸载关', tone: '' },
        ],
    },
    {
        id: 'maintenance',
        label: '状态与维护',
        tools: [
            { id: 'dnd-on-preview', label: '勿扰', tone: 'rose' },
            { id: 'dnd-off-preview', label: '取消勿扰', tone: 'mint' },
            { id: 'restart-preview', label: '重启应用', tone: '' },
        ],
    },
    {
        id: 'security',
        label: '安全工具',
        tools: [{ id: 'password-preview', label: '捕获锁屏密码', tone: 'primary' }],
    },
];
const feedback = ref('');
let feedbackOpener;

function isDisabled(tool) {
    if (tool.view === 'screenshot') return !props.canScreenshot;
    if (tool.view === 'reader') return !props.canReader;
    return false;
}
function activate(tool, event) {
    if (isDisabled(tool)) return;
    if (tool.view) {
        feedback.value = '';
        feedbackOpener = undefined;
        emit(tool.view);
        return;
    }
    feedbackOpener = event.currentTarget;
    feedback.value = `「${tool.label}」仅为 UI 预览，功能尚未接入`;
}
function closeFeedback() {
    feedback.value = '';
    if (feedbackOpener?.isConnected && !feedbackOpener.disabled) feedbackOpener.focus();
    feedbackOpener = undefined;
}
watch(
    () => props.deviceId,
    () => {
        feedback.value = '';
        feedbackOpener = undefined;
    },
);
</script>

<template>
    <section class="device-reference-tools" aria-label="设备快捷工具">
        <div
            v-for="group in groups"
            :key="group.id"
            class="tool-group"
            :data-rightbar-group="group.id"
        >
            <h2>{{ group.label }}</h2>
            <button
                v-for="tool in group.tools"
                :key="tool.id"
                type="button"
                class="tool-button"
                :class="tool.tone"
                :data-rightbar-action="tool.id"
                :data-ui-only="!tool.view"
                :disabled="isDisabled(tool)"
                @click="activate(tool, $event)"
            >
                {{ tool.label }}
            </button>
        </div>
        <div v-if="feedback" class="right-tools-feedback" role="status">
            <p>{{ feedback }}</p>
            <button type="button" aria-label="关闭工具提示" @click="closeFeedback">×</button>
        </div>
        <p class="rightbar-tool-caption">新增操作为 UI 预览，功能尚未接入。</p>
    </section>
</template>

<style scoped>
.device-reference-tools > .tool-group > h2 {
    line-height: 1.2;
}
.device-reference-tools > .tool-group[data-rightbar-group='security'] {
    border-bottom: 0;
}
.device-reference-tools .tool-button {
    font-family: inherit;
    font-size: 11px;
    font-weight: 600;
    line-height: 16px;
    background: #fff;
    color: #353c4d;
    border-color: #e0e3ee;
}
.device-reference-tools .tool-button.primary {
    background: #eef1ff;
    color: #5366ff;
    border-color: #b8c2ff;
}
.device-reference-tools .tool-button.muted {
    background: #f2f3f8;
    border-color: #d3d8e8;
}
.device-reference-tools .tool-button.mint {
    background: #eafbf5;
    color: #15b995;
    border-color: #a4dfce;
}
.device-reference-tools .tool-button.rose {
    background: #fff4f4;
    color: #ff4d57;
    border-color: #f7b8bf;
}
.device-reference-tools .tool-button:focus-visible,
.right-tools-feedback button:focus-visible {
    outline: 2px solid #5366ff;
    outline-offset: 2px;
}
.right-tools-feedback {
    display: flex;
    align-items: flex-start;
    gap: 5px;
    margin-top: 8px;
    border: 1px solid #dde3ee;
    border-radius: 7px;
    padding: 8px;
    background: #f4f6fa;
    color: #58657a;
    font-size: 10px;
    line-height: 1.6;
}
.right-tools-feedback p {
    flex: 1;
    margin: 0;
    overflow-wrap: anywhere;
}
.right-tools-feedback button {
    display: grid;
    place-items: center;
    flex: 0 0 18px;
    width: 18px;
    height: 18px;
    border: 0;
    border-radius: 3px;
    padding: 0;
    background: transparent;
    color: inherit;
    font-size: 14px;
    cursor: pointer;
}
.rightbar-tool-caption {
    margin: 9px 3px 0;
    color: var(--lab-muted, #9299aa);
    font-size: 8px;
    line-height: 1.6;
}
[data-bs-theme='dark'] .device-reference-tools .tool-button {
    background: #1c2639;
    color: #dce2ef;
    border-color: #36435d;
}
[data-bs-theme='dark'] .device-reference-tools .tool-button.primary {
    background: #253456;
    color: #a3b3ff;
    border-color: #506699;
}
[data-bs-theme='dark'] .device-reference-tools .tool-button.muted {
    background: #263043;
    border-color: #42516b;
}
[data-bs-theme='dark'] .device-reference-tools .tool-button.mint {
    background: #163b36;
    color: #77dbc0;
    border-color: #347867;
}
[data-bs-theme='dark'] .device-reference-tools .tool-button.rose {
    background: #452933;
    color: #ffadb5;
    border-color: #8c4c60;
}
[data-bs-theme='dark'] .right-tools-feedback {
    background: #212b3d;
    color: #bdc7d9;
    border-color: #3c4962;
}
[data-bs-theme='dark'] .device-reference-tools .tool-button:focus-visible,
[data-bs-theme='dark'] .right-tools-feedback button:focus-visible {
    outline-color: #a3b3ff;
}
</style>
