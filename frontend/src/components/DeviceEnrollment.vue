<script setup>
import { ref, onMounted } from 'vue';
import { api, mutate, formatDate } from '../api.js';
import { session } from '../session.js';
const routes = ref([]),
    apkId = ref(''),
    selected = ref(''),
    ticket = ref(null),
    error = ref(''),
    busy = ref(false),
    copied = ref(false);
async function load() {
    routes.value = (await api('/api/apk-routes')).data;
}
async function act(callback) {
    error.value = '';
    busy.value = true;
    try {
        await callback();
    } catch (e) {
        error.value = e.message;
    } finally {
        busy.value = false;
    }
}
function createRoute() {
    return act(async () => {
        await mutate('/api/apk-routes', 'POST', { apkId: apkId.value.trim() });
        selected.value = apkId.value.trim();
        apkId.value = '';
        await load();
    });
}
function issue() {
    return act(async () => {
        ticket.value = null;
        copied.value = false;
        ticket.value = await mutate('/api/device-enrollments', 'POST', { apkId: selected.value });
    });
}
function copy() {
    return act(async () => {
        await navigator.clipboard.writeText(ticket.value.enrollmentToken);
        copied.value = true;
    });
}
onMounted(() => act(load));
</script>
<template>
    <section class="card card-body mb-3">
        <h2>设备接入 · APK ID 归属</h2>
        <p>
            当前归属账户：{{ session.user?.username }}。先配置 APK ID，再生成一台设备使用的 10
            分钟登记码。重连沿用设备凭证，不重复分配归属。
        </p>
        <div v-if="error" role="alert" class="alert alert-danger">{{ error }}</div>
        <form class="page-actions" @submit.prevent="createRoute">
            <label
                >新 APK ID
                <input
                    class="form-control"
                    v-model="apkId"
                    required
                    maxlength="64"
                    pattern="[A-Za-z0-9_-]+"
            /></label>
            <button class="btn" :disabled="busy">保存 APK 归属</button>
        </form>
        <form class="page-actions mt-3" @submit.prevent="issue">
            <label
                >已配置 APK ID
                <select class="form-select" v-model="selected" required>
                    <option value="" disabled>选择 APK ID</option>
                    <option v-for="route in routes" :key="route.apk_id" :value="route.apk_id">
                        {{ route.apk_id }} → {{ route.username }}
                    </option>
                </select></label
            >
            <button class="btn" :disabled="busy || !selected">生成设备登记码</button>
        </form>
        <div v-if="ticket" class="mt-3">
            <label
                >设备登记码（只在本页显示）<textarea
                    class="form-control"
                    readonly
                    rows="3"
                    :value="ticket.enrollmentToken"
                />
            </label>
            <p>
                有效期至 {{ formatDate(ticket.expiresAt) }}；在手机接入页面粘贴。登记码和设备 Token
                均不要分享。
            </p>
            <button class="btn" :disabled="busy" @click="copy">
                {{ copied ? '已复制登记码' : '复制登记码' }}
            </button>
            <button class="btn ms-2" @click="ticket = null">隐藏登记码</button>
        </div>
    </section>
</template>
