import { reactive } from 'vue';
import { api, mutate } from './api.js';
export const session = reactive({ user: null, ready: false, message: '' });
let loading;
export async function restoreSession() {
    if (session.ready) return session.user;
    if (!loading)
        loading = api('/api/auth/me', { authFailureEvent: false })
            .then((result) => {
                session.user = result.user;
                return result.user;
            })
            .catch((error) => {
                session.user = null;
                if (error.status !== 401) session.message = error.message;
                return null;
            })
            .finally(() => {
                session.ready = true;
                loading = null;
            });
    return loading;
}
export async function login(username, password) {
    const result = await mutate('/api/auth/login', 'POST', { username, password });
    // The signed token is carried by an HttpOnly cookie; never put it in localStorage.
    session.user = result.user;
    session.ready = true;
    session.message = '';
    return result.user;
}
export async function refreshProfile() {
    const current = session.user;
    if (!current) return;
    const result = await api('/api/auth/me');
    // A late response must not restore a logged-out or replaced session.
    if (session.user === current) session.user = result.user;
}
export function endSession(message = '请登录') {
    session.user = null;
    session.ready = true;
    session.message = message;
}
export async function logout() {
    await mutate('/api/auth/logout', 'POST');
    endSession('已退出登录');
}
