<script setup>
import { computed, ref, onMounted, onUnmounted } from 'vue';
import { session } from '../session.js';
import { roleLabel, validityDisplay } from '../account-display.js';
const now = ref(Date.now());
const subtitle = computed(() => {
    const apk = session.user?.apkId ? `APK ${session.user.apkId}` : 'APK 待分配';
    return `${roleLabel(session.user?.role)} · ${apk}`;
});
const validity = computed(() => validityDisplay(session.user?.validUntil, now.value));
let timer;
onMounted(() => (timer = setInterval(() => (now.value = Date.now()), 30000)));
onUnmounted(() => clearInterval(timer));
</script>
<template>
    <RouterLink
        to="/settings/account"
        class="console-account"
        aria-label="账号设置"
        :title="`${session.user?.username} · ${subtitle} · ${validity.label}；点击查看账号详情`"
    >
        <span class="account-avatar" aria-hidden="true">{{
            session.user?.username?.slice(0, 1).toUpperCase() || 'M'
        }}</span>
        <span class="account-identity">
            <strong>{{ session.user?.username }}</strong>
            <small>{{ subtitle }}</small>
        </span>
        <span class="account-validity" :class="validity.state">{{ validity.label }}</span>
    </RouterLink>
</template>
