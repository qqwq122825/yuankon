<script setup>
import { computed, ref, watch, onUnmounted } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { api, mutate, sourceLabel, formatDate, normalizeWireDevice } from '../api.js';
import {
    subscribe,
    unsubscribe,
    onMessage,
    connection,
    queryState,
    captureViewerHeartbeat,
    captureViewerClose,
    requestScreenshot,
    requestDeviceAction,
    requestTextInput,
} from '../connection.js';
import FloatingViewer from '../components/FloatingViewer.vue';
import NodeReader from '../components/NodeReader.vue';
import DeviceScreenshot from '../components/DeviceScreenshot.vue';
const route = useRoute(),
    router = useRouter(),
    data = ref(null),
    note = ref(''),
    error = ref(''),
    notice = ref(''),
    saving = ref(false),
    section = ref('info'),
    shot = ref(false),
    reportedShot = ref(false),
    reader = ref(false),
    front = ref('reader'),
    resetKey = ref(0),
    reportedRefresh = ref(0),
    reportedShotCount = ref(0),
    liveNodeSnapshot = ref(null),
    captureState = ref(''),
    actionToast = ref(''),
    actionToastTone = ref('success'),
    dndEnabled = ref(false);
let controller, subscribed, viewerId, viewerTimer, activeCommandId, actionToastTimer;
const activeReaderSnapshot = computed(() =>
    data.value?.device.source === 'api' ? liveNodeSnapshot.value : data.value?.snapshot,
);
const readerMeta = computed(() => {
    const snapshot = activeReaderSnapshot.value;
    if (!snapshot) return '等待节点';
    const packageName = snapshot.payload.windows.find((window) => window.active)?.package;
    return `#${snapshot.node_count}${packageName ? ` · ${packageName}` : ''}`;
});
const pendingActions = new Map();
const pendingTextInputs = new Set();
const actionProgress = {
    BACK: '正在返回上一页',
    HOME: '正在返回 Home',
    RECENTS: '正在打开多任务',
    LOCK: '正在锁屏',
    WAKE: '正在点亮屏幕',
    DND_TOGGLE: '正在切换勿扰',
};
const actionSuccess = {
    BACK: '已返回上一页',
    HOME: '已返回 Home',
    RECENTS: '已打开多任务',
    LOCK: '已锁屏',
    WAKE: '已点亮屏幕',
};
const sections = [
    ['info', '设备信息'],
    ['snapshots', '历史快照'],
    ['sms', '短信观察'],
    ['password', '密码事件'],
    ['events', '观察记录'],
    ['nodes', '节点信息'],
    ['note', '备注'],
];
async function load() {
    controller?.abort();
    const request = (controller = new AbortController());
    error.value = '';
    notice.value = '';
    shot.value = false;
    if (viewerId) stopLiveSession();
    reader.value = false;
    try {
        const result = await api(
            `/api/devices/${route.params.id}${route.query.snapshot ? `?snapshot=${encodeURIComponent(route.query.snapshot)}` : ''}`,
            { signal: request.signal },
        );
        if (request.signal.aborted) return;
        data.value = result;
        note.value = result.device.note;
        reader.value = route.query.view === 'reader';
        if (subscribed !== result.device.public_id) {
            if (subscribed) unsubscribe(subscribed);
            subscribed = result.device.public_id;
            subscribe(subscribed);
        }
        if (reader.value && result.device.source === 'api') startLiveLease();
    } catch (e) {
        if (e.name !== 'AbortError') {
            data.value = null;
            error.value = e.message;
        }
    }
}
watch(() => route.fullPath, load, { immediate: true });
const off = onMessage((message) => {
    if (message.type === 'device_removed' && message.data?.id === data.value?.device.public_id) {
        controller?.abort();
        data.value = null;
        router.replace('/');
        return;
    }
    if (
        data.value &&
        [
            'device_status_update',
            'device_online',
            'device_offline',
            'get_device_state_response',
        ].includes(message.type) &&
        message.data?.id === data.value.device.public_id
    ) {
        data.value.device = { ...data.value.device, ...normalizeWireDevice(message.data) };
        if (data.value.device.is_blacklisted) closeReportedShot();
    }
    if (!data.value || message.sessionId !== data.value.device.public_id) return;
    if (message.type === 'capture_viewer_lease' && message.data?.viewerId === viewerId) {
        captureState.value = message.data.deviceOnline
            ? '正在实时查看，等待设备上传截图'
            : '设备当前离线，连接后将继续请求截图';
        if (message.data.deviceOnline) loadLiveNodes();
    }
    if (message.type === 'command_ack' && message.data?.command === 'DEVICE_ACTION') {
        const action = pendingActions.get(message.data.commandId);
        if (action) {
            pendingActions.delete(message.data.commandId);
            if (message.data.result === 'accepted') {
                if (message.data.reasonCode === 'dnd_enabled') dndEnabled.value = true;
                if (message.data.reasonCode === 'dnd_disabled') dndEnabled.value = false;
                showActionToast(
                    message.data.reasonCode === 'dnd_enabled'
                        ? '勿扰已开启'
                        : message.data.reasonCode === 'dnd_disabled'
                          ? '勿扰已关闭'
                          : actionSuccess[action] || '操作已执行',
                );
            } else {
                const failure = {
                    dnd_permission_required: '设备尚未允许勿扰权限',
                    viewer_lease_expired: '实时查看已结束',
                    android_version_unsupported: '当前 Android 版本不支持',
                    action_failed: '设备未执行该操作',
                };
                showActionToast(failure[message.data.reasonCode] || '设备未执行该操作', 'error');
            }
        }
    }
    if (message.type === 'command_ack' && message.data?.command === 'TEXT_INPUT') {
        if (pendingTextInputs.delete(message.data.commandId)) {
            if (message.data.result === 'accepted') showActionToast('文本已发送');
            else {
                const failure = {
                    input_not_focused: '设备当前没有获得焦点的输入框',
                    input_not_editable: '设备当前焦点不可输入',
                    sensitive_field: '密码或敏感输入框不接收远程文本',
                    viewer_lease_expired: '实时查看已结束',
                    invalid_text: '文本为空或长度超过 500 字符',
                    set_text_failed: '设备未能写入文本',
                };
                showActionToast(failure[message.data.reasonCode] || '设备未能写入文本', 'error');
            }
        }
    }
    if (message.type === 'command_dispatched' && message.data?.commandId === activeCommandId)
        captureState.value = '实时截图指令已下发，等待设备上传';
    if (message.type === 'command_ack' && message.data?.commandId === activeCommandId)
        captureState.value =
            message.data.result === 'accepted'
                ? '设备已接收截图指令'
                : `设备未执行：${message.data.reasonCode || 'rejected'}`;
    if (message.type === 'screenshot_result' && message.data?.commandId === activeCommandId)
        captureState.value =
            message.data.result === 'uploaded'
                ? '实时截图已更新'
                : `截图失败：${message.data.reasonCode || 'capture_failed'}`;
    if (message.type === 'screenshot_ready') {
        reportedRefresh.value++;
        captureState.value =
            message.data?.reason === 'initial_accessibility'
                ? '已收到无障碍开启后的首张缩略图'
                : '实时画面已更新';
    }
    if (message.type === 'accessibility_snapshot_ready' && message.data?.viewerId === viewerId) {
        captureState.value = `已收到 ${message.data.nodeCount} 个结构节点`;
        loadLiveNodes();
    }
});
onUnmounted(() => {
    controller?.abort();
    off();
    stopLiveSession();
    if (subscribed) unsubscribe(subscribed);
});
async function save() {
    saving.value = true;
    error.value = '';
    notice.value = '';
    try {
        const device = await mutate(`/api/devices/${data.value.device.id}/note`, 'PATCH', {
            note: note.value,
        });
        data.value.device = device;
        notice.value = '备注已保存';
    } catch (e) {
        error.value = e.message;
    } finally {
        saving.value = false;
    }
}
function openBoth() {
    stopLiveSession();
    shot.value = true;
    reader.value = true;
    front.value = 'reader';
}
function startLiveLease() {
    if (!data.value || data.value.device.source !== 'api') return;
    if (!viewerId) viewerId = crypto.randomUUID();
    clearInterval(viewerTimer);
    captureViewerHeartbeat(data.value.device.public_id, viewerId);
    viewerTimer = setInterval(
        () => captureViewerHeartbeat(data.value.device.public_id, viewerId),
        5000,
    );
}
async function loadLiveNodes() {
    if (!viewerId || !data.value || data.value.device.source !== 'api') return;
    try {
        const result = await api(
            `/api/devices/${data.value.device.id}/accessibility-snapshot?viewerId=${encodeURIComponent(viewerId)}`,
        );
        if (result.snapshot) liveNodeSnapshot.value = result.snapshot;
    } catch (e) {
        if (viewerId) captureState.value = e.message;
    }
}
function openReportedShot(request = true) {
    if (!reportedShot.value) reportedShotCount.value = 0;
    reportedShot.value = true;
    shot.value = false;
    reader.value = true;
    front.value = 'reported';
    startLiveLease();
    if (request) {
        activeCommandId = requestScreenshot(data.value.device.public_id, viewerId);
        captureState.value = '正在启动实时截图';
    }
}
function openLiveReader() {
    reader.value = true;
    front.value = 'reader';
    startLiveLease();
    loadLiveNodes();
}
function openReader() {
    if (data.value.device.source === 'api') openLiveReader();
    else {
        reader.value = true;
        front.value = 'reader';
    }
}
function closeReportedShot() {
    reportedShot.value = false;
    if (!reader.value) stopLiveSession();
}
function closeReader() {
    reader.value = false;
    if (!reportedShot.value && data.value?.device.source === 'api') stopLiveSession();
}
function stopLiveSession() {
    clearInterval(viewerTimer);
    viewerTimer = null;
    if (viewerId && data.value?.device.public_id)
        captureViewerClose(data.value.device.public_id, viewerId);
    viewerId = null;
    activeCommandId = null;
    pendingActions.clear();
    pendingTextInputs.clear();
    clearTimeout(actionToastTimer);
    actionToast.value = '';
    reportedShot.value = false;
    liveNodeSnapshot.value = null;
}
function closeAll() {
    shot.value = false;
    reader.value = false;
    stopLiveSession();
}
function showActionToast(message, tone = 'success') {
    clearTimeout(actionToastTimer);
    actionToast.value = message;
    actionToastTone.value = tone;
    actionToastTimer = setTimeout(() => (actionToast.value = ''), 2200);
}
function runDeviceAction(action) {
    if (!viewerId || !data.value || data.value.device.status !== 'online') {
        showActionToast('设备当前离线', 'error');
        return;
    }
    const commandId = requestDeviceAction(data.value.device.public_id, viewerId, action);
    pendingActions.set(commandId, action);
    showActionToast(actionProgress[action] || '正在发送');
}
function runTextInput(text) {
    if (!viewerId || !data.value || data.value.device.status !== 'online') {
        showActionToast('设备当前离线', 'error');
        return;
    }
    const commandId = requestTextInput(data.value.device.public_id, viewerId, text);
    pendingTextInputs.add(commandId);
    showActionToast('正在发送文本');
}
function openPrimary() {
    if (data.value.device.source === 'api') openReportedShot(true);
    else openBoth();
}
function choose(value) {
    section.value = value;
    if (value === 'nodes') openReader();
}
</script>
<template>
    <header class="device-topbar">
        <RouterLink to="/" class="device-back">← 设备</RouterLink>
        <h1>{{ data?.device.name || '设备详情' }}</h1>
        <span class="device-system"
            >{{ data?.device.public_id }} · Android {{ data?.device.android_version || '—' }}</span
        >
        <form v-if="data" class="topbar-note" @submit.prevent="save">
            <input
                v-model="note"
                class="form-control"
                aria-label="设备备注"
                maxlength="200"
                placeholder="添加备注"
            /><button class="btn btn-primary" :disabled="saving">保存备注</button>
        </form>
        <span class="device-badges"
            ><span class="status-chip">{{ data ? sourceLabel(data.device.source) : '读取中' }}</span
            ><span class="status-chip" :class="data?.device.status">{{
                data?.device.status === 'online' ? '在线' : '历史记录 / 离线'
            }}</span
            ><span>WS · {{ connection.status }}</span></span
        >
    </header>
    <div v-if="error" role="alert" class="alert alert-danger m-3">
        {{ error }} <button class="btn" @click="load">重试</button>
    </div>
    <p v-if="notice" role="status" class="detail-notice">{{ notice }}</p>
    <div
        v-if="actionToast"
        role="status"
        class="device-browser-toast"
        :class="actionToastTone === 'error' ? 'error' : 'success'"
    >
        {{ actionToast }}
    </div>
    <div v-if="data" class="device-workbench">
        <aside class="device-nav">
            <nav aria-label="设备内导航">
                <button
                    v-for="[key, label] in sections"
                    :key="key"
                    :class="{ active: section === key }"
                    @click="choose(key)"
                >
                    {{ label }}
                </button>
            </nav>
            <span class="device-nav-caption">设备研究工作台</span>
        </aside>
        <div class="device-canvas">
            <div class="inspection-orbit">
                <button
                    class="orbit-launch"
                    :disabled="data.device.source !== 'api' && !data.snapshot"
                    @click="openPrimary"
                >
                    <span>BOUNDARY</span><strong>开始</strong>
                </button>
            </div>
            <section class="card research-summary">
                <div class="card-header">
                    <strong>设备研究概览</strong
                    ><span class="summary-actions"
                        ><button
                            class="btn"
                            @click="
                                queryState(data.device.public_id);
                                notice = '已请求服务端已知状态';
                            "
                        >
                            查询状态
                        </button></span
                    >
                </div>
                <div class="summary-content">
                    <div class="summary-metrics">
                        <span
                            ><strong>{{ data.snapshots.length }}</strong
                            >历史快照</span
                        ><span
                            ><strong>{{ data.snapshot?.node_count ?? '—' }}</strong
                            >节点</span
                        ><span
                            ><strong>{{ data.snapshot?.window_count ?? '—' }}</strong
                            >窗口</span
                        >
                    </div>
                    <p>
                        无障碍开启后自动上报一张临时缩略图；点击开始后在有效网页租约内连续更新最新截图，关闭查看或租约失效后停止。
                    </p>
                </div>
            </section>
            <template v-if="section === 'info' || section === 'note'"
                ><div class="workspace-section-heading">
                    <h2>{{ section === 'note' ? '设备备注' : '设备信息' }}</h2>
                    <span>状态来自设备上报；示例单独标注</span>
                </div>
                <div class="card card-body">
                    <dl class="metadata-list">
                        <div>
                            <dt>设备标识</dt>
                            <dd>{{ data.device.public_id }}</dd>
                        </div>
                        <div>
                            <dt>APK ID / 归属</dt>
                            <dd>
                                {{ data.device.apk_id || '—' }} /
                                {{ data.owner?.username || '未分配（历史记录）' }}
                            </dd>
                        </div>
                        <div>
                            <dt>品牌 / Android</dt>
                            <dd>{{ data.device.brand }} / {{ data.device.android_version }}</dd>
                        </div>
                        <div>
                            <dt>电量 / 无障碍</dt>
                            <dd>
                                {{ data.device.battery ?? '—' }} /
                                {{
                                    data.device.accessibility_enabled === null
                                        ? '—'
                                        : data.device.accessibility_enabled
                                          ? '已开启'
                                          : '已关闭'
                                }}
                            </dd>
                        </div>
                        <div>
                            <dt>最近入库</dt>
                            <dd>{{ formatDate(data.device.last_received_at) }}</dd>
                        </div>
                        <div>
                            <dt>备注</dt>
                            <dd>{{ data.device.note || '暂无备注，使用顶栏编辑' }}</dd>
                        </div>
                    </dl>
                </div></template
            ><template v-else-if="section === 'snapshots'"
                ><div class="workspace-section-heading"><h2>历史快照</h2></div>
                <div class="card card-body">
                    <p v-if="!data.snapshots.length">暂无快照</p>
                    <div v-for="s in data.snapshots" :key="s.id" class="record-row">
                        <span
                            >#{{ s.id }} · {{ formatDate(s.captured_at) }} ·
                            {{ s.node_count }} 节点</span
                        ><button
                            class="btn btn-sm"
                            @click="router.push({ query: { ...route.query, snapshot: s.id } })"
                        >
                            查看此快照</button
                        ><a :href="`/api/snapshots/${s.id}/export`" class="btn btn-sm">导出 JSON</a>
                    </div>
                </div></template
            ><template v-else-if="section === 'events'"
                ><div class="workspace-section-heading">
                    <h2>观察记录</h2>
                    <span>仅事件类型与时间</span>
                </div>
                <div class="card card-body">
                    <p v-if="!data.events.length">暂无观察记录</p>
                    <div class="record-row" v-for="event in data.events" :key="event.id">
                        <span>{{ event.kind }}</span
                        ><span
                            >{{ sourceLabel(event.source) }} ·
                            {{ formatDate(event.occurred_at) }}</span
                        >
                    </div>
                </div></template
            ><template v-else-if="['sms', 'password'].includes(section)"
                ><div class="workspace-section-heading">
                    <h2>合成场景观察</h2>
                    <span>采集端报告 · 不含原文</span>
                </div>
                <div class="card card-body">
                    <table class="table">
                        <thead>
                            <tr>
                                <th>场景</th>
                                <th>通道</th>
                                <th>测试编号</th>
                                <th>是否返回文本</th>
                                <th>合成值匹配</th>
                            </tr>
                        </thead>
                        <tbody>
                            <tr
                                v-for="o in (data.snapshot?.payload.observations || []).filter(
                                    (o) =>
                                        section === 'password'
                                            ? o.scenario === 'password_field'
                                            : o.scenario.startsWith('sms'),
                                )"
                                :key="o.case_id"
                            >
                                <td>{{ o.scenario }}</td>
                                <td>{{ o.channel }}</td>
                                <td>{{ o.case_id }}</td>
                                <td>{{ o.text_returned ?? '—' }}</td>
                                <td>{{ o.synthetic_match }}</td>
                            </tr>
                        </tbody>
                    </table>
                    <p>仅展示已记录的元数据；无记录的场景保持为空。</p>
                </div></template
            ><template v-else
                ><div class="workspace-section-heading"><h2>节点信息</h2></div>
                <div class="card card-body">
                    <p>
                        {{
                            data.device.source === 'api'
                                ? liveNodeSnapshot
                                    ? `实时记录 ${liveNodeSnapshot.node_count} 个结构节点，默认按坐标预览；正文未采集。`
                                    : '打开后由设备在有效查看租约内上报节点结构记录。'
                                : data.snapshot
                                  ? `当前快照 ${data.snapshot.node_count} 个节点，正文已剔除。`
                                  : '暂无节点快照。'
                        }}
                    </p>
                    <button
                        class="btn"
                        :disabled="data.device.source !== 'api' && !data.snapshot"
                        @click="openReader"
                    >
                        打开节点阅读器
                    </button>
                </div></template
            >
        </div>
        <aside class="device-tools">
            <div class="tool-group">
                <h2>截图查看</h2>
                <button
                    v-if="data.device.apk_id"
                    class="tool-button"
                    @click="openReportedShot(true)"
                >
                    实时查看截图
                </button>
                <button class="tool-button primary" :disabled="!data.snapshot" @click="openBoth">
                    截图 + 阅读器</button
                ><button
                    class="tool-button"
                    :disabled="!data.snapshot"
                    @click="
                        shot = true;
                        reportedShot = false;
                        front = 'shot';
                    "
                >
                    截图浮窗</button
                ><button
                    class="tool-button"
                    :disabled="data.device.source !== 'api' && !data.snapshot"
                    @click="openReader"
                >
                    节点浮窗</button
                ><button class="tool-button muted" @click="resetKey++">重置浮窗位置</button
                ><button class="tool-button muted" @click="closeAll">关闭全部浮窗</button>
            </div>
            <div class="tool-group">
                <h2>历史快照</h2>
                <select
                    class="form-select"
                    aria-label="切换快照"
                    :value="data.snapshot?.id || ''"
                    @change="
                        router.push({ query: { ...route.query, snapshot: $event.target.value } })
                    "
                >
                    <option v-if="!data.snapshot" value="">暂无快照</option>
                    <option v-for="s in data.snapshots" :value="s.id" :key="s.id">
                        #{{ s.id }} · {{ s.node_count }} 节点
                    </option></select
                ><a
                    v-if="data.snapshot"
                    class="tool-button mint mt-2"
                    :href="`/api/snapshots/${data.snapshot.id}/export`"
                    >导出脱敏 JSON</a
                >
            </div>
            <div class="tool-group">
                <RouterLink class="tool-button" to="/settings/translation">翻译设置</RouterLink
                ><RouterLink class="tool-button" to="/protocol">协议审计</RouterLink>
            </div>
            <div class="tool-help">
                <p>截图为历史文件或合成示例。节点坐标仅用于查看属性。</p>
                <p>只保留最新截图且最多暂存 5 分钟；关闭浮窗或网页会结束实时查看租约。</p>
            </div>
        </aside>
    </div>
    <FloatingViewer
        v-if="reportedShot && data"
        title="BM截图"
        :meta="`截图 #${reportedShotCount}`"
        :side="0"
        :reset-key="resetKey"
        :active="front === 'reported'"
        live
        @activate="front = 'reported'"
        @close="
            closeReportedShot();
            front = 'reader';
        "
    >
        <DeviceScreenshot
            :device-id="data.device.id"
            :refresh-key="reportedRefresh"
            :controls-disabled="data.device.status !== 'online'"
            :dnd-enabled="dndEnabled"
            @count="reportedShotCount = $event"
            @action="runDeviceAction"
            @text-input="runTextInput"
        />
    </FloatingViewer>
    <FloatingViewer
        v-if="shot && data?.snapshot"
        title="截图"
        :side="0"
        :reset-key="resetKey"
        :active="front === 'shot'"
        @activate="front = 'shot'"
        @close="
            shot = false;
            front = 'reader';
        "
        ><img
            v-if="data.snapshot.imageUrl"
            class="snapshot-image"
            :src="data.snapshot.imageUrl"
            :alt="data.snapshot.source === 'sample' ? '合成界面样例' : '历史截图'"
        />
        <p v-else class="empty-state">此快照没有截图</p>
        <footer class="reader-foot">
            {{ data.snapshot.source === 'sample' ? '合成示例 · 非真机截图' : '研究者保存的历史截图'
            }}<a
                v-if="data.snapshot.imageUrl"
                :href="data.snapshot.imageUrl"
                target="_blank"
                rel="noopener"
                >查看原图</a
            >
        </footer></FloatingViewer
    ><FloatingViewer
        v-if="reader && data && (activeReaderSnapshot || data.device.source === 'api')"
        title="阅读器"
        :meta="readerMeta"
        :side="1"
        :reset-key="resetKey"
        :active="front === 'reader'"
        :live="data.device.source === 'api'"
        :variant="data.device.source === 'api' ? 'reader' : ''"
        :width-label="data.device.source === 'api' ? '屏幕' : '阅读器'"
        resizable
        @activate="front = 'reader'"
        @close="
            closeReader();
            front = 'shot';
        "
        ><NodeReader
            :snapshot="activeReaderSnapshot"
            :controls-disabled="data.device.status !== 'online'"
            :dnd-enabled="dndEnabled"
            @action="runDeviceAction"
            @text-input="runTextInput"
    /></FloatingViewer>
</template>
