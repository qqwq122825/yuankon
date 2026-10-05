<script setup>
import { ref, computed, onUnmounted, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { connection, startConnection, stopConnection, onMessage } from './connection.js';
import { fleetStats as stats, refreshFleetStats, clearFleetStats } from './fleet-stats.js';
import FleetStats from './components/FleetStats.vue';
import AccountBadge from './components/AccountBadge.vue';
import { session } from './session.js';
const route = useRoute(),
    router = useRouter(),
    q = ref(''),
    dark = ref(localStorage.getItem('boundary-theme') === 'dark');
const detail = computed(() => route.path.startsWith('/devices/'));
const nav = computed(() => [
    ['/', 'device-mobile', '设备'],
    ...(['superadmin', 'studio_admin'].includes(session.user?.role)
        ? [['/accounts', 'shield-check', '账号']]
        : []),
    ['/builds', 'package', '构建'],
    ...(session.user?.role !== 'member' ? [['/settings/translation', 'adjustments', '翻译']] : []),
    ...(session.user?.role === 'superadmin' ? [['/logs', 'activity', '日志']] : []),
]);
watch(
    () => route.query.q,
    (v) => (q.value = String(v || '')),
    { immediate: true },
);
watch(
    () => route.path,
    () =>
        (document.body.className = `console-page console-${['/login', '/install'].includes(route.path) ? 'login' : detail.value ? 'detail' : 'fleet'}`),
    { immediate: true },
);
watch(
    dark,
    (value) => {
        document.documentElement.dataset.bsTheme = value ? 'dark' : 'light';
        localStorage.setItem('boundary-theme', value ? 'dark' : 'light');
    },
    { immediate: true },
);
async function loadStats() {
    try {
        await refreshFleetStats();
    } catch {}
}
let statsTimer;
const off = onMessage((message) => {
    if (
        ['device_online', 'device_offline', 'device_status_update', 'device_removed'].includes(
            message.type,
        )
    ) {
        clearTimeout(statsTimer);
        statsTimer = setTimeout(loadStats, 300);
    }
});
watch(
    () => session.user,
    (user) => {
        if (user) {
            loadStats();
            startConnection();
        } else {
            clearFleetStats();
            clearTimeout(statsTimer);
            stopConnection();
        }
    },
    { immediate: true },
);
onUnmounted(() => {
    off();
    stopConnection();
    clearTimeout(statsTimer);
});
function search() {
    router.push({
        path: '/',
        query: { ...(route.path === '/' ? route.query : {}), q: q.value, page: 1 },
    });
}
</script>
<template>
    <a href="#main" class="skip-link">跳到主要内容</a
    ><template v-if="!detail && session.user"
        ><header class="console-topbar">
            <RouterLink to="/" class="console-brand"
                ><img src="/favicon.svg" width="24" height="24" alt="" /><strong>边界研究</strong
                ><span class="version-label">V2</span></RouterLink
            >
            <div class="console-header-content">
                <form class="header-search" @submit.prevent="search">
                    <input
                        v-model="q"
                        class="form-control"
                        aria-label="搜索设备"
                        placeholder="搜索设备 ID / 备注 / 账号 / 品牌…"
                        maxlength="100"
                    /><button class="header-search-button" aria-label="提交搜索">
                        <img src="/vendor/icons/search.svg" width="15" alt="" />
                    </button>
                </form>
                <FleetStats :stats="stats" />
            </div>
            <AccountBadge />
            <button class="btn console-theme" @click="dark = !dark" aria-label="切换明暗主题">
                {{ dark ? '浅色' : '深色' }}主题</button
            ><RouterLink
                v-if="session.user.role === 'superadmin'"
                to="/protocol"
                class="btn console-help"
                :title="connection.error || '查看协议审计'"
                >WS · {{ connection.status }}</RouterLink
            >
            <span v-else class="console-help">WS · {{ connection.status }}</span>
        </header>
        <aside class="console-rail">
            <nav aria-label="主导航">
                <RouterLink
                    v-for="[url, icon, label] in nav"
                    :key="url"
                    :to="url"
                    class="rail-link"
                    :class="{
                        active:
                            route.path === url ||
                            (url === '/accounts' && route.path.startsWith('/accounts/')),
                    }"
                    ><img
                        :src="`/vendor/icons/${icon}.svg`"
                        width="21"
                        height="21"
                        alt=""
                    /><span>{{ label }}</span></RouterLink
                >
            </nav>
            <span class="rail-version">0.2</span>
        </aside></template
    >
    <main id="main" class="console-main">
        <RouterView v-if="session.user || ['/login', '/install'].includes(route.path)" />
    </main>
</template>
