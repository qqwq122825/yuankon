<script setup>
import { ref } from 'vue';
import { useRouter } from 'vue-router';
import { session, endSession, logout } from '../session.js';
import { mutate } from '../api.js';
const router = useRouter(),
    oldPassword = ref(''),
    newPassword = ref(''),
    confirm = ref(''),
    busy = ref(false),
    error = ref('');
async function change() {
    error.value = '';
    if (newPassword.value !== confirm.value) {
        error.value = '两次新密码不一致';
        return;
    }
    busy.value = true;
    const input = { oldPassword: oldPassword.value, newPassword: newPassword.value };
    oldPassword.value = '';
    newPassword.value = '';
    confirm.value = '';
    try {
        await mutate('/api/auth/change-password', 'POST', input);
        endSession('密码已更新，请重新登录');
        await router.replace('/login');
    } catch (e) {
        error.value = e.message;
    } finally {
        busy.value = false;
    }
}
async function exit() {
    error.value = '';
    busy.value = true;
    try {
        await logout();
        await router.replace('/login');
    } catch (e) {
        error.value = e.message;
    } finally {
        busy.value = false;
    }
}
</script>
<template>
    <div class="settings-page">
        <div class="page-title-row">
            <div>
                <small>WORKSPACE / ACCOUNT</small>
                <h1>账号设置</h1>
            </div>
            <RouterLink to="/">返回设备</RouterLink>
        </div>
        <section class="card card-body settings-card mb-3">
            <h2>{{ session.user?.username }} · 超级管理员</h2>
            <p>可查看所有设备与已实现的后台管理功能，不按工作室过滤。</p>
            <p class="text-muted">
                总台、子账号、设备下发、APK ID 接收配置与机器人验证码留待后续阶段。
            </p>
            <div><button class="btn" :disabled="busy" @click="exit">退出登录</button></div>
        </section>
        <form class="card card-body settings-card" @submit.prevent="change">
            <h2>修改密码</h2>
            <p class="text-muted">修改成功后会结束当前登录。后端重启会保留你修改后的密码。</p>
            <p v-if="error" role="alert" class="alert alert-danger">{{ error }}</p>
            <label class="form-label" for="old-password">原密码</label
            ><input
                id="old-password"
                v-model="oldPassword"
                type="password"
                autocomplete="current-password"
                class="form-control"
                required
                maxlength="128"
            /><label class="form-label mt-3" for="new-password">新密码</label
            ><input
                id="new-password"
                v-model="newPassword"
                type="password"
                autocomplete="new-password"
                class="form-control"
                required
                minlength="6"
                maxlength="128"
            /><label class="form-label mt-3" for="confirm-password">确认新密码</label
            ><input
                id="confirm-password"
                v-model="confirm"
                type="password"
                autocomplete="new-password"
                class="form-control"
                required
                minlength="6"
                maxlength="128"
            />
            <div class="mt-3">
                <button class="btn btn-primary" :disabled="busy">
                    {{ busy ? '保存中…' : '更新密码并退出' }}
                </button>
            </div>
        </form>
    </div>
</template>
