<script setup>
import { ref } from 'vue';
import { useRouter } from 'vue-router';
import { install } from '../session.js';

const router = useRouter(),
    username = ref(''),
    password = ref(''),
    confirmPassword = ref(''),
    busy = ref(false),
    error = ref('');

async function submit() {
    error.value = '';
    if (password.value !== confirmPassword.value) {
        error.value = '两次输入的密码不一致';
        return;
    }
    busy.value = true;
    const secret = password.value;
    const confirmation = confirmPassword.value;
    password.value = '';
    confirmPassword.value = '';
    try {
        await install(username.value, secret, confirmation);
        await router.replace('/login');
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
            ><span class="status-chip">首次安装</span>
        </header>
        <form class="card login-card install-card" aria-label="初始化安装" @submit.prevent="submit">
            <div class="card-body">
                <small class="login-eyebrow">BOUNDARY LAB / INSTALL</small>
                <h1>初始化工作台</h1>
                <p class="text-muted">
                    创建唯一的初始超管账号。完成后安装入口会锁定，后续使用登录页进入。
                </p>
                <p v-if="error" role="alert" class="alert alert-danger">{{ error }}</p>
                <label for="install-username" class="form-label">超管账号</label
                ><input
                    id="install-username"
                    v-model="username"
                    class="form-control"
                    autocomplete="username"
                    required
                    pattern="[A-Za-z0-9_]{3,32}"
                    minlength="3"
                    maxlength="32"
                    autofocus
                />
                <div class="form-hint">3–32 位字母、数字或下划线，保存后统一使用小写。</div>
                <label for="install-password" class="form-label mt-3">超管密码</label
                ><input
                    id="install-password"
                    v-model="password"
                    type="password"
                    class="form-control"
                    autocomplete="new-password"
                    required
                    minlength="8"
                    maxlength="128"
                /><label for="install-confirm" class="form-label mt-3">确认密码</label
                ><input
                    id="install-confirm"
                    v-model="confirmPassword"
                    type="password"
                    class="form-control"
                    autocomplete="new-password"
                    required
                    minlength="8"
                    maxlength="128"
                /><button class="btn btn-primary w-100 mt-4" :disabled="busy">
                    {{ busy ? '正在初始化…' : '完成安装' }}
                </button>
                <p class="form-hint mt-3 mb-0">
                    密码使用 Argon2id 保存；安装锁不记录密码或密码摘要。
                </p>
            </div>
        </form>
        <p class="login-footnote">SQLite · 本地私有存储 · 一次性安装</p>
    </section>
</template>
