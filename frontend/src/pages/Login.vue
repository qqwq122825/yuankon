<script setup>
import { ref } from 'vue';
import { useRouter } from 'vue-router';
import { login, session } from '../session.js';
const router = useRouter(),
    username = ref(''),
    password = ref(''),
    busy = ref(false),
    error = ref('');
async function submit() {
    busy.value = true;
    error.value = '';
    const value = password.value;
    password.value = '';
    try {
        await login(username.value, value);
        await router.replace('/');
    } catch (e) {
        error.value = e.message;
    } finally {
        busy.value = false;
    }
}
</script>
<template>
    <section class="login-screen">
        <header class="login-brand">
            <img src="/favicon.svg" width="28" alt="" /><strong>边界研究</strong
            ><span class="status-chip">本机工作台</span>
        </header>
        <form class="card login-card" @submit.prevent="submit">
            <div class="card-body">
                <small class="login-eyebrow">BOUNDARY LAB / ADMIN</small>
                <h1>超管登录</h1>
                <p class="text-muted">登录后管理所有设备。一个账号仅保留一处有效登录。</p>
                <p v-if="session.message" role="status" class="login-message">
                    {{ session.message }}
                </p>
                <p v-if="error" role="alert" class="alert alert-danger">{{ error }}</p>
                <label for="login-username" class="form-label">账号</label
                ><input
                    id="login-username"
                    v-model="username"
                    class="form-control"
                    autocomplete="username"
                    required
                    minlength="3"
                    maxlength="32"
                    autofocus
                /><label for="login-password" class="form-label mt-3">密码</label
                ><input
                    id="login-password"
                    v-model="password"
                    type="password"
                    class="form-control"
                    autocomplete="current-password"
                    required
                    maxlength="128"
                /><button class="btn btn-primary w-100 mt-4" :disabled="busy">
                    {{ busy ? '正在登录…' : '登录' }}
                </button>
                <p class="form-hint mt-3 mb-0">当前使用账号密码登录；机器人验证码暂未启用。</p>
            </div>
        </form>
        <p class="login-footnote">SQLite · Token 鉴权 · 单端会话</p>
    </section>
</template>
