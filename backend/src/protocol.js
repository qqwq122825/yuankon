import { z } from 'zod';
export const fail = (status, message) => Object.assign(new Error(message), { status });
export const idSchema = z.coerce.number().int().positive();
export const deviceIdSchema = z.string().regex(/^[A-Za-z0-9_-]{1,100}$/);
const flag = z.boolean().nullable().default(null);
const flags = z.object(
    Object.fromEntries(
        [
            'visible',
            'enabled',
            'clickable',
            'scrollable',
            'editable',
            'password',
            'sensitive',
            'focused',
        ].map((k) => [k, flag]),
    ),
);
const observation = z
    .object({
        scenario: z.enum(['password_field', 'sms_ui', 'sms_notification', 'sms_permission']),
        case_id: z.string().regex(/^[A-Za-z0-9_-]{1,60}$/),
        channel: z.enum([
            'accessibility_node',
            'accessibility_event',
            'notification_listener',
            'sms_permission',
        ]),
        event_type: z.enum([
            'manual_probe',
            'TYPE_VIEW_TEXT_CHANGED',
            'TYPE_WINDOW_CONTENT_CHANGED',
            'TYPE_NOTIFICATION_STATE_CHANGED',
        ]),
        fixture: z.literal('synthetic'),
        password_flag: flag,
        sensitive_flag: flag,
        text_returned: flag,
        synthetic_match: z.enum(['match', 'mismatch', 'not_tested']),
    })
    .transform((item) => ({ ...item, evidence: 'client_reported' }));
