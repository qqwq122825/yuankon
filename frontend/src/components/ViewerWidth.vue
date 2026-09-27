<script setup>
defineProps({ modelValue: Number, label: String });
defineEmits(['update:modelValue']);
</script>
<template>
    <div class="width-control">
        <span>{{ label }}宽度</span
        ><button
            class="btn btn-sm"
            :aria-label="`缩小${label}`"
            :disabled="modelValue <= 220"
            @click="$emit('update:modelValue', modelValue - 20)"
        >
            −</button
        ><output>{{ modelValue }}px</output
        ><button
            class="btn btn-sm"
            :aria-label="`放大${label}`"
            :disabled="modelValue >= 500"
            @click="$emit('update:modelValue', modelValue + 20)"
        >
            ＋
        </button>
    </div>
</template>
