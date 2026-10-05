<script setup>
import { ref, computed, onMounted } from 'vue';
import { useRouter } from 'vue-router';
import { session, endSession, logout, refreshProfile } from '../session.js';
import { roleLabel, validityDisplay } from '../account-display.js';
import { mutate } from '../api.js';
const router = useRouter(),
    oldPassword = ref(''),
    newPassword = ref(''),
    confirm = ref(''),
    busy = ref(false),
    error = ref('');
const validity = computed(() => validityDisplay(session.user?.validUntil));
onMounted(() => refreshProfile().catch((e) => (error.value = e.message)));
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
            <h2>
                {{ session.user?.username }} ·
                {{
                    session.user?.role === 'superadmin'
                        ? '超级管理员'
                        : roleLabel(session.user?.role)
                }}
            </h2>
            <p>
                {{
                    session.user?.role === 'superadmin'
                        ? '可管理总台并查看所有项目。'
                        : session.user?.role === 'studio_admin'
                          ? '管理本总台及所属子账号。'
                          : '仅查看自己的设备和构建任务。'
                }}
            </p>
            <dl class="account-facts">
                <dt>APK ID</dt>
                <dd class="account-apk-list">
                    <code>{{ session.user?.apkId || '待分配' }}</code>
                </dd>
                <dt>账号有效期{{ session.user?.inheritsValidity ? '（继承总台）' : '' }}</dt>
                <dd>
                    <span class="account-validity" :class="validity.state">{{
                        validity.label
                    }}</span>
                </dd>
            </dl>
            <p class="text-muted">
                APK ID
                在创建账号时自动分配，一个账号一个固定编号；有效期按北京时间显示，与登录会话的 8
                小时有效期分开。
            </p>
            <p class="text-muted">
                总台将按工作室有效期续费，子账号受总台期限约束。总台开通、续费操作、设备下发与机器人验证码留待后续阶段。
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
