<script setup>
import { ref, onMounted, onBeforeUnmount } from 'vue';
import { useRouter } from 'vue-router';
import { install, session } from '../session.js';
import { api, mutate } from '../api.js';

const router = useRouter(),
    username = ref(''),
    password = ref(''),
    confirmPassword = ref(''),
    showPassword = ref(false),
    busy = ref(false),
    environmentBusy = ref(false),
    error = ref(''),
    environment = ref({
        ready: false,
        state: 'checking',
        stage: 'checking',
        message: '正在检测构建环境',
        components: [],
        log: '',
    });
let timer,
    disposed = false;

function scheduleEnvironmentPoll() {
    clearTimeout(timer);
    if (!disposed && environment.value.state === 'installing')
        timer = setTimeout(loadEnvironment, 2000);
}

async function loadEnvironment() {
    try {
        environment.value = await api('/api/install/environment', { authFailureEvent: false });
        scheduleEnvironmentPoll();
    } catch (e) {
        if (!disposed) error.value = e.message;
    }
}

async function installEnvironment() {
    environmentBusy.value = true;
    error.value = '';
    try {
        environment.value = await mutate('/api/install/environment', 'POST');
        scheduleEnvironmentPoll();
    } catch (e) {
        error.value = e.message;
    } finally {
        environmentBusy.value = false;
    }
}

async function submit() {
    error.value = '';
    if (!environment.value.ready) {
        error.value = '请先完成构建环境安装';
        return;
    }
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

onMounted(loadEnvironment);
onBeforeUnmount(() => {
    disposed = true;
    clearTimeout(timer);
});
</script>
<template>
    <section class="login-screen">
        <header class="login-brand">
            <img src="/favicon.svg" width="28" alt="" /><strong>满天星</strong
            ><span class="status-chip">{{ session.installed ? '构建环境' : '首次安装' }}</span>
        </header>
        <form class="card login-card install-card" aria-label="初始化安装" @submit.prevent="submit">
            <div class="card-body">
                <small class="login-eyebrow">满天星 / INSTALL</small>
                <h1>{{ session.installed ? '构建环境' : '初始化工作台' }}</h1>
                <p v-if="!session.installed" class="text-muted">
                    先安装固定的 Android
                    构建环境，再创建唯一的初始超管账号。全部完成后安装入口会锁定。
                </p>
                <p v-else class="text-muted">
                    当前账号与数据库保持不变；这里只检测或补齐 Android 构建工具链。
                </p>
                <p v-if="error" role="alert" class="alert alert-danger">{{ error }}</p>
                <section class="install-step" aria-labelledby="environment-title">
                    <div class="install-step-heading">
                        <span class="badge bg-blue-lt">第 1 步</span>
                        <div>
                            <h2 id="environment-title">安装构建环境</h2>
                            <p>{{ environment.message }}</p>
                        </div>
                        <span
                            class="badge"
                            :class="environment.ready ? 'bg-green-lt' : 'bg-yellow-lt'"
                            >{{ environment.ready ? '已就绪' : '未完成' }}</span
                        >
                    </div>
                    <ul class="environment-components" aria-label="构建环境组件">
                        <li v-for="component in environment.components" :key="component.id">
                            <span>{{ component.label }}</span
                            ><strong :class="component.ready ? 'text-success' : 'text-muted'">{{
                                component.ready ? '完成' : '待安装'
                            }}</strong>
                        </li>
                    </ul>
                    <p class="form-hint">
                        固定安装 JDK 17、Android SDK 35、Build Tools 35.0.0、Gradle
                        8.11.1，并预热登记模板的离线依赖。约需 6 GiB 可用空间。
                    </p>
                    <button
                        type="button"
                        class="btn btn-primary w-100"
                        :disabled="
                            environment.ready ||
                            environmentBusy ||
                            environment.state === 'installing'
                        "
                        @click="installEnvironment"
                    >
                        {{
                            environment.state === 'installing'
                                ? '正在安装环境…'
                                : environment.state === 'failed'
                                  ? '重新安装环境'
                                  : environment.ready
                                    ? '构建环境已就绪'
                                    : '安装构建环境'
                        }}
                    </button>
                    <pre v-if="environment.log" class="environment-log">{{ environment.log }}</pre>
                </section>
                <section
                    v-if="!session.installed"
                    class="install-step"
                    aria-labelledby="account-title"
                >
                    <div class="install-step-heading">
                        <span class="badge bg-green-lt">第 2 步</span>
                        <div>
                            <h2 id="account-title">创建超管账号</h2>
                            <p>初始超管固定分配 APK ID 1。</p>
                        </div>
                    </div>
                    <fieldset :disabled="busy || !environment.ready">
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
                        />
                        <div class="form-hint">3–32 位字母、数字或下划线，保存后统一使用小写。</div>
                        <label for="install-password" class="form-label mt-3">超管密码</label
                        ><input
                            id="install-password"
                            v-model="password"
                            :type="showPassword ? 'text' : 'password'"
                            class="form-control"
                            autocomplete="new-password"
                            required
                        /><label for="install-confirm" class="form-label mt-3">确认密码</label
                        ><input
                            id="install-confirm"
                            v-model="confirmPassword"
                            :type="showPassword ? 'text' : 'password'"
                            class="form-control"
                            autocomplete="new-password"
                            required
                        />
                        <label class="form-check mt-2">
                            <input
                                v-model="showPassword"
                                class="form-check-input"
                                type="checkbox"
                            />
                            <span class="form-check-label">显示密码</span>
                        </label>
                        <button
                            class="btn btn-primary w-100 mt-4"
                            :disabled="busy || !environment.ready"
                        >
                            {{ busy ? '正在初始化…' : '完成安装' }}
                        </button>
                    </fieldset>
                </section>
                <p v-if="!session.installed" class="form-hint mt-3 mb-0">
                    密码使用 Argon2id 保存；安装锁不记录密码或密码摘要。
                </p>
                <RouterLink v-else class="btn btn-outline-primary w-100 mt-3" to="/builds">
                    返回构建页面
                </RouterLink>
            </div>
        </form>
        <p class="login-footnote">
            {{
                session.installed
                    ? '账号与数据库不会重新初始化'
                    : 'SQLite · 本地私有存储 · 一次性安装'
            }}
        </p>
    </section>
</template>
