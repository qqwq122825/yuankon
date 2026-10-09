<script setup>
import { ref, computed, onUnmounted, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { connection, startConnection, stopConnection, onMessage } from './connection.js';
import { fleetStats as stats, refreshFleetStats, clearFleetStats } from './fleet-stats.js';
import FleetStats from './components/FleetStats.vue';
import AccountBadge from './components/AccountBadge.vue';
import { session, logout } from './session.js';
const route = useRoute(),
    router = useRouter(),
    q = ref(''),
    dark = ref(localStorage.getItem('boundary-theme') === 'dark'),
    logoutBusy = ref(false),
    logoutError = ref('');
const detail = computed(() => route.path.startsWith('/devices/'));
const nav = computed(() => [
    ['/', 'device-mobile', '设备'],
    ...(['superadmin', 'studio_admin'].includes(session.user?.role)
        ? [
              ['/accounts', 'users', '用户'],
              ['/ai', 'sun', 'AI'],
          ]
        : []),
    ['/injection', 'injection', '注入'],
    ['/builds', 'list-check', '构建'],
    ['/push', 'bell', '推送'],
    ...(['superadmin', 'studio_admin'].includes(session.user?.role)
        ? [
              ['/blacklist', 'ban', '拉黑'],
              ['/performance', 'gauge', '性能'],
              ['/settings/translation', 'language', '翻译'],
          ]
        : []),
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
        logoutError.value = '';
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
    const path = ['/', '/blacklist'].includes(route.path) ? route.path : '/';
    router.push({
        path,
        query: { ...(route.path === path ? route.query : {}), q: q.value, page: 1 },
    });
}
async function exit() {
    if (logoutBusy.value) return;
    logoutError.value = '';
    logoutBusy.value = true;
    try {
        await logout();
        await router.replace('/login');
    } catch (error) {
        logoutError.value = error.message;
    } finally {
        logoutBusy.value = false;
    }
}
</script>
<template>
    <a href="#main" class="skip-link">跳到主要内容</a
    ><template v-if="!detail && session.user"
        ><header class="console-topbar">
            <RouterLink to="/" class="console-brand"
                ><img src="/favicon.svg" width="24" height="24" alt="" /><strong>满天星</strong
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
            <button
                type="button"
                class="btn console-theme console-icon-button"
                @click="dark = !dark"
                aria-label="切换明暗主题"
                :aria-pressed="dark"
                :title="dark ? '切换到浅色主题' : '切换到深色主题'"
            >
                <img
                    :src="`/vendor/icons/${dark ? 'moon' : 'sun'}.svg`"
                    width="16"
                    height="16"
                    alt=""
                />
                <span class="visually-hidden">{{ dark ? '浅色' : '深色' }}主题</span>
            </button>
            <RouterLink
                v-if="session.user.role === 'superadmin'"
                to="/protocol"
                class="btn console-help console-icon-button"
                :aria-label="`WS · ${connection.status}`"
                :title="connection.error || `WS · ${connection.status}；查看协议审计`"
            >
                <img src="/vendor/icons/activity.svg" width="16" height="16" alt="" />
                <span class="visually-hidden">WS · {{ connection.status }}</span>
            </RouterLink>
            <span
                v-else
                class="btn console-help console-icon-button"
                role="status"
                :aria-label="`WS · ${connection.status}`"
                :title="connection.error || `WS · ${connection.status}`"
            >
                <img src="/vendor/icons/activity.svg" width="16" height="16" alt="" />
                <span class="visually-hidden">WS · {{ connection.status }}</span>
            </span>
            <button
                type="button"
                class="btn console-logout console-icon-button"
                aria-label="退出当前账号"
                title="退出当前账号"
                :disabled="logoutBusy"
                @click="exit"
            >
                <svg
                    width="16"
                    height="16"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    stroke-width="2"
                    stroke-linecap="round"
                    stroke-linejoin="round"
                    aria-hidden="true"
                    focusable="false"
                >
                    <path d="M9 5H5v14h4M10 12h11m-4-4 4 4-4 4" />
                </svg>
            </button>
        </header>
        <p v-if="logoutError" role="alert" class="console-header-error">{{ logoutError }}</p>
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
