<script setup>
import { ref, reactive, computed, onMounted, onBeforeUnmount } from 'vue';
import { api, mutate, formatDate } from '../api.js';
import DeviceEnrollment from '../components/DeviceEnrollment.vue';
const result = ref(null),
    catalog = ref(null),
    error = ref(''),
    notice = ref(''),
    page = ref(1),
    busy = ref(false),
    enrollmentKey = ref(0),
    copyLink = ref('');
const form = reactive({
    templateId: '',
    domain: 'local',
    appName: '',
    homeUrl: '',
    apkId: '',
    batch: '',
    packageName: '',
});
const selected = computed(() => catalog.value?.templates.find((t) => t.id === form.templateId));
const statuses = {
    queued: '排队中',
    preparing: '准备源码',
    compiling: '编译 / Lint',
    verifying: '签名校验',
    succeeded: '已完成',
    failed: '失败',
    building: '构建中',
};
let timer,
    controller,
    disposed = false,
    submission;
async function load() {
    controller?.abort();
    controller = new AbortController();
    try {
        const data = await api(`/api/builds?page=${page.value}`, { signal: controller.signal });
        if (!disposed) result.value = data;
    } catch (e) {
        if (e.name !== 'AbortError') error.value = e.message;
    }
}
async function refresh() {
    error.value = '';
    await load();
}
async function poll() {
    await load();
    if (!disposed) timer = setTimeout(poll, result.value?.worker.active ? 2000 : 10000);
}
function randomPackage() {
    form.packageName = `org.boundary.app.p${crypto.randomUUID().replaceAll('-', '').slice(0, 16)}`;
}
async function submit() {
    if (busy.value) return;
    error.value = '';
    notice.value = '';
    copyLink.value = '';
    busy.value = true;
    const values = Object.fromEntries(
        Object.entries(form).map(([key, value]) => [key, value.trim()]),
    );
    const fingerprint = JSON.stringify(values);
    if (!submission || submission.fingerprint !== fingerprint)
        submission = { fingerprint, requestId: crypto.randomUUID() };
    try {
        const { build } = await mutate('/api/builds', 'POST', {
            ...values,
            requestId: submission.requestId,
        });
        submission = null;
        page.value = 1;
        enrollmentKey.value++;
        notice.value = `已提交 ${build.id.slice(0, 8)} · 包名 ${build.package_name}，完成后可下载 APK。`;
        await load();
        clearTimeout(timer);
        if (!disposed) timer = setTimeout(poll, 2000);
    } catch (e) {
        error.value = e.message;
        if (e.status && e.status < 500) submission = null;
    } finally {
        busy.value = false;
    }
}
async function copy(build) {
    copyLink.value = new URL(build.downloadUrl, location.origin).href;
    try {
        await navigator.clipboard.writeText(copyLink.value);
        notice.value = '下载链接已复制（需登录当前后台）';
    } catch {
        notice.value = '请选中下方下载链接手动复制';
    }
}
onMounted(async () => {
    try {
        catalog.value = await api('/api/build-templates');
        form.templateId = catalog.value.templates[0]?.id || '';
    } catch (e) {
        error.value = e.message;
    }
    if (!disposed) poll();
});
onBeforeUnmount(() => {
    disposed = true;
    clearTimeout(timer);
    controller?.abort();
});
</script>
<template>
    <div class="settings-page build-center">
        <div class="page-title-row">
            <div>
                <small>WORKSPACE / BUILDS</small>
                <h1>构建中心</h1>
            </div>
            <button class="btn" @click="refresh">刷新记录</button>
        </div>
        <div v-if="error" role="alert" class="alert alert-danger">{{ error }}</div>
        <p v-if="notice" role="status" class="alert alert-success">{{ notice }}</p>
        <label v-if="copyLink" class="mb-3 d-block"
            >下载链接（需登录）<input
                class="form-control"
                readonly
                :value="copyLink"
                @focus="$event.target.select()"
        /></label>
        <form class="card card-body mb-3" aria-label="APK 构建配置" @submit.prevent="submit">
            <div class="build-section-heading">
                <h2>创建 APK</h2>
                <small>{{
                    result?.worker.message || catalog?.worker.message || '读取工具链状态…'
                }}</small>
            </div>
            <fieldset :disabled="busy" class="build-fields">
                <label
                    >模板版本<select class="form-select" v-model="form.templateId" required>
                        <option value="" disabled>选择模板</option>
                        <option v-for="t in catalog?.templates" :key="t.id" :value="t.id">
                            {{ t.name }}
                        </option>
                    </select></label
                >
                <label
                    >后台域名<input
                        class="form-control"
                        v-model="form.domain"
                        required
                        maxlength="255"
                        list="build-domains"
                        placeholder="local 或 https://后台域名"
                    /><datalist id="build-domains">
                        <option value="local">本机 {{ catalog?.localOrigin }}</option>
                    </datalist></label
                >
                <label
                    >APP 名称<input
                        class="form-control"
                        v-model="form.appName"
                        required
                        maxlength="80"
                        placeholder="例如 Rivo TV"
                /></label>
                <label
                    >首页网址<input
                        class="form-control"
                        v-model="form.homeUrl"
                        required
                        type="url"
                        maxlength="2048"
                        placeholder="https://www.reelshort.com"
                /></label>
                <label
                    >APK ID<input
                        class="form-control"
                        v-model="form.apkId"
                        required
                        maxlength="64"
                        pattern="[A-Za-z0-9_-]+"
                        placeholder="例如 10074"
                /></label>
                <label
                    >批次（选填）<input
                        class="form-control"
                        v-model="form.batch"
                        maxlength="80"
                        placeholder="不填即无批次"
                /></label>
                <label class="build-package"
                    >包名（留空自动生成）<span class="input-group"
                        ><input
                            class="form-control"
                            v-model="form.packageName"
                            maxlength="180"
                            placeholder="org.helper.scannertask"
                        /><button type="button" class="btn" @click="randomPackage">
                            随机生成
                        </button></span
                    ></label
                >
            </fieldset>
            <div class="build-template-note">
                <strong>{{ selected?.description }}</strong
                ><span v-if="selected"
                    >源码：android/apk-templates/{{ selected.sourceDir }}/ · APK 版本：{{
                        selected.versionName
                    }}（{{ selected.versionCode }}）</span
                >
            </div>
            <div class="build-submit">
                <p>
                    APK ID 首次配置归属当前超管；已有归属保持不变。后台地址与首页分开；local
                    用于本机 USB 联调。构建使用固定图标、开发签名，不自动安装。
                </p>
                <button
                    class="btn btn-primary"
                    :disabled="busy || !catalog?.worker.ready || !form.templateId"
                >
                    {{ busy ? '正在提交…' : '开始构建' }}
                </button>
            </div>
        </form>
        <div class="card mb-3">
            <div class="card-header">
                <h2 class="card-title">构建记录</h2>
                <small class="ms-auto">自动刷新 · 完成后开放下载 · 链接需登录</small>
            </div>
            <table class="table table-vcenter build-table">
                <thead>
                    <tr>
                        <th>应用 / 构建 ID</th>
                        <th>模板 / 配置</th>
                        <th>状态</th>
                        <th>时间 / 大小</th>
                        <th>产物</th>
                    </tr>
                </thead>
                <tbody>
                    <tr v-for="build in result?.data" :key="build.id" :data-build-id="build.id">
                        <td>
                            <strong>{{ build.app_name }}</strong
                            ><small class="d-block text-muted">{{ build.id.slice(0, 8) }}</small
                            ><code>{{ build.package_name || '历史记录' }}</code>
                        </td>
                        <td>
                            <span>{{ build.template_name || '历史模板' }}</span
                            ><small class="d-block"
                                >域名：{{ build.domain || '—' }} · APK ID：{{
                                    build.apk_id || '—'
                                }}</small
                            ><small class="d-block">批次：{{ build.batch || '无' }}</small>
                        </td>
                        <td>
                            <span
                                class="badge"
                                :class="
                                    build.status === 'failed'
                                        ? 'bg-red-lt'
                                        : build.status === 'succeeded'
                                          ? 'bg-green-lt'
                                          : 'bg-blue-lt'
                                "
                                >{{ statuses[build.stage || build.status] || build.status }}</span
                            ><small v-if="build.error_message" class="build-error">{{
                                build.error_message
                            }}</small
                            ><small
                                v-if="build.status === 'succeeded' && !build.artifactAvailable"
                                class="build-error"
                                >文件缺失</small
                            >
                        </td>
                        <td>
                            <small>{{ formatDate(build.created_at) }}</small
                            ><small class="d-block text-muted">{{
                                build.size ? `${(build.size / 1024 / 1024).toFixed(2)} MB` : '—'
                            }}</small>
                        </td>
                        <td>
                            <div v-if="build.artifactAvailable" class="build-artifact-actions">
                                <a class="btn btn-sm" :href="build.downloadUrl">下载 APK</a
                                ><button class="btn btn-sm" @click="copy(build)">复制链接</button>
                            </div>
                            <span v-else class="text-muted">{{
                                build.status === 'failed' ? '调整配置后重新构建' : '等待产物'
                            }}</span>
                            <details v-if="build.sha256" class="build-hash">
                                <summary>SHA-256</summary>
                                <code>{{ build.sha256 }}</code>
                            </details>
                        </td>
                    </tr>
                    <tr v-if="!result?.data.length">
                        <td colspan="5" class="empty-state">暂无构建记录</td>
                    </tr>
                </tbody>
            </table>
        </div>
        <div class="page-actions mb-3">
            <button
                class="btn"
                :disabled="page <= 1"
                @click="
                    page--;
                    load();
                "
            >
                上一页</button
            ><span>第 {{ page }} 页 · {{ result?.total ?? 0 }} 条</span
            ><button
                class="btn"
                :disabled="page * 20 >= (result?.total ?? 0)"
                @click="
                    page++;
                    load();
                "
            >
                下一页
            </button>
        </div>
        <DeviceEnrollment :key="enrollmentKey" />
    </div>
