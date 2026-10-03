<script setup>
import { ref, onMounted, onUnmounted, watch, provide } from 'vue';
import ViewerWidth from './ViewerWidth.vue';
const props = defineProps({
    title: String,
    meta: { type: String, default: '' },
    side: Number,
    resetKey: Number,
    active: Boolean,
    live: Boolean,
    resizable: Boolean,
    widthLabel: String,
    variant: { type: String, default: '' },
});
const emit = defineEmits(['close', 'activate']);
const width = ref(300),
    left = ref(0),
    top = ref(76),
    panel = ref(null);
const headerTools = ref(null);
provide('viewerHeaderTools', headerTools);
let drag, returnFocus;
function reset() {
    left.value =
        Math.max(108, (Math.max(1280, window.innerWidth) - 648) / 2) + (props.side || 0) * 324;
    top.value = 76;
}
function down(event) {
    if (event.target.closest('button,input,select')) return;
    drag = { x: event.pageX, y: event.pageY, left: left.value, top: top.value };
    event.currentTarget.setPointerCapture(event.pointerId);
    emit('activate');
}
function move(event) {
    if (!drag) return;
    left.value = Math.max(
        0,
        Math.min(Math.max(1280, window.innerWidth) - width.value, drag.left + event.pageX - drag.x),
    );
    top.value = Math.max(
        0,
        Math.min(Math.max(500, window.innerHeight) - 80, drag.top + event.pageY - drag.y),
    );
}
function close() {
    emit('close');
    if (returnFocus?.isConnected) returnFocus.focus();
}
function escape(event) {
    if (!event.defaultPrevented && event.key === 'Escape' && props.active) {
        event.preventDefault();
        close();
    }
}
watch(() => props.resetKey, reset);
onMounted(() => {
    returnFocus = document.activeElement;
    reset();
    panel.value?.focus();
    window.addEventListener('resize', reset);
    window.addEventListener('keydown', escape);
});
onUnmounted(() => {
    window.removeEventListener('resize', reset);
    window.removeEventListener('keydown', escape);
});
</script>
<template>
    <section
        ref="panel"
        tabindex="-1"
        role="region"
        :aria-label="title"
        class="floating-viewer card"
        :class="{ 'floating-viewer-live': live, [`floating-viewer-${variant}`]: variant }"
        :style="{
            width: `${width}px`,
            left: `${left}px`,
            top: `${top}px`,
            zIndex: active ? 91 : 90,
        }"
        @pointerdown="emit('activate')"
    >
        <header
            class="floating-heading"
            @pointerdown="down"
            @pointermove="move"
            @pointerup="drag = null"
            @pointercancel="drag = null"
        >
            <span class="floating-heading-title"
                ><span v-if="live" class="viewer-live-dot" aria-hidden="true"></span
                ><strong>{{ title }}</strong></span
            ><span class="floating-heading-actions"
                ><span v-if="meta" class="floating-heading-meta">{{ meta }}</span
                ><span
                    v-if="variant === 'reader'"
                    ref="headerTools"
                    class="reader-header-tools"
                ></span
                ><button class="btn btn-sm" @click="close" :aria-label="`关闭${title}`">
                    {{ live ? 'X' : '×' }}
                </button></span
            >
        </header>
        <ViewerWidth v-if="resizable" v-model="width" :label="widthLabel || title" />
        <div class="floating-content"><slot /></div>
    </section>
</template>
