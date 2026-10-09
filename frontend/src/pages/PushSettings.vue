<script setup>
import { computed, nextTick, onBeforeUnmount, reactive, ref, watch } from 'vue';
import { session } from '../session.js';

const groups = [
    {
        id: 'security',
        title: '账号安全',
        options: [
            {
                id: 'login',
                title: '登录提醒',
                description: '账号登录时发送状态提醒；不包含验证码或登录凭证。',
                recommended: true,
            },
            {
                id: 'account',
                title: '账号状态变更',
                description: '账号启用、停用或有效期发生变化时，提醒当前账号。',
            },
        ],
    },
    {
        id: 'devices',
        title: '设备状态',
        options: [
            {
                id: 'online',
                title: '设备上线',
                description: '所属测试设备上线时发送设备状态提醒。',
            },
            {
                id: 'offline',
                title: '设备离线',
                description: '所属测试设备离线时发送状态提醒；不附带设备正文。',
            },
        ],
    },
    {
        id: 'tasks',
        title: '构建与任务',
        options: [
            {
                id: 'build-complete',
                title: '构建完成',
                description: '所属 APK 构建任务完成时发送结果摘要。',
            },
            {
                id: 'build-failed',
                title: '构建失败',
                description: '构建任务失败时发送任务编号及状态提醒。',
            },
            {
                id: 'task',
                title: '任务结果',
                description: '所属工作台任务结束时发送完成或失败的状态摘要。',
            },
        ],
    },
    {
        id: 'system',
        title: '系统通知',
        options: [
            {
                id: 'announcement',
                title: '系统公告',
                description: '接收平台维护与配置更新等系统公告。',
            },
        ],
    },
];
const defaults = Object.fromEntries(
    groups.flatMap(({ options }) => options.map(({ id }) => [id, id !== 'offline'])),
);
const preferences = reactive({ ...defaults });
const notice = ref('');
const accountName = computed(() => session.user?.username || '当前账号');
const role = computed(() => session.user?.role || '');
const canManageBots = computed(() => ['superadmin', 'studio_admin'].includes(role.value));
const managedRole = computed(() => (role.value === 'superadmin' ? '总台' : '子台'));
const roleName = computed(() =>
    role.value === 'superadmin' ? '超管' : role.value === 'studio_admin' ? '总台' : '子台',
);
const assignmentDescription = computed(() => {
    if (role.value === 'superadmin')
        return '超管为总台配置专属机器人；总台创建子账号时，可为每个子台预留专属机器人。';
    if (role.value === 'studio_admin')
        return '本总台机器人由超管配置；创建子账号时，可为每个子台预留专属机器人。';
    return '本子台的专属机器人由所属总台配置；新账号需先完成自己的 Telegram 绑定。';
});

const bindingDialog = ref(null);
const botDialog = ref(null);
const telegramUsername = ref('');
const bindingNotice = ref('');
const botNotice = ref('');
const botError = ref('');
const botDraft = reactive({ account: '', name: '', username: '' });
let bindingOpener = null;
let botOpener = null;
const accountKey = () => [session.user?.id, session.user?.username, session.user?.role].join(':');

