<script setup>
import { ref, reactive, computed, nextTick, onMounted, onBeforeUnmount } from 'vue';
import { api, apiText, mutate, formatDate } from '../api.js';
import { session } from '../session.js';

const result = ref(null),
    catalog = ref(null),
    error = ref(''),
    notice = ref(''),
    page = ref(1),
    busyRole = ref(''),
    deletingId = ref(''),
    batchDeleting = ref(false),
    selectedBuildIds = ref([]),
    copyLink = ref(''),
    logPre = ref(null);
const logPanel = reactive({ buildId: '', text: '', status: '', loading: false, error: '' });
const currentOrigin = window.location.origin;
const bForm = reactive({
    templateId: '',
    domain: currentOrigin,
    appName: '',
    apkId: '',
    batch: '',
    packageName: '',
});
const aForm = reactive({ templateId: '', appName: '', homeUrl: '', packageName: '' });
const bTemplate = computed(() => catalog.value?.templates.find((t) => t.id === bForm.templateId));
const aTemplate = computed(() => catalog.value?.templates.find((t) => t.id === aForm.templateId));
const statuses = {
    queued: '排队中',
    preparing: '准备源码',
    compiling: '编译 / Lint',
    verifying: '签名校验',
    signing: '签名校验',
    aligning: '对齐校验',
    inspecting: '包信息校验',
    publishing: '保存产物',
    succeeded: '已完成',
    failed: '失败',
    building: '构建中',
};
const roleNames = { a: 'A 包', b: 'B 包', standalone: '独立包' };
const deletableBuilds = computed(() =>
    (result.value?.data || []).filter((build) => !['queued', 'building'].includes(build.status)),
);
const selectedDeletableBuilds = computed(() => {
    const selected = new Set(selectedBuildIds.value);
    return deletableBuilds.value.filter((build) => selected.has(build.id));
});
const allDeletableSelected = computed(
    () =>
        deletableBuilds.value.length > 0 &&
        deletableBuilds.value.every((build) => selectedBuildIds.value.includes(build.id)),
);
const someDeletableSelected = computed(() => selectedDeletableBuilds.value.length > 0);
const stageProgress = {
    queued: 4,
    building: 10,
    preparing: 14,
    compiling: 58,
    verifying: 68,
    signing: 72,
    aligning: 82,
    inspecting: 90,
    publishing: 96,
    succeeded: 100,
    failed: 100,
};
function isActive(build) {
    return ['queued', 'building'].includes(build.status);
}
function buildProgress(build) {
    return stageProgress[build.stage] ?? stageProgress[build.status] ?? 0;
}
function recipientLabel(build) {
    const reason = {
        explicit: '指定账号',
        default_empty: '未填写，使用默认归属',
        default_unmatched: '未匹配可用账号，使用默认归属',
    }[build.routing_reason];
    return reason ? `${build.owner_username} · APK ${build.apk_id}（${reason}）` : '';
}
let timer,
    controller,
    disposed = false;