</template>
<style scoped>
.build-fields {
    border: 0;
    padding: 0;
    margin: 0;
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    gap: 14px 18px;
}
.build-fields label {
    font-size: 12px;
    display: grid;
    gap: 6px;
}
.build-fields .form-control,
.build-fields .form-select {
    font-size: 12px;
}
.build-package {
    grid-column: span 2;
}
.build-section-heading,
.build-submit {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 24px;
}
.build-section-heading {
    margin-bottom: 16px;
}
.build-section-heading h2 {
    font-size: 16px;
    margin: 0;
}
.build-section-heading small {
    color: var(--lab-muted);
}
.build-template-note {
    display: flex;
    gap: 18px;
    font-size: 11px;
    margin: 14px 0;
    color: var(--lab-muted);
}
.build-template-note strong {
    font-weight: 500;
}
.build-submit {
    border-top: 1px solid var(--lab-line);
    padding-top: 14px;
}
.build-submit p {
    font-size: 11px;
    margin: 0;
    max-width: 780px;
    color: var(--lab-muted);
}
.build-submit .btn {
    white-space: nowrap;
}
.build-table td {
    max-width: 320px;
    overflow-wrap: anywhere;
}
.build-table small {
    font-size: 10px;
}
.build-table code {
    font-size: 10px;
}
.build-artifact-actions {
    display: flex;
    gap: 6px;
}
.build-error {
    display: block;
    color: #b42318;
    max-width: 220px;
    margin-top: 6px;
}
.build-hash {
    font-size: 10px;
    max-width: 190px;
    margin-top: 8px;
}
</style>
