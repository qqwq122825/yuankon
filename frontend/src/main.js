import { createApp } from 'vue';
import { createRouter, createWebHistory } from 'vue-router';
import App from './App.vue';
import Devices from './pages/Devices.vue';
import DeviceDetail from './pages/DeviceDetail.vue';
import Builds from './pages/Builds.vue';
import Translation from './pages/Translation.vue';
import Records from './pages/Records.vue';
import ServerLogs from './pages/ServerLogs.vue';
import './styles/lab.css';
import './styles/console.css';
import './style.css';
import Login from './pages/Login.vue';
import Account from './pages/Account.vue';
import Accounts from './pages/Accounts.vue';
import Install from './pages/Install.vue';
import { session, restoreSession, endSession } from './session.js';
const router = createRouter({
    history: createWebHistory(),
    routes: [
        { path: '/login', component: Login },
        { path: '/install', component: Install },
        { path: '/settings/account', component: Account },
        { path: '/accounts', component: Accounts, meta: { manager: true } },
        {
            path: '/accounts/:studioAccountId/members',
            component: Accounts,
            meta: { superadmin: true },
        },
        { path: '/', component: Devices },
        { path: '/devices/:id', component: DeviceDetail },
        { path: '/builds', component: Builds },
        { path: '/settings/translation', component: Translation, meta: { manager: true } },
        { path: '/snapshots', component: Records },
        { path: '/events', component: Records },
        { path: '/logs', component: ServerLogs, meta: { superadmin: true } },
        { path: '/protocol', component: Records, meta: { superadmin: true } },
        { path: '/:pathMatch(.*)*', redirect: '/' },
    ],
});
router.beforeEach(async (to) => {
    await restoreSession();
    if (!session.installed) {
        if (to.path !== '/install') return '/install';
        return true;
    }
    if (session.installed && to.path === '/install') return session.user ? true : '/login';
    if (!session.user && to.path !== '/login') return '/login';
    if (session.user && to.path === '/login') return '/';
    if (to.meta.manager && !['superadmin', 'studio_admin'].includes(session.user?.role)) return '/';
    if (to.meta.superadmin && session.user?.role !== 'superadmin') return '/';
});
window.addEventListener('auth-expired', (event) => {
    endSession(event.detail || '登录已失效，请重新登录');
    router.replace('/login');
});
const app = createApp(App).use(router);
router.isReady().then(() => app.mount('#app'));
