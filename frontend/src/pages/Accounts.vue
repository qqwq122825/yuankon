<script setup>
import { ref, computed, watch, nextTick } from 'vue';
import { useRoute } from 'vue-router';
import { api, mutate, formatDate } from '../api.js';
import { session } from '../session.js';
import { roleLabel, validityDisplay } from '../account-display.js';
import SortHeading from '../components/SortHeading.vue';
const route = useRoute();
const result = ref(null),
    error = ref(''),
    notice = ref(''),
    busy = ref(false),
    q = ref(''),
    page = ref(1),
    sort = ref('createdAt'),
    direction = ref('desc');
const parentId = computed(() => Number(route.params.studioAccountId) || null);
const members = computed(() => session.user.role === 'studio_admin' || Boolean(parentId.value));
const dialog = ref(null),
    opener = ref(null),
    mode = ref(''),
    target = ref(null);
const form = ref({}),
    requestId = ref('');
const dateValue = (value) =>
    value
        ? new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Shanghai' }).format(
              new Date(value - 1),
          )
        : '';
function toDeadline(date) {
    return date ? Date.parse(`${date}T00:00:00+08:00`) + 86400000 : null;
}
async function load() {
    error.value = '';
    try {
        const params = new URLSearchParams({
            q: q.value,
            page: page.value,
            sort: sort.value,
            direction: direction.value,
        });
        if (parentId.value) params.set('parentId', parentId.value);
        result.value = await api(`/api/accounts?${params}`);
    } catch (e) {
        error.value = e.message;
    }
}
watch(
    () => route.path,
    () => {
        page.value = 1;
        q.value = '';
        result.value = null;
        load();
    },
    { immediate: true },
);
function sortBy(field) {
    direction.value = sort.value === field && direction.value === 'asc' ? 'desc' : 'asc';
    sort.value = field;
    page.value = 1;
    load();
}
async function open(action, row, event) {
    mode.value = action;
    target.value = row;
    opener.value = event.currentTarget;
    error.value = '';
    form.value = {
        username: '',
        password: '',
        confirmPassword: '',
        name: '',
        note: '',
        date: dateValue(row?.ownValidUntil),
        inherit: row ? row.inheritsValidity : members.value,
    };
    requestId.value = crypto.randomUUID();
    await nextTick();
    dialog.value.showModal();
    dialog.value.querySelector('input')?.focus();
}
function close() {
    dialog.value.close();
    form.value = {};
    target.value = null;
    opener.value?.focus();
}
async function submit() {
    busy.value = true;
    error.value = '';
    try {
        let account;
        const validUntil = members.value && form.value.inherit ? null : toDeadline(form.value.date);
        if (mode.value === 'create') {
            const endpoint = !members.value
                ? '/api/accounts/studios'
                : parentId.value
                  ? `/api/accounts/studios/${parentId.value}/members`
                  : '/api/accounts/members';
            const body = {
                requestId: requestId.value,
                username: form.value.username,
                password: form.value.password,
                confirmPassword: form.value.confirmPassword,
                validUntil,
                note: form.value.note,
                ...(!members.value ? { name: form.value.name } : {}),
            };
            account = (await mutate(endpoint, 'POST', body)).account;
            notice.value = `已创建 ${account.username} · APK ID ${account.apkId}`;
        } else {
            const body =
                mode.value === 'password'
                    ? { password: form.value.password, confirmPassword: form.value.confirmPassword }
                    : { validUntil };
            account = (
                await mutate(
                    `/api/accounts/${target.value.id}/${mode.value}`,
                    mode.value === 'password' ? 'PUT' : 'PATCH',
                    body,
                )
            ).account;
            notice.value = `${account.username}已更新，原登录会话已撤销`;
        }
        close();
        await load();
    } catch (e) {
        error.value = e.message;
    } finally {
        busy.value = false;
    }
}
async function status(row) {
    busy.value = true;
    error.value = '';
    notice.value = '';
    try {
        await mutate(`/api/accounts/${row.id}/status`, 'PATCH', { enabled: !row.enabled });
        notice.value = `${row.username}已${row.enabled ? '停用' : '启用'}`;
        await load();
    } catch (e) {
        error.value = e.message;
    } finally {
        busy.value = false;
    }
}
</script>
<template>
    <div class="settings-page accounts-page">
        <div class="page-title-row">
            <div>
                <small>WORKSPACE / ACCOUNTS</small>
                <h1>{{ members ? '子账号管理' : '总台账号管理' }}</h1>
            </div>
            <div class="page-actions">
                <RouterLink v-if="parentId" to="/accounts" class="btn">返回总台</RouterLink
                ><button
                    class="btn btn-primary"
                    :disabled="busy || (members && result?.enabledMembers >= 5)"
                    @click="open('create', null, $event)"
                >
                    {{ members ? '创建子账号' : '创建总台' }}
                </button>
            </div>
        </div>
        <p v-if="members && result">
            上级总台：{{ result.parent?.username }} ·
            {{ validityDisplay(result.parent?.validUntil).label }} · 已启用
            {{ result.enabledMembers }} / {{ result.memberLimit }}；停用释放名额，账号与记录保留。
        </p>
        <p v-else>超管创建总台；总台管理自己的子账号。用户名和固定 APK ID 创建后保持不变。</p>
        <p class="text-muted">
            总台到期未续费时，本台及子账号的设备自动归超管；历史记录保留，续费不自动归还已接管设备。
        </p>
        <div v-if="error && !dialog?.open" class="alert alert-danger" role="alert">
            {{ error }}<button class="btn" @click="load">重试</button>
        </div>
        <div v-if="notice" class="alert alert-success" role="status">{{ notice }}</div>
        <form
            class="page-actions mb-3"
            @submit.prevent="
                page = 1;
                load();
            "
        >
            <input
                v-model="q"
                class="form-control"
                aria-label="搜索账号"
                placeholder="搜索账号"
                maxlength="100"
            /><button class="btn">搜索</button
            ><button type="button" class="btn" @click="load">刷新</button>
        </form>
        <div class="card">
            <div class="table-responsive">
                <table class="table table-vcenter">
                    <thead>
                        <tr>
                            <SortHeading
                                label="账号"
                                field="username"
                                :sort="sort"
                                :direction="direction"
                                @sort="sortBy"
                            />
                            <SortHeading
                                label="APK ID"
                                field="apkId"
                                :sort="sort"
                                :direction="direction"
                                @sort="sortBy"
                            />
                            <th>{{ members ? '角色' : '总台名称 / 名额' }}</th>
                            <th>状态</th>
                            <SortHeading
                                label="有效期"
                                field="validUntil"
                                :sort="sort"
                                :direction="direction"
                                @sort="sortBy"
                            />
                            <SortHeading
                                label="创建时间"
                                field="createdAt"
                                :sort="sort"
                                :direction="direction"
                                @sort="sortBy"
                            />
                            <th>备注</th>
                            <th>操作</th>
                        </tr>
                    </thead>
                    <tbody>
                        <tr v-for="row in result?.data || []" :key="row.id">
                            <td>{{ row.username }}</td>
                            <td>
                                <code>{{ row.apkId }}</code>
                            </td>
                            <td>
                                {{
                                    members
                                        ? roleLabel(row.role)
                                        : `${row.name} · ${row.enabledMembers} / ${row.memberLimit}`
                                }}
                            </td>
                            <td>{{ row.enabled ? '启用' : '停用' }}</td>
                            <td>
                                {{ validityDisplay(row.validUntil).label
                                }}<small v-if="row.inheritsValidity">（继承总台）</small>
                                <small v-if="row.expiryTakeover" class="d-block text-muted"
                                    >最近到期接管 {{ row.expiryTakeover.deviceCount }} 台 ·
                                    {{ formatDate(row.expiryTakeover.transferredAt) }}</small
                                >
                            </td>
                            <td>{{ formatDate(row.createdAt) }}</td>
                            <td>{{ row.note || '—' }}</td>
                            <td class="account-row-actions">
                                <RouterLink
                                    v-if="!members"
                                    :to="`/accounts/${row.id}/members`"
                                    class="btn btn-sm"
                                    >子账号</RouterLink
                                >
                                <button
                                    class="btn btn-sm"
                                    :disabled="busy"
                                    @click="open('validity', row, $event)"
                                >
                                    期限</button
                                ><button
                                    class="btn btn-sm"
                                    :disabled="busy"
                                    @click="open('password', row, $event)"
                                >
                                    重置密码</button
                                ><button class="btn btn-sm" :disabled="busy" @click="status(row)">
                                    {{ row.enabled ? '停用' : '启用' }}
                                </button>
                            </td>
                        </tr>
                        <tr v-if="result && !result.data.length">
                            <td colspan="8" class="text-center text-muted">
                                暂无{{ members ? '子账号' : '总台账号' }}
                            </td>
                        </tr>
                    </tbody>
                </table>
            </div>
            <div class="card-footer page-actions">
                共 {{ result?.total || 0 }} 个账号 · 第 {{ page }} 页<button
                    class="btn btn-sm"
                    :disabled="page <= 1"
                    @click="
                        page--;
                        load();
                    "
                >
                    上一页</button
                ><button
                    class="btn btn-sm"
                    :disabled="page * 20 >= (result?.total || 0)"
                    @click="
                        page++;
                        load();
                    "
                >
                    下一页
                </button>
            </div>
        </div>
        <dialog
            ref="dialog"
            aria-labelledby="account-dialog-title"
            class="account-dialog"
            @cancel.prevent="!busy && close()"
        >
            <form @submit.prevent="submit" @input="requestId = crypto.randomUUID()">
                <h2 id="account-dialog-title">
                    {{
                        mode === 'create'
                            ? members
                                ? '创建子账号'
                                : '创建总台'
                            : mode === 'password'
                              ? '重置密码'
                              : '修改有效期'
                    }}
                </h2>
                <p v-if="target">{{ target.username }} · APK ID {{ target.apkId }}</p>
                <p v-if="mode === 'validity' && !members" class="text-muted">
                    续期仅恢复账号使用期限；已归超管的设备不会自动归还。
                </p>
                <div v-if="error" class="alert alert-danger" role="alert">{{ error }}</div>
                <template v-if="mode === 'create'"
                    ><label v-if="!members" class="form-label" for="studio-name">总台名称</label
                    ><input
                        v-if="!members"
                        id="studio-name"
                        v-model="form.name"
                        class="form-control mb-3"
                        required
                        maxlength="80" /><label class="form-label" for="account-username"
                        >账号</label
                    ><input
                        id="account-username"
                        v-model="form.username"
                        class="form-control mb-3"
                        required
                        pattern="[a-zA-Z0-9_]{3,32}"
                        autocomplete="off"
                /></template>
                <template v-if="mode === 'create' || mode === 'password'"
                    ><label class="form-label" for="account-password">初始 / 新密码</label
                    ><input
                        id="account-password"
                        v-model="form.password"
                        class="form-control mb-3"
                        type="password"
                        autocomplete="new-password"
                        required
                        minlength="8"
                        maxlength="128" /><label class="form-label" for="account-confirm"
                        >确认密码</label
                    ><input
                        id="account-confirm"
                        v-model="form.confirmPassword"
                        class="form-control mb-3"
                        type="password"
                        autocomplete="new-password"
                        required
                        minlength="8"
                        maxlength="128"
                /></template>
                <template v-if="mode !== 'password'"
                    ><label v-if="members" class="form-check mb-3"
                        ><input
                            v-model="form.inherit"
                            class="form-check-input"
                            type="checkbox"
                        /><span>继承总台有效期</span></label
                    ><template v-if="!members || !form.inherit"
                        ><label class="form-label" for="account-date">到期日（北京时间）</label
                        ><input
                            id="account-date"
                            v-model="form.date"
                            class="form-control mb-3"
                            type="date"
                            required
                            :max="
                                members ? dateValue(result?.parent?.validUntil) : undefined
                            " /></template
                ></template>
                <template v-if="mode === 'create'"
                    ><label class="form-label" for="account-note">备注</label
                    ><input
                        id="account-note"
                        v-model="form.note"
                        class="form-control mb-3"
                        maxlength="200"
                /></template>
                <p class="text-muted">编号自动分配。停用、改密或调整期限会撤销原登录会话。</p>
                <div class="page-actions">
                    <button class="btn btn-primary" :disabled="busy">
                        {{ busy ? '提交中…' : '保存' }}</button
                    ><button type="button" class="btn" :disabled="busy" @click="close">取消</button>
                </div>
            </form>
        </dialog>
    </div>
</template>
<style scoped>
.accounts-page {
    max-width: none;
}
.account-row-actions {
    white-space: nowrap;
}
.account-row-actions .btn {
    margin-right: 4px;
}
.account-dialog {
    width: 460px;
    max-height: calc(100vh - 50px);
    overflow: auto;
    border: 1px solid var(--tblr-border-color);
    border-radius: 8px;
    padding: 24px;
    color: var(--tblr-body-color);
    background: var(--tblr-body-bg);
}
.account-dialog::backdrop {
    background: rgba(0, 0, 0, 0.4);
}
</style>