function restoreDefaults() {
    Object.assign(preferences, defaults);
    notice.value = '已恢复本次预览的默认偏好；未保存到服务器。';
}
function previewSave() {
    notice.value = 'UI 预览：当前偏好仅保留在本页内存中，未实际保存或发送推送。';
}
async function openBinding(event) {
    if (bindingDialog.value?.open || botDialog.value?.open) return;
    const openingAccount = accountKey();
    bindingOpener = event.currentTarget;
    bindingNotice.value = '';
    await nextTick();
    if (!session.user || !bindingDialog.value || openingAccount !== accountKey()) return;
    bindingDialog.value.showModal();
    bindingDialog.value.querySelector('input')?.focus();
}
function closeBinding() {
    const wasOpen = bindingDialog.value?.open;
    bindingDialog.value?.close();
    bindingNotice.value = '';
    telegramUsername.value = '';
    if (wasOpen && bindingOpener?.isConnected) bindingOpener.focus();
}
function previewBinding() {
    if (!session.user) return;
    bindingNotice.value = '绑定流程仅作界面预览；机器人与验证接口待接入，当前账号仍未绑定。';
}
async function openBotConfiguration(event) {
    if (!canManageBots.value || botDialog.value?.open || bindingDialog.value?.open) return;
    const openingAccount = accountKey();
    botOpener = event.currentTarget;
    botError.value = '';
    botNotice.value = '';
    await nextTick();
    if (!canManageBots.value || !botDialog.value || openingAccount !== accountKey()) return;
    botDialog.value.showModal();
    botDialog.value.querySelector('input')?.focus();
}
function closeBotConfiguration() {
    const wasOpen = botDialog.value?.open;
    botDialog.value?.close();
    botError.value = '';
    botNotice.value = '';
    Object.assign(botDraft, { account: '', name: '', username: '' });
    if (wasOpen && canManageBots.value && botOpener?.isConnected) botOpener.focus();
}
function previewBotConfiguration() {
    if (!canManageBots.value) return;
    botError.value = '';
    botNotice.value = '';
    const account = botDraft.account.trim();
    const name = botDraft.name.trim();
    const username = botDraft.username.trim().replace(/^@/, '');
    if (!account || !name || !username) {
        botError.value = '请填写目标账号、机器人名称与机器人用户名。';
        botDialog.value
            ?.querySelector(
                !account ? '#push-bot-account' : !name ? '#push-bot-name' : '#push-bot-username',
            )
            ?.focus();
        return;
    }
    if (!/^[A-Za-z][A-Za-z0-9_]{4,31}$/.test(username)) {
        botError.value = '机器人用户名预览格式：5–32 位字母、数字或下划线，以字母开头。';
        botDialog.value?.querySelector('#push-bot-username')?.focus();
        return;
    }
    botNotice.value = `UI 预览：已展示 ${managedRole.value}账号的机器人配置草稿；未实际创建机器人、绑定或保存。`;
}
function onBackdrop(event, close) {
    if (event.target !== event.currentTarget) return;
    const bounds = event.currentTarget.getBoundingClientRect();
    if (
        event.clientX < bounds.left ||
        event.clientX > bounds.right ||
        event.clientY < bounds.top ||
        event.clientY > bounds.bottom
    )
        close();
}
function keepDialogFocus(event) {
    if (
        event.key !== 'Tab' ||
        event.ctrlKey ||
        event.altKey ||
        event.metaKey ||
        event.defaultPrevented
    )
        return;
    const dialog = event.currentTarget;
    const focusable = Array.from(
        dialog.querySelectorAll('button, input, select, textarea, a[href], [tabindex]'),
    ).filter(
        (element) =>
            element.tabIndex >= 0 &&
            !element.matches(':disabled') &&
            element.getClientRects().length > 0 &&
            getComputedStyle(element).visibility !== 'hidden',
    );
    if (!focusable.length) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    const active = dialog.ownerDocument.activeElement;
    if (focusable.length === 1 || (event.shiftKey ? active === first : active === last)) {
        event.preventDefault();
        (event.shiftKey ? last : first).focus();
    }
}
watch(
    () => [session.user?.id, session.user?.username, session.user?.role],
    () => {
        closeBinding();
        closeBotConfiguration();
        telegramUsername.value = '';
        Object.assign(botDraft, { account: '', name: '', username: '' });
        Object.assign(preferences, defaults);
        notice.value = '';
    },
);
onBeforeUnmount(() => {
    bindingDialog.value?.close();
    botDialog.value?.close();
});
</script>