const snapshotSchema = z.object({
    schema_version: z.literal(1),
    captured_at: z
        .string()
        .max(80)
        .refine((v) => Number.isFinite(Date.parse(v))),
    display: z.object({
        width: z.number().int().min(1).max(10000),
        height: z.number().int().min(1).max(10000),
    }),
    windows: z
        .array(
            z.object({
                id: z.string().min(1).max(80),
                type: z.enum([
                    'application',
                    'system',
                    'input_method',
                    'accessibility_overlay',
                    'unknown',
                ]),
                package: z.string().max(200).nullable().default(null),
                active: flag,
                focused: flag,
                root_status: z.enum([
                    'available',
                    'null_root',
                    'locked_skipped',
                    'filtered',
                    'error',
                ]),
                nodes: z
                    .array(
                        // 节点入库不再使用字段白名单；客户端上报的额外字段直接保留。
                        z
                            .object({
                                id: z.string().min(1).max(100),
                                parent_id: z.string().max(100).nullable().default(null),
                                class_name: z.string().max(200),
                                view_id: z.string().max(250).nullable().default(null),
                                bounds: z.array(z.number().int().min(-32768).max(32768)).length(4),
                                flags: flags.default({}),
                                text_present: z.boolean().default(false),
                            })
                            .passthrough(),
                    )
                    .max(2000),
            }),
        )
        .max(16),
    observations: z.array(observation).max(100).default([]),
    diagnostics: z
        .object({
            elapsed_ms: z.number().int().min(0).max(3600000).nullable().default(null),
            truncated: z.boolean().default(false),
        })
        .default({}),
});
export function normalizeSnapshot(input) {
    const data = snapshotSchema.parse(input);
    const wins = new Set();
    let count = 0;
    for (const win of data.windows) {
        if (wins.has(win.id)) throw fail(422, '窗口 ID 重复');
        wins.add(win.id);
        const nodes = new Map(win.nodes.map((n) => [n.id, n]));
        if (nodes.size !== win.nodes.length || (win.root_status !== 'available' && nodes.size))
            throw fail(422, '节点结构无效');
        for (const node of win.nodes) {
            if (++count > 2000) throw fail(422, '节点数量超限');
            const seen = new Set([node.id]);
            let parent = node.parent_id;
            let depth = 0;
            while (parent !== null) {
                if (!nodes.has(parent) || seen.has(parent) || ++depth > 32)
                    throw fail(422, '节点引用或深度无效');
                seen.add(parent);
                parent = nodes.get(parent).parent_id;
            }
            if (node.bounds[2] < node.bounds[0] || node.bounds[3] < node.bounds[1])
                throw fail(422, '节点坐标无效');
            node.depth = depth;
            node.text_policy = 'uploaded';
        }
    }
    const channels = {
        password_field: ['accessibility_node', 'accessibility_event'],
        sms_ui: ['accessibility_node', 'accessibility_event'],
        sms_notification: ['accessibility_event', 'notification_listener'],
        sms_permission: ['sms_permission'],
    };
    for (const o of data.observations) {
        if (
            !channels[o.scenario].includes(o.channel) ||
            (o.synthetic_match !== 'not_tested' && !o.text_returned)
        )
            throw fail(422, '观察元数据不一致');
    }
    data.diagnostics.text_policy = 'uploaded';
    return data;
}
export function normalizeLiveSnapshot(input) {
    const data = normalizeSnapshot(input);
    const count = data.windows.reduce((sum, window) => sum + window.nodes.length, 0);
    if (count > 400 || data.observations.length) throw fail(422, '实时节点快照超出边界');
    return data;
}
const STRUCTURAL_LABELS = Object.freeze({
    Button: '按钮',
    ImageButton: '图标按钮',
    TextView: '文本区域',
    EditText: '输入框',
    ImageView: '图片',
    CheckBox: '复选框',
    RadioButton: '单选框',
    Switch: '开关',
    ToggleButton: '切换按钮',
    SeekBar: '滑块',
    ProgressBar: '进度',
    ListView: '列表',
    RecyclerView: '列表',
    ScrollView: '滚动区域',
    WebView: '网页区域',
    ViewPager: '分页区域',
    Toolbar: '工具栏',
});
export function structuralLabelsFor(payload) {
    return Object.fromEntries(
        payload.windows.flatMap((window) =>
            window.nodes.map((node) => {
                const type = node.class_name.split('.').pop();
                return [`${window.id}:${node.id}`, STRUCTURAL_LABELS[type] || '界面元素'];
            }),
        ),
    );
}
export const SAMPLE_LABELS = Object.freeze({
    title: 'Research test page',
    subtitle: 'Synthetic fixture',
    section: 'Basic controls',
    label_wifi: 'Network connection',
    label_notification: 'Test notification',
    input_label: 'Test input field',
    save: 'Save test settings',
    caption: 'Synthetic interface sample',
});
export function labelsFor(snapshot) {
    if (snapshot.source !== 'sample') return {};
    return Object.fromEntries(
        snapshot.payload.windows.flatMap((w) =>
            w.nodes.flatMap((n) => {
                const key = n.view_id?.replace('dev.boundarylab.fixture:id/', '');
                return !n.flags.password &&
                    !n.flags.sensitive &&
                    !n.flags.editable &&
                    Object.hasOwn(SAMPLE_LABELS, key)
                    ? [[`${w.id}:${n.id}`, SAMPLE_LABELS[key]]]
                    : [];
            }),
        ),
    );
}
export const statusSchema = z.object({
    type: z.enum(['device_heartbeat', 'screen_lock_status']),
    batteryLevel: z.number().int().min(0).max(100).optional(),
    accessibilityAlive: z.boolean().optional(),
    captureReady: z.boolean().optional(),
    projectionActive: z.boolean().optional(),
    captureMode: z.enum(['accessibility', 'projection']).optional(),
    isLocked: z.boolean().optional(),
    isScreenOn: z.boolean().optional(),
});
export const SORT_COLUMNS = Object.freeze({
    id: 'public_id',
    account: 'owner_username',
    name: 'name',
    note: 'note',
    memo: 'memo_count',
    app: 'app_name',
    app_version: 'app_version',
    source: 'source',
    brand: 'brand',
    android: 'android_version',
    battery: 'battery',
    a11y: 'accessibility_enabled',
    last_seen: 'last_received_at',
    installed: 'installed_at',
    nodes: 'node_count',
    windows: 'window_count',
    snapshots: 'snapshots_count',
});
export const listSchema = z.object({
    q: z.string().max(100).default(''),
    source: z.enum(['', 'sample', 'import', 'api']).default(''),
    a11y: z.enum(['', 'enabled', 'disabled']).default(''),
    status: z.enum(['', 'online', 'offline']).default(''),
    sort: z.enum(Object.keys(SORT_COLUMNS)).default('id'),
    direction: z.enum(['asc', 'desc']).default('asc'),
    page: z.coerce.number().int().min(1).max(100000).default(1),
    perPage: z.coerce.number().int().min(1).max(500).default(10),
});
const viewerIdSchema = z.string().uuid();
export const DEVICE_ACTIONS = Object.freeze([
    'BACK',
    'HOME',
    'RECENTS',
    'LOCK',
    'WAKE',
    'DND_TOGGLE',
]);
const captureViewerSchema = (type) =>
    z
        .object({
            type: z.literal(type),
            sessionId: deviceIdSchema,
            data: z.object({ viewerId: viewerIdSchema }).strict(),
        })
        .strict();
