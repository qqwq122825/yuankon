<script setup>
import { ref, watch, onUnmounted } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { api, mutate, sourceLabel, formatDate, normalizeWireDevice } from '../api.js';
import { subscribe, unsubscribe, onMessage, connection, queryState } from '../connection.js';
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
    resetKey = ref(0);
let controller, subscribed;
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
    reportedShot.value = false;
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
        if (data.value.device.is_blacklisted) reportedShot.value = false;
    }
});
onUnmounted(() => {
    controller?.abort();
    off();
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
    reportedShot.value = false;
    shot.value = true;
    reader.value = true;
    front.value = 'reader';
}
function choose(value) {
    section.value = value;
    if (value === 'nodes') {
        reader.value = true;
        front.value = 'reader';
    }
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
            <span class="device-nav-caption">只读研究工作台</span>
        </aside>
        <div class="device-canvas">
            <div class="inspection-orbit">
                <button class="orbit-launch" :disabled="!data.snapshot" @click="openBoth">
                    <span>BOUNDARY</span><strong>只读查看</strong>
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
                                notice = '已请求服务端已知状态，不下发设备操作';
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
                    <p>订阅只刷新状态，不启动采集。连续诊断帧、网页租约尚未迁入 Node。</p>
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
                            data.snapshot
                                ? `当前快照 ${data.snapshot.node_count} 个节点，正文已剔除。`
                                : '暂无节点快照。'
                        }}
                    </p>
                    <button
                        class="btn"
                        :disabled="!data.snapshot"
                        @click="
                            reader = true;
                            front = 'reader';
                        "
                    >
                        打开节点阅读器
                    </button>
                </div></template
            >
        </div>
        <aside class="device-tools">
            <div class="tool-group">
                <h2>只读查看</h2>
                <button
                    v-if="data.device.apk_id"
                    class="tool-button"
                    @click="
                        reportedShot = true;
                        shot = false;
                        front = 'reported';
                    "
                >
                    设备上报截图
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
                    :disabled="!data.snapshot"
                    @click="
                        reader = true;
                        front = 'reader';
                    "
                >
                    节点浮窗</button
                ><button class="tool-button muted" @click="resetKey++">重置浮窗位置</button
                ><button
                    class="tool-button muted"
                    @click="
                        shot = false;
                        reportedShot = false;
                        reader = false;
                    "
                >
                    关闭全部浮窗
                </button>
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
                <p>新登记设备可查看手机主动上报的单张截图；连续截图仍待接入。</p>
            </div>
        </aside>
    </div>
    <FloatingViewer
        v-if="reportedShot && data"
        title="设备上报截图"
        :side="0"
        :reset-key="resetKey"
        :active="front === 'reported'"
        @activate="front = 'reported'"
        @close="
            reportedShot = false;
            front = 'reader';
        "
    >
        <DeviceScreenshot :device-id="data.device.id" />
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
        v-if="reader && data?.snapshot"
        title="阅读器"
        :side="1"
        :reset-key="resetKey"
        :active="front === 'reader'"
        @activate="front = 'reader'"
        @close="
            reader = false;
            front = 'shot';
        "
        ><NodeReader :snapshot="data.snapshot"
    /></FloatingViewer>
</template>
