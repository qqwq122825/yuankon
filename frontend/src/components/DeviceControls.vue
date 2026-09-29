<script setup>
import { ref } from 'vue';

const props = defineProps({
    disabled: Boolean,
    dndEnabled: Boolean,
    placeholder: { type: String, default: '输入或粘贴文本…' },
});
const emit = defineEmits(['action', 'text-input']);
const inputText = ref('');
const actions = [
    ['BACK', '◀', '上一页'],
    ['HOME', '●', 'Home'],
    ['RECENTS', '■', '多任务'],
    ['LOCK', '🔒', '锁屏'],
    ['WAKE', '💡', '点亮'],
];

function sendText() {
    if (props.disabled || !inputText.value.trim()) return;
    emit('text-input', inputText.value);
    inputText.value = '';
}
</script>

<template>
    <nav class="capture-action-bar" aria-label="设备快捷操作">
        <button
            v-for="[action, icon, label] in actions"
            :key="action"
            type="button"
            class="capture-action-button"
            :disabled="disabled"
            :aria-label="label"
            :title="label"
            @click="emit('action', action)"
        >
            {{ icon }}
        </button>
        <button
            type="button"
            class="capture-action-button"
            :class="{ active: dndEnabled }"
            :disabled="disabled"
            aria-label="切换勿扰"
            title="切换勿扰"
            @click="emit('action', 'DND_TOGGLE')"
        >
            {{ dndEnabled ? '🔔' : '🔕' }}
        </button>
    </nav>
    <form class="capture-text-bar" @submit.prevent="sendText">
        <input
            v-model="inputText"
            type="text"
            maxlength="500"
            :disabled="disabled"
            aria-label="发送到设备的文本"
            :placeholder="placeholder"
        />
        <button type="submit" :disabled="disabled || !inputText.trim()" aria-label="发送文本">
            发送
        </button>
    </form>
</template>