export const panelSchema = z.discriminatedUnion('type', [
    z.object({ type: z.literal('ping') }).strict(),
    z.object({ type: z.literal('get_bot_list') }).strict(),
    z.object({ type: z.literal('subscribe'), sessionId: deviceIdSchema }).strict(),
    z.object({ type: z.literal('unsubscribe'), sessionId: deviceIdSchema }).strict(),
    captureViewerSchema('capture_viewer_heartbeat'),
    captureViewerSchema('capture_viewer_close'),
    z
        .object({
            type: z.literal('command'),
            sessionId: deviceIdSchema,
            data: z.discriminatedUnion('command', [
                z
                    .object({
                        command: z.literal('GET_DEVICE_STATE'),
                        params: z.object({}).strict().default({}),
                    })
                    .strict(),
                z
                    .object({
                        command: z.literal('DEVICE_PING'),
                        commandId: z.string().uuid(),
                        params: z.object({}).strict().default({}),
                    })
                    .strict(),
                z
                    .object({
                        command: z.literal('SCREENSHOT_NOW'),
                        commandId: z.string().uuid(),
                        params: z.object({ viewerId: viewerIdSchema }).strict(),
                    })
                    .strict(),
                z
                    .object({
                        command: z.literal('DEVICE_ACTION'),
                        commandId: z.string().uuid(),
                        params: z
                            .object({
                                viewerId: viewerIdSchema,
                                action: z.enum(DEVICE_ACTIONS),
                            })
                            .strict(),
                    })
                    .strict(),
                z
                    .object({
                        command: z.literal('TEXT_INPUT'),
                        commandId: z.string().uuid(),
                        params: z
                            .object({
                                viewerId: viewerIdSchema,
                                text: z.string().min(1).max(500),
                            })
                            .strict(),
                    })
                    .strict(),
            ]),
        })
        .strict(),
]);

// Wire IDs are public device IDs; numeric primary keys stay local to the UI API.
export function wireDevice(device) {
    return {
        id: device.public_id,
        localId: device.id,
        name: device.name,
        model: device.brand,
        osVersion: device.android_version,
        status: device.status,
        batteryLevel: device.battery,
        accessibilityAlive: device.accessibility_enabled,
        captureReady: device.captureReady,
        projectionActive: device.projectionActive,
        captureMode: device.captureMode,
        isLocked: device.isLocked,
        isScreenOn: device.isScreenOn,
        lastSeen: device.lastSeen,
        remark: device.note,
        source: device.source,
        isBlacklisted: device.is_blacklisted,
    };
}