<template>
    <div class="settings-page settings-page--centered push-settings-page">
        <div class="page-title-row">
            <h1>推送面板</h1>
        </div>
        <p class="push-introduction">
            按当前登录账号配置 Telegram
            推送。每个账号绑定自己的专属机器人后接收通知；关闭某类偏好后，不再接收该类通知。
        </p>
        <p class="push-preview-hint">UI 预览 · 机器人创建、绑定、推送及偏好保存均待接入。</p>

        <section
            class="card card-body settings-card push-binding-card"
            aria-labelledby="push-binding-title"
        >
            <span class="push-binding-dot" aria-hidden="true"></span>
            <div class="push-binding-copy">
                <h2 id="push-binding-title" data-testid="push-binding-status">Telegram 未绑定</h2>
                <p>
                    当前账号：{{ accountName }} · {{ roleName }}。完成绑定后，通知将发送到自己的
                    Telegram。
                </p>
            </div>
            <button type="button" class="btn" @click="openBinding">绑定 Telegram</button>
        </section>

        <section
            class="card card-body settings-card push-assignment-card"
            aria-labelledby="push-assignment-title"
        >
            <div class="push-assignment-heading">
                <h2 id="push-assignment-title">专属机器人</h2>
                <span class="status-chip">待接入</span>
            </div>
            <p>{{ assignmentDescription }}</p>
            <div class="push-account-chain" aria-label="机器人配置层级">
                <span>超管配置总台</span><span aria-hidden="true">→</span><span>总台配置子台</span
                ><span aria-hidden="true">→</span><span>账号自行绑定</span>
            </div>
            <button
                v-if="canManageBots"
                type="button"
                class="btn push-bot-button"
                @click="openBotConfiguration"
            >
                配置{{ managedRole }}机器人
            </button>
        </section>

        <section
            v-for="group in groups"
            :key="group.id"
            class="push-group"
            :aria-labelledby="`push-group-${group.id}`"
        >
            <h2 :id="`push-group-${group.id}`" class="push-group-title">{{ group.title }}</h2>
            <div
                v-for="option in group.options"
                :key="option.id"
                class="card card-body settings-card push-option-card"
            >
                <div class="push-option-heading">
                    <h3 :id="`push-option-${option.id}`">{{ option.title }}</h3>
                    <span v-if="option.recommended" class="push-recommended">默认开启</span>
                </div>
                <p :id="`push-option-${option.id}-hint`">{{ option.description }}</p>
                <label class="push-switch">
                    <input
                        :id="`push-${option.id}`"
                        v-model="preferences[option.id]"
                        type="checkbox"
                        role="switch"
                        :aria-label="option.title"
                        :aria-describedby="`push-option-${option.id}-hint`"
                    />
                    <span class="push-switch-track" aria-hidden="true"></span>
                </label>
            </div>
        </section>

        <div class="push-settings-actions">
            <div class="page-actions">
                <button type="button" class="btn btn-primary" @click="previewSave">保存偏好</button>
                <button type="button" class="btn" @click="restoreDefaults">恢复默认</button>
                <RouterLink to="/">返回设备</RouterLink>
                <RouterLink to="/builds">前往构建</RouterLink>
            </div>
            <p v-if="notice" class="push-action-notice" role="status" data-testid="push-notice">
                {{ notice }}
            </p>
            <p class="push-footer-hint">
                开关与草稿仅保留在当前页面内存中；离开页面或刷新后恢复默认。当前未绑定，也不会发送消息。
            </p>
        </div>

        <dialog
            ref="bindingDialog"
            class="push-dialog"
            aria-labelledby="push-binding-dialog-title"
            data-testid="push-binding-dialog"
            @cancel.prevent="closeBinding"
            @click="onBackdrop($event, closeBinding)"
            @keydown="keepDialogFocus"
        >
            <div class="push-dialog-heading">
                <h2 id="push-binding-dialog-title">绑定 Telegram（界面预览）</h2>
                <button
                    type="button"
                    class="push-dialog-close"
                    aria-label="关闭绑定引导"
                    @click="closeBinding"
                >
                    ×
                </button>
            </div>
            <div class="push-dialog-content">
                <p class="push-dialog-introduction">
                    当前账号：{{
                        accountName
                    }}。每个新账号需先绑定自己的机器人，推送功能再另行接入。
                </p>
                <ol class="push-binding-steps">
                    <li>
                        <strong>确认专属机器人</strong
                        ><span
                            >由超管配置总台机器人，由总台配置子台机器人。当前机器人：待配置。</span
                        >
                    </li>
                    <li>
                        <strong>在 Telegram 完成私聊绑定</strong
                        ><span>机器人入口与一次性绑定凭证待接入；本预览不打开外部会话。</span>
                    </li>
                    <li>
                        <strong>返回工作台验证状态</strong
                        ><span>验证接口待接入。完成真实验证后，才会展示已绑定状态。</span>
                    </li>
                </ol>
                <div class="push-field">
                    <label for="push-telegram-username">Telegram 用户名（预览，可选）</label>
                    <input
                        id="push-telegram-username"
                        v-model="telegramUsername"
                        type="text"
                        class="form-control"
                        maxlength="32"
                        autocomplete="off"
                        placeholder="例如 sample_user（演示）"
                    />
                    <small>此字段仅用于展示绑定表单，不保存、不提交。</small>
                </div>
                <p
                    v-if="bindingNotice"
                    class="push-action-notice"
                    role="status"
                    data-testid="push-binding-notice"
                >
                    {{ bindingNotice }}
                </p>
            </div>
            <div class="push-dialog-actions">
                <button type="button" class="btn" @click="closeBinding">取消</button>
                <button type="button" class="btn btn-primary" @click="previewBinding">
                    预览绑定流程
                </button>
            </div>
        </dialog>

        <dialog
            ref="botDialog"
            class="push-dialog"
            aria-labelledby="push-bot-dialog-title"
            data-testid="push-bot-dialog"
            @cancel.prevent="closeBotConfiguration"
            @click="onBackdrop($event, closeBotConfiguration)"
            @keydown="keepDialogFocus"
        >
            <div class="push-dialog-heading">
                <h2 id="push-bot-dialog-title">配置{{ managedRole }}机器人（界面预览）</h2>
                <button
                    type="button"
                    class="push-dialog-close"
                    aria-label="关闭机器人配置"
                    @click="closeBotConfiguration"
                >
                    ×
                </button>
            </div>
            <div class="push-dialog-content">
                <p class="push-dialog-introduction">
                    {{ roleName }}为{{
                        managedRole
                    }}账号配置独立机器人；创建账号时可预留此配置，实际创建与账号关联待接入。
                </p>
                <div class="push-field">
                    <label for="push-bot-account">目标{{ managedRole }}账号</label>
                    <input
                        id="push-bot-account"
                        v-model="botDraft.account"
                        type="text"
                        class="form-control"
                        maxlength="32"
                        autocomplete="off"
                        :placeholder="`输入${managedRole}账号（预览）`"
                    />
                </div>
                <div class="push-field">
                    <label for="push-bot-name">机器人名称</label>
                    <input
                        id="push-bot-name"
                        v-model="botDraft.name"
                        type="text"
                        class="form-control"
                        maxlength="64"
                        autocomplete="off"
                        placeholder="例如 满天星通知（演示）"
                    />
                </div>
                <div class="push-field">
                    <label for="push-bot-username">机器人用户名</label>
                    <input
                        id="push-bot-username"
                        v-model="botDraft.username"
                        type="text"
                        class="form-control"
                        maxlength="33"
                        autocomplete="off"
                        placeholder="例如 sample_notify_bot（演示）"
                        aria-describedby="push-bot-username-hint"
                    />
                    <small id="push-bot-username-hint"
                        >仅填写界面草稿；不提供密钥输入，也不调用机器人平台。</small
                    >
                </div>
                <p
                    v-if="botError"
                    class="push-validation-error"
                    role="alert"
                    data-testid="push-bot-error"
                >
                    {{ botError }}
                </p>
                <p
                    v-if="botNotice"
                    class="push-action-notice"
                    role="status"
                    data-testid="push-bot-notice"
                >
                    {{ botNotice }}
                </p>
            </div>
            <div class="push-dialog-actions">
                <button type="button" class="btn" @click="closeBotConfiguration">取消</button>
                <button type="button" class="btn btn-primary" @click="previewBotConfiguration">
                    预览机器人配置
                </button>
            </div>
        </dialog>
    </div>