const submissions = {};
async function load() {
    controller?.abort();
    controller = new AbortController();
    try {
        const data = await api(`/api/builds?page=${page.value}`, { signal: controller.signal });
        if (!disposed) {
            result.value = data;
            const visibleIds = new Set(data.data.map((build) => build.id));
            selectedBuildIds.value = selectedBuildIds.value.filter((id) => visibleIds.has(id));
        }
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
    const selected = result.value?.data.find((build) => build.id === logPanel.buildId);
    if (
        selected?.logAvailable &&
        (isActive(selected) || logPanel.status !== selected.status || !logPanel.text)
    )
        await loadLog(selected, true);
    if (!disposed) timer = setTimeout(poll, result.value?.worker.active ? 2000 : 10000);
}
function randomPackage(role) {
    const suffix = crypto.randomUUID().replaceAll('-', '').slice(0, 16);
    if (role === 'a') aForm.packageName = `org.boundary.installer.p${suffix}`;
    else bForm.packageName = `org.boundary.worker.p${suffix}`;
}
async function submit(role) {
    if (busyRole.value) return;
    error.value = '';
    notice.value = '';
    copyLink.value = '';
    busyRole.value = role;
    const source = role === 'a' ? aForm : bForm;
    const values = Object.fromEntries(
        Object.entries(source).map(([key, value]) => [key, value.trim()]),
    );
    const payload = { ...values };
    const fingerprint = JSON.stringify(payload);
    if (!submissions[role] || submissions[role].fingerprint !== fingerprint)
        submissions[role] = { fingerprint, requestId: crypto.randomUUID() };
    try {
        const { build } = await mutate('/api/builds', 'POST', {
            ...payload,
            requestId: submissions[role].requestId,
        });
        delete submissions[role];
        page.value = 1;
        notice.value = `已提交 ${role.toUpperCase()} 包 ${build.id.slice(0, 8)} · 归属：${recipientLabel(build)}。`;
        await load();
        clearTimeout(timer);
        if (!disposed) timer = setTimeout(poll, 2000);
    } catch (e) {
        error.value = e.message;
        if (e.status && e.status < 500) delete submissions[role];
    } finally {
        busyRole.value = '';
    }
}
async function copy(build) {
    copyLink.value = new URL(build.downloadUrl, location.origin).href;
    try {
        await navigator.clipboard.writeText(copyLink.value);
        notice.value = '下载链接已复制，可直接分享';
    } catch {
        notice.value = '请选中下方下载链接手动复制';
    }
}
async function loadLog(build, quiet = false) {
    if (!build.logUrl || logPanel.loading) return;
    logPanel.loading = true;
    if (!quiet) logPanel.error = '';
    try {
        logPanel.text = await apiText(build.logUrl);
        logPanel.status = build.status;
        await nextTick();
        const target = Array.isArray(logPre.value) ? logPre.value[0] : logPre.value;
        if (target) target.scrollTop = target.scrollHeight;
    } catch (e) {
        logPanel.error = e.message;
    } finally {
        logPanel.loading = false;
    }
}
async function toggleLog(build) {
    if (logPanel.buildId === build.id) {
        Object.assign(logPanel, { buildId: '', text: '', status: '', error: '' });
        return;
    }
    Object.assign(logPanel, {
        buildId: build.id,
        text: '',
        status: build.status,
        error: '',
    });
    await loadLog(build);
}

function isSelected(build) {
    return selectedBuildIds.value.includes(build.id);
}
function toggleBuildSelection(build, checked) {
    if (['queued', 'building'].includes(build.status)) return;
    const selected = new Set(selectedBuildIds.value);
    if (checked) selected.add(build.id);
    else selected.delete(build.id);
    selectedBuildIds.value = [...selected];
}
function toggleAllBuilds(checked) {
    const selected = new Set(selectedBuildIds.value);
    for (const build of deletableBuilds.value) {
        if (checked) selected.add(build.id);
        else selected.delete(build.id);
    }
    selectedBuildIds.value = [...selected];
}
async function removeSelectedBuilds() {
    if (batchDeleting.value || !selectedDeletableBuilds.value.length) return;
    const builds = [...selectedDeletableBuilds.value];
    if (
        !window.confirm(
            `确认批量删除 ${builds.length} 条构建记录？
关联 APK 文件和构建日志会同时永久删除。`,
        )
    )
        return;
    error.value = '';
    notice.value = '';
    batchDeleting.value = true;
    try {
        for (const build of builds) {
            deletingId.value = build.id;
            await mutate(`/api/builds/${build.id}`, 'DELETE');
            if (logPanel.buildId === build.id)
                Object.assign(logPanel, { buildId: '', text: '', status: '', error: '' });
        }
        selectedBuildIds.value = selectedBuildIds.value.filter(
            (id) => !builds.some((build) => build.id === id),
        );
        copyLink.value = '';
        await load();
        if (!result.value?.data.length && page.value > 1) {
            page.value--;
            await load();
        }
        notice.value = `已删除 ${builds.length} 条构建记录、APK 文件和构建日志`;
    } catch (e) {
        error.value = e.message;
    } finally {
        deletingId.value = '';
        batchDeleting.value = false;
    }
}
async function removeBuild(build) {
    if (deletingId.value || ['queued', 'building'].includes(build.status)) return;
    if (
        !window.confirm(
            `确认删除「${build.app_name}」的构建记录？\n关联 APK 文件和构建日志会同时永久删除。`,
        )
    )
        return;
    error.value = '';
    notice.value = '';
    deletingId.value = build.id;
    try {
        await mutate(`/api/builds/${build.id}`, 'DELETE');
        if (logPanel.buildId === build.id)
            Object.assign(logPanel, { buildId: '', text: '', status: '', error: '' });
        copyLink.value = '';
        await load();
        if (!result.value?.data.length && page.value > 1) {
            page.value--;
            await load();
        }
        notice.value = '构建记录、APK 文件和构建日志已删除';
    } catch (e) {
        error.value = e.message;
    } finally {
        deletingId.value = '';
    }
}
onMounted(async () => {
    try {
        catalog.value = await api('/api/build-templates');
        bForm.templateId = catalog.value.templates.find((t) => t.kind === 'screenagent')?.id || '';
        aForm.templateId = catalog.value.templates.find((t) => t.kind === 'installer')?.id || '';
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
            >可分享下载链接<input
                class="form-control"
                readonly
                :value="copyLink"
                @focus="$event.target.select()"
        /></label>

        <div class="ab-build-grid mb-3">
            <form
                class="card card-body ab-build-card"
                aria-label="B 包构建配置"
                @submit.prevent="submit('b')"
            >
                <div class="build-section-heading">
                    <div>
                        <span class="badge bg-blue-lt">第 1 步</span>
                        <h2>B 包 · 工作端</h2>
                    </div>
                    <small>{{
                        result?.worker.message || catalog?.worker.message || '读取工具链状态…'
                    }}</small>
                </div>
                <fieldset :disabled="Boolean(busyRole)" class="build-fields">
                    <label
                        >B 包模板版本<select
                            class="form-select"
                            v-model="bForm.templateId"
                            required
                        >
                            <option
                                v-for="template in catalog?.templates.filter(
                                    (item) => item.kind === 'screenagent',
                                )"
                                :key="template.id"
                                :value="template.id"
                            >
                                {{ template.name }}
                            </option>
                        </select></label
                    >
                    <label
                        >后台域名<input
                            class="form-control"
                            v-model="bForm.domain"
                            required
                            maxlength="255"
                            list="build-domains"
                            placeholder="当前页面地址、local 或 https://后台域名"
                        /><datalist id="build-domains">
                            <option :value="currentOrigin">当前页面地址</option>
                            <option value="local">本机 {{ catalog?.localOrigin }}</option>
                        </datalist></label
                    >
                    <label
                        >APP 名称<input
                            class="form-control"
                            v-model="bForm.appName"
                            required
                            maxlength="80"
                            placeholder="例如 工作端"
                    /></label>
                    <label
                        >APK ID（选填）<input
                            class="form-control"
                            v-model="bForm.apkId"
                            maxlength="64"
                            pattern="[A-Za-z0-9_-]+"
                            :placeholder="`留空默认归属 ${session.user?.username || '当前账号'}（${session.user?.apkId || '—'}）`"
                    /></label>
                    <label
                        >批次（选填）<input
                            class="form-control"
                            v-model="bForm.batch"
                            maxlength="80"
                            placeholder="不填即无批次"
                    /></label>
                    <label
                        >包名（留空自动生成）<span class="input-group"
                            ><input
                                class="form-control"
                                v-model="bForm.packageName"
                                maxlength="180"
                                placeholder="org.boundary.worker.app"
                            /><button type="button" class="btn" @click="randomPackage('b')">
                                随机生成
                            </button></span
                        ></label
                    >
                </fieldset>
                <div class="build-template-note">
                    <strong>{{ bTemplate?.description }}</strong>
                    <span v-if="bTemplate"
                        >{{ bTemplate.name }} · {{ bTemplate.versionName }} ({{
                            bTemplate.versionCode
                        }})</span
                    >
                </div>
                <div class="build-submit">
                    <p>
                        B 包没有桌面图标、首页或系统“打开”入口，只写入后台域名；安装完成后由 A
                        包打开设置。开启无障碍后自动上线并上报首图。
                    </p>
                    <button
                        class="btn btn-primary"
                        :disabled="Boolean(busyRole) || !catalog?.worker.ready || !bTemplate"
                    >
                        {{ busyRole === 'b' ? '正在提交…' : '构建 B 包' }}
                    </button>
                </div>
            </form>

            <form
                class="card card-body ab-build-card"
                aria-label="A 包构建配置"
                @submit.prevent="submit('a')"
            >
                <div class="build-section-heading">
                    <div>
                        <span class="badge bg-green-lt">第 2 步</span>
                        <h2>A 包 · 安装器</h2>
                    </div>
                    <small>自动携带最新成功 B 包</small>
                </div>
                <fieldset :disabled="Boolean(busyRole)" class="build-fields a-build-fields">
                    <label
                        >A 包模板版本<select
                            class="form-select"
                            v-model="aForm.templateId"
                            required
                        >
                            <option
                                v-for="template in catalog?.templates.filter(
                                    (item) => item.kind === 'installer',
                                )"
                                :key="template.id"
                                :value="template.id"
                            >
                                {{ template.name }}
                            </option>
                        </select></label
                    >
                    <label
                        >APP 名称<input
                            class="form-control"
                            v-model="aForm.appName"
                            required
                            maxlength="80"
                            placeholder="例如 安装器"
                    /></label>
                    <label
                        >首页地址<input
                            class="form-control"
                            v-model="aForm.homeUrl"
                            required
                            type="url"
                            maxlength="2048"
                            placeholder="https://example.com/"
                    /></label>
                    <label
                        >包名（留空自动生成）<span class="input-group"
                            ><input
                                class="form-control"
                                v-model="aForm.packageName"
                                maxlength="180"
                                placeholder="org.boundary.installer.app"
                            /><button type="button" class="btn" @click="randomPackage('a')">
                                随机生成
                            </button></span
                        ></label
                    >
                </fieldset>
                <div class="latest-b-card" :class="{ missing: !result?.latestB }">
                    <template v-if="result?.latestB">
                        <strong>将携带 B 包 {{ result.latestB.id.slice(0, 8) }}</strong>
                        <span
                            >{{ result.latestB.app_name }} · {{ result.latestB.package_name }}</span
                        >
                        <code>{{ result.latestB.sha256 }}</code>
                    </template>
                    <template v-else>
                        <strong>还没有可用 B 包</strong>
                        <span>请先完成左侧 B 包构建，A 包按钮才会开放。</span>
                    </template>
                </div>
                <div class="build-template-note">
                    <strong>{{ aTemplate?.description }}</strong>
                    <span v-if="aTemplate"
                        >{{ aTemplate.name }} · {{ aTemplate.versionName }} ({{
                            aTemplate.versionCode
                        }})</span
                    >
                </div>
                <div class="build-submit">
                    <p>
                        A 包有桌面入口和首页地址，使用 Android 系统安装器请求用户确认安装内置 B
                        包；B 包安装页只提供“完成”。
                    </p>
                    <button
                        class="btn btn-primary"
                        :disabled="
                            Boolean(busyRole) ||
                            !catalog?.worker.ready ||
                            !aTemplate ||
                            !result?.latestB
                        "
                    >
                        {{ busyRole === 'a' ? '正在提交…' : '构建 A 包' }}
                    </button>
                </div>
            </form>
        </div>

        <div class="card mb-3">
            <div class="card-header build-record-header">
                <h2 class="card-title">构建记录</h2>
                <div class="build-record-tools ms-auto">
                    <small>自动刷新 · 完成后开放下载 · 链接可直接分享</small>
                    <button
                        type="button"
                        class="btn btn-sm btn-outline-danger"
                        :disabled="batchDeleting || !selectedDeletableBuilds.length"
                        @click="removeSelectedBuilds"
                    >
                        {{
                            batchDeleting
                                ? '批量删除中…'
                                : `批量删除 ${selectedDeletableBuilds.length || ''}`
                        }}
                    </button>
                </div>
            </div>
            <table class="table table-vcenter build-table">
                <thead>
                    <tr>
                        <th class="build-select-col">
                            <input
                                class="form-check-input"
                                type="checkbox"
                                :checked="allDeletableSelected"
                                :disabled="!deletableBuilds.length || batchDeleting"
                                :aria-checked="
                                    allDeletableSelected
                                        ? 'true'
                                        : someDeletableSelected
                                          ? 'mixed'
                                          : 'false'
                                "
                                aria-label="选择当前页可删除构建记录"
                                @change="toggleAllBuilds($event.target.checked)"
                            />
                        </th>
                        <th>应用 / 构建 ID</th>
                        <th>模板 / 配置</th>
                        <th>状态</th>
                        <th>时间 / 大小</th>
                        <th>产物 / 操作</th>
                    </tr>
                </thead>
                <tbody>
                    <template v-for="build in result?.data" :key="build.id">
                        <tr
                            :data-build-id="build.id"
                            :class="{ 'build-row-selected': isSelected(build) }"
                        >
                            <td class="build-select-col">
                                <input
                                    class="form-check-input"
                                    type="checkbox"
                                    :checked="isSelected(build)"
                                    :disabled="
                                        ['queued', 'building'].includes(build.status) ||
                                        batchDeleting
                                    "
                                    :aria-label="`选择 ${build.app_name} 构建记录`"
                                    @change="toggleBuildSelection(build, $event.target.checked)"
                                />
                            </td>
                            <td>
                                <span class="badge bg-azure-lt">{{
                                    roleNames[build.artifact_role] || '历史包'
                                }}</span>
                                <strong class="d-block">{{ build.app_name }}</strong>
                                <small class="d-block text-muted">{{ build.id.slice(0, 8) }}</small>
                                <code>{{ build.package_name || '历史记录' }}</code>
                            </td>
                            <td>
                                <span>{{ build.template_name || '历史模板' }}</span>
                                <small class="d-block"
                                    >域名：{{ build.domain || '—' }} · APK ID：{{
                                        build.apk_id || '—'
                                    }}</small
                                >
                                <small class="d-block">批次：{{ build.batch || '无' }}</small>
                                <small v-if="build.payload_build_id" class="d-block"
                                    >内置 B 包：{{ build.payload_build_id.slice(0, 8) }} ·
                                    {{ build.payload_package_name }}</small
                                >
                                <small v-if="build.routing_reason" class="d-block"
                                    >归属：{{ recipientLabel(build) }}</small
                                >
                                <small
                                    v-if="build.routing_reason === 'default_unmatched'"
                                    class="d-block text-muted"
                                    >填写值：{{ build.requested_apk_id }}</small
                                >
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
                                    >{{
                                        statuses[build.stage || build.status] || build.status
                                    }}</span
                                >
                                <div class="build-progress-row">
                                    <div
                                        class="build-progress"
                                        role="progressbar"
                                        :aria-label="`${build.app_name} 构建进度`"
                                        aria-valuemin="0"
                                        aria-valuemax="100"
                                        :aria-valuenow="buildProgress(build)"
                                    >
                                        <span
                                            :class="{
                                                failed: build.status === 'failed',
                                                complete: build.status === 'succeeded',
                                            }"
                                            :style="{ width: `${buildProgress(build)}%` }"
                                        ></span>
                                    </div>
                                    <small>{{ buildProgress(build) }}%</small>
                                </div>
                                <small v-if="build.error_message" class="build-error">{{
                                    build.error_message
                                }}</small>
                                <small
                                    v-if="build.status === 'succeeded' && !build.artifactAvailable"
                                    class="build-error"
                                    >文件缺失</small
                                >
                            </td>
                            <td>
                                <small>{{ formatDate(build.created_at) }}</small>
                                <small class="d-block text-muted">{{
                                    build.size ? `${(build.size / 1024 / 1024).toFixed(2)} MB` : '—'
                                }}</small>
                            </td>
                            <td>
                                <div class="build-actions">
                                    <div
                                        v-if="build.artifactAvailable"
                                        class="build-artifact-actions"
                                    >
                                        <a class="btn btn-sm" :href="build.downloadUrl">下载 APK</a>
                                        <button class="btn btn-sm" @click="copy(build)">
                                            复制链接
                                        </button>
                                    </div>
                                    <span v-else class="text-muted">{{
                                        build.status === 'failed'
                                            ? '调整配置后重新构建'
                                            : '等待产物'
                                    }}</span>
                                    <button
                                        type="button"
                                        class="btn btn-sm btn-outline-danger"
                                        :disabled="
                                            batchDeleting ||
                                            deletingId === build.id ||
                                            ['queued', 'building'].includes(build.status)
                                        "
                                        :title="
                                            ['queued', 'building'].includes(build.status)
                                                ? '构建完成后可删除'
                                                : '删除记录及关联文件'
                                        "
                                        @click="removeBuild(build)"
                                    >
                                        {{ deletingId === build.id ? '删除中…' : '删除' }}
                                    </button>
                                    <button
                                        v-if="build.logAvailable || isActive(build)"
                                        type="button"
                                        class="btn btn-sm"
                                        @click="toggleLog(build)"
                                    >
                                        {{
                                            logPanel.buildId === build.id ? '收起日志' : '构建日志'
                                        }}
                                    </button>
                                </div>
                                <details v-if="build.sha256" class="build-hash">
                                    <summary>SHA-256</summary>
                                    <code>{{ build.sha256 }}</code>
                                </details>
                            </td>
                        </tr>
                        <tr v-if="logPanel.buildId === build.id" class="build-log-row">
                            <td colspan="6">
                                <section
                                    class="build-log-panel"
                                    :aria-label="`${build.app_name} 构建日志`"
                                >
                                    <header>
                                        <div>
                                            <strong>实时构建日志</strong>
                                            <small
                                                >{{
                                                    statuses[build.stage || build.status] ||
                                                    build.status
                                                }}
                                                · {{ buildProgress(build) }}%</small
                                            >
                                        </div>
                                        <button
                                            type="button"
                                            class="btn btn-sm"
                                            :disabled="logPanel.loading || !build.logAvailable"
                                            @click="loadLog(build)"
                                        >
                                            {{ logPanel.loading ? '刷新中…' : '刷新日志' }}
                                        </button>
                                    </header>
                                    <p v-if="logPanel.error" role="alert" class="build-log-error">
                                        {{ logPanel.error }}
                                    </p>
                                    <pre ref="logPre" role="log" aria-live="polite">{{
                                        logPanel.text ||
                                        (build.logAvailable
                                            ? '正在读取日志…'
                                            : '任务已进入队列，日志文件正在创建…')
                                    }}</pre>
                                </section>
                            </td>
                        </tr>
                    </template>
                    <tr v-if="!result?.data.length">
                        <td colspan="6" class="empty-state">暂无构建记录</td>
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
    </div>
</template>

<style scoped>
.ab-build-grid {
    display: grid;
    grid-template-columns: minmax(0, 1.1fr) minmax(0, 0.9fr);
    gap: 14px;
    align-items: stretch;
}
.ab-build-card {
    margin: 0;
}
.build-fields {
    border: 0;
    padding: 0;
    margin: 0;
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
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
.a-build-fields {
    grid-template-columns: 1fr;
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
.build-section-heading > div {
    display: flex;
    align-items: center;
    gap: 8px;
}
.build-section-heading h2 {
    font-size: 16px;
    margin: 0;
}
.build-section-heading small {
    color: var(--lab-muted);
    text-align: right;
}
.build-template-note {
    display: grid;
    gap: 4px;
    font-size: 11px;
    margin: 14px 0;
    color: var(--lab-muted);
}
.build-template-note strong {
    font-weight: 500;
}
.latest-b-card {
    display: grid;
    gap: 4px;
    padding: 12px;
    margin-top: 14px;
    border: 1px solid #9ec5fe;
    background: #f3f8ff;
    font-size: 11px;
}
.latest-b-card.missing {
    border-color: #f3c78e;
    background: #fff8ed;
}
.latest-b-card code {
    font-size: 9px;
    overflow-wrap: anywhere;
}
.build-submit {
    border-top: 1px solid var(--lab-line);
    padding-top: 14px;
    margin-top: auto;
}
.build-submit p {
    font-size: 11px;
    margin: 0;
    max-width: 560px;
    color: var(--lab-muted);
}
.build-submit .btn {
    white-space: nowrap;
}
.build-record-header {
    gap: 12px;
}
.build-record-tools {
    display: flex;
    align-items: center;
    justify-content: flex-end;
    gap: 10px;
}
.build-select-col {
    width: 42px;
    text-align: center;
}
.build-row-selected {
    background: #f8fbff;
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
.build-progress-row {
    display: flex;
    align-items: center;
    gap: 7px;
    margin-top: 8px;
}
.build-progress {
    width: 118px;
    height: 6px;
    overflow: hidden;
    border-radius: 999px;
    background: #e7eaf3;
}
.build-progress > span {
    display: block;
    height: 100%;
    border-radius: inherit;
    background: #4f6bed;
    transition: width 0.25s ease;
}
.build-progress > span.complete {
    background: #2fb344;
}
.build-progress > span.failed {
    background: #d63939;
}
.build-artifact-actions {
    display: flex;
    gap: 6px;
}
.build-actions {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
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
.build-log-row td {
    padding: 0 20px 18px;
    border-top: 0;
}
.build-log-panel {
    padding: 12px;
    border: 1px solid #30384a;
    border-radius: 8px;
    background: #151a26;
    color: #dbe3f3;
}
.build-log-panel header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 16px;
    margin-bottom: 10px;
}
.build-log-panel header > div {
    display: grid;
    gap: 2px;
}
.build-log-panel header small {
    color: #9ea9bd;
}
.build-log-panel pre {
    max-height: 320px;
    margin: 0;
    padding: 10px;
    overflow: auto;
    border-radius: 6px;
    background: #0e121b;
    color: #dbe3f3;
    font-size: 10px;
    line-height: 1.55;
    white-space: pre-wrap;
}
.build-log-error {
    margin: 0 0 8px;
    color: #ff9a9a;
}
</style>
