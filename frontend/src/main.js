import { createApp } from 'vue';
import { createRouter, createWebHistory } from 'vue-router';
import App from './App.vue';
import Devices from './pages/Devices.vue';
import DeviceDetail from './pages/DeviceDetail.vue';
import Builds from './pages/Builds.vue';
import Translation from './pages/Translation.vue';
import Records from './pages/Records.vue';
import './styles/lab.css';
import './styles/console.css';
import './style.css';
import Login from './pages/Login.vue';
import Account from './pages/Account.vue';
import Install from './pages/Install.vue';
import { session, restoreSession, endSession } from './session.js';
const router = createRouter({
    history: createWebHistory(),
    routes: [
        { path: '/login', component: Login },
        { path: '/install', component: Install },
        { path: '/settings/account', component: Account },
        { path: '/', component: Devices },
        { path: '/devices/:id', component: DeviceDetail },
        { path: '/builds', component: Builds },
        { path: '/settings/translation', component: Translation },
        { path: '/snapshots', component: Records },
        { path: '/events', component: Records },
        { path: '/logs', component: Records },
        { path: '/protocol', component: Records },
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
});
window.addEventListener('auth-expired', (event) => {
    endSession(event.detail || '登录已失效，请重新登录');
    router.replace('/login');
});
const app = createApp(App).use(router);
router.isReady().then(() => app.mount('#app'));