</template>

<style scoped>
:global(.console-main:has(> .push-settings-page)) {
    background: var(--lab-bg);
}
.push-settings-page > .page-title-row {
    margin-bottom: 8px;
}
.push-settings-page p {
    color: var(--lab-muted);
    font-size: 12px;
    line-height: 1.7;
}
.push-introduction {
    margin: 0 0 6px;
}
.push-preview-hint {
    margin: 0 0 16px;
    font-size: 11px !important;
}
.push-settings-page .settings-card {
    width: 100%;
    max-width: none;
    padding: 18px 20px;
    border: 1px solid var(--lab-line);
    border-radius: 12px;
    background: var(--lab-surface);
    box-shadow: none;
}
.push-settings-page .settings-card h2,
.push-settings-page .settings-card h3 {
    color: var(--lab-ink);
    margin: 0;
    font-size: 14px;
    font-weight: 650;
}
.push-settings-page .settings-card p {
    margin: 3px 0 0;
}
.push-binding-card {
    display: flex;
    flex-direction: row;
    align-items: center;
    gap: 14px;
    min-height: 82px;
    margin-bottom: 14px;
}
.push-binding-dot {
    width: 10px;
    height: 10px;
    border-radius: 50%;
    background: #c1c8d5;
    flex-shrink: 0;
}
.push-binding-copy {
    flex: 1;
    min-width: 0;
}
.push-binding-card > .btn {
    flex-shrink: 0;
}
.push-settings-page .btn {
    min-height: 30px;
    font-size: 11px;
}
.push-assignment-card {
    margin: 0 0 22px;
}
.push-assignment-heading {
    display: flex;
    align-items: center;
    gap: 12px;
    margin-bottom: 6px;
}
.push-assignment-heading .status-chip {
    margin-left: auto;
}
.push-account-chain {
    display: flex;
    align-items: center;
    gap: 12px;
    margin: 12px 0 0;
    color: var(--lab-muted);
    font-size: 11px;
}
.push-account-chain > span:nth-child(odd) {
    padding: 5px 9px;
    border-radius: 6px;
    background: var(--lab-bg);
}
.push-bot-button {
    align-self: flex-start;
    margin-top: 12px;
}
.push-group {
    margin-bottom: 22px;
}
.push-group-title {
    color: var(--lab-muted);
    font-size: 12px;
    font-weight: 600;
    margin: 0 0 10px;
}
.push-settings-page .push-option-card {
    position: relative;
    min-height: 82px;
    padding-right: 96px;
    margin-bottom: 12px;
}
.push-option-card:last-child {
    margin-bottom: 0;
}
.push-option-heading {
    display: flex;
    align-items: center;
    gap: 9px;
}
.push-recommended {
    display: inline-block;
    border-radius: 4px;
    padding: 2px 6px;
    background: #fff3c9;
    color: #bd861e;
    font-size: 10px;
    line-height: 1.3;
}
.push-switch {
    position: absolute;
    right: 20px;
    top: 18px;
    width: 48px;
    height: 28px;
    cursor: pointer;
}
.push-switch input {
    position: absolute;
    inset: 0;
    z-index: 1;
    width: 100%;
    height: 100%;
    margin: 0;
    opacity: 0;
    cursor: pointer;
}
.push-switch-track {
    display: block;
    width: 48px;
    height: 28px;
    border-radius: 18px;
    background: #cbd5e1;
    transition: background 0.15s;
}
.push-switch-track::after {
    content: '';
    display: block;
    position: absolute;
    width: 22px;
    height: 22px;
    left: 3px;
    top: 3px;
    border-radius: 50%;
    background: #fff;
    transition: transform 0.15s;
}
.push-switch input:checked + .push-switch-track {
    background: #7068f5;
}
.push-switch input:checked + .push-switch-track::after {
    transform: translateX(20px);
}
.push-switch input:focus-visible + .push-switch-track {
    outline: 2px solid #6476ee;
    outline-offset: 3px;
}
.push-settings-actions {
    padding-bottom: 16px;
}
.push-settings-actions .page-actions > a {
    font-size: 11px;
}
.push-footer-hint {
    margin: 12px 0 0;
    font-size: 11px !important;
}
.push-settings-page .push-action-notice {
    padding: 10px 12px;
    margin: 12px 0 0;
    border: 1px solid var(--lab-line);
    border-radius: 8px;
    background: var(--lab-bg);
    color: var(--lab-ink);
    font-size: 12px;
}
.push-dialog {
    position: fixed;
    inset: 0;
    width: 560px;
    max-width: calc(100vw - 40px);
    max-height: calc(100vh - 80px);
    padding: 24px;
    margin: auto;
    border: 1px solid var(--lab-line);
    border-radius: 16px;
    color: var(--lab-ink);
    background: var(--lab-surface);
    box-shadow: 0 20px 60px #0003;
}
.push-dialog[open] {
    display: flex;
    flex-direction: column;
}
.push-dialog::backdrop {
    background: #0005;
    backdrop-filter: blur(4px);
}
.push-dialog-heading {
    display: flex;
    align-items: center;
    gap: 12px;
    flex-shrink: 0;
    margin-bottom: 16px;
}
.push-dialog-heading h2 {
    margin: 0;
    font-size: 19px;
    font-weight: 650;
}
.push-dialog-close {
    display: flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
    margin-left: auto;
    width: 32px;
    height: 32px;
    border: 1px solid var(--lab-line);
    border-radius: 8px;
    background: var(--lab-bg);
    color: var(--lab-muted);
    font-size: 22px;
    cursor: pointer;
}
.push-dialog-content {
    overflow-y: auto;
    min-height: 0;
    padding: 2px;
}
.push-dialog-introduction {
    margin: 0 0 14px;
}
.push-binding-steps {
    list-style: none;
    counter-reset: binding-step;
    padding: 0;
    margin: 0 0 18px;
}
.push-binding-steps li {
    position: relative;
    counter-increment: binding-step;
    padding: 11px 12px 11px 44px;
    border: 1px solid var(--lab-line);
    border-radius: 9px;
    background: var(--lab-bg);
    margin-bottom: 8px;
}
.push-binding-steps li::before {
    content: counter(binding-step);
    position: absolute;
    left: 12px;
    top: 13px;
    display: flex;
    align-items: center;
    justify-content: center;
    width: 22px;
    height: 22px;
    border-radius: 50%;
    color: var(--lab-accent);
    background: var(--lab-surface);
    font-size: 11px;
    font-weight: 650;
}
.push-binding-steps strong,
.push-binding-steps span {
    display: block;
    font-size: 12px;
    line-height: 1.7;
}
.push-binding-steps span {
    color: var(--lab-muted);
    margin-top: 2px;
}
.push-field {
    margin-bottom: 14px;
}
.push-field:last-child {
    margin-bottom: 0;
}
.push-field label {
    display: block;
    margin-bottom: 6px;
    font-size: 12px;
    font-weight: 600;
}
.push-field .form-control {
    height: 34px;
    min-height: 34px;
    padding: 7px 10px;
    font-size: 12px;
}
.push-field small {
    display: block;
    margin-top: 6px;
    font-size: 11px;
    color: var(--lab-muted);
}
.push-dialog-actions {
    display: flex;
    justify-content: flex-end;
    gap: 10px;
    flex-shrink: 0;
    padding-top: 18px;
}
.push-validation-error {
    margin: 8px 0 0;
    color: #db5667 !important;
}
:global([data-bs-theme='dark']) .push-recommended {
    background: #594722;
    color: #ecd397;
}
:global([data-bs-theme='dark']) .push-switch-track {
    background: #586478;
}
</style>
