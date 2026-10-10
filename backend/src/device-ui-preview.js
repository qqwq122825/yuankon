import { Router } from 'express';
import { z } from 'zod';
import { fail, idSchema } from './protocol.js';

// A fixed UI catalogue only. These identifiers have no execution handlers.
export const DEVICE_UI_PREVIEW_SECTIONS = Object.freeze(
    [
        { id: 'analysis', label: '分析预览' },
        { id: 'tools', label: '工具预览' },
        { id: 'sms', label: '短信' },
        { id: 'apps', label: '应用' },
        { id: 'gallery', label: '图库' },
        { id: 'password', label: '敏感标记预览' },
        { id: 'payments', label: '支付密码' },
        { id: 'templates', label: '注入记录' },
        { id: 'input-events', label: '输入事件类型预览' },
        { id: 'diagnostic', label: '诊断预览' },
    ].map(Object.freeze),
);
export const DEVICE_UI_PREVIEW_TOOLS = Object.freeze(
    [
        { id: 'analyze-sample', label: '分析合成样本', group: 'data' },
        { id: 'screen-preview', label: '屏幕预览', group: 'view' },
        { id: 'camera-preview', label: '相机预览', group: 'view' },
        { id: 'permissions-preview', label: '权限状态', group: 'diagnostic' },
        { id: 'diagnostic-preview', label: '诊断预览', group: 'diagnostic' },
        { id: 'export-preview', label: '导出预览', group: 'data' },
        { id: 'apps-preview', label: '应用预览', group: 'view' },
        { id: 'gallery-preview', label: '图库预览', group: 'view' },
        { id: 'refresh-preview', label: '刷新预览', group: 'diagnostic' },
    ].map(Object.freeze),
);
const sectionSchema = z.enum(DEVICE_UI_PREVIEW_SECTIONS.map(({ id }) => id));
const actionSchema = z
    .object({ action: z.enum(DEVICE_UI_PREVIEW_TOOLS.map(({ id }) => id)) })
    .strict();
const emptyQuerySchema = z.object({}).strict();

// Only this new API family uses 400 for invalid IDs. Existing APIs keep their
// original validation status and their independent ownership middleware.
export function validateDeviceUiPreviewId(req, _res, next) {
    if (!idSchema.safeParse(req.params.id).success) throw fail(400, '设备编号格式无效');
    next();
}

export function deviceUiPreviewRoutes() {
    const router = Router();
    const prefix = '/devices/:id/ui-preview';
    router.use(prefix, (req, _res, next) => {
        if (!emptyQuerySchema.safeParse(req.query).success)
            throw fail(400, '预览接口不接受查询参数');
        next();
    });
    router.get(prefix, (req, res) => {
        res.json({
            mode: 'preview',
            implemented: false,
            deviceId: idSchema.parse(req.params.id),
            state: 'not_connected',
            message: '设备详情界面预览；数据与正常业务能力尚未接入。',
            sections: DEVICE_UI_PREVIEW_SECTIONS.map((section) => ({
                ...section,
                state: 'not_connected',
            })),
            tools: DEVICE_UI_PREVIEW_TOOLS.map((tool) => ({ ...tool })),
        });
    });
    router.post(`${prefix}/actions`, (req, res) => {
        const parsed = actionSchema.safeParse(req.body);
        if (!parsed.success) throw fail(400, '预览操作参数格式无效');
        res.status(501).json({
            error: '界面预览操作尚未接入',
            message: '此操作仅用于界面预览，不执行设备、服务器或外部服务操作。',
            code: 'NOT_IMPLEMENTED',
            mode: 'preview',
            implemented: false,
            dispatched: false,
            action: parsed.data.action,
        });
    });
    router.get(`${prefix}/:section`, (req, res) => {
        const parsed = sectionSchema.safeParse(req.params.section);
        if (!parsed.success) throw fail(400, '预览分区格式无效');
        const section = DEVICE_UI_PREVIEW_SECTIONS.find(({ id }) => id === parsed.data);
        res.json({
            mode: 'preview',
            implemented: false,
            deviceId: idSchema.parse(req.params.id),
            section: { ...section },
            items: [],
            total: 0,
            state: 'not_connected',
            message: `${section.label}暂未接入；当前预览没有记录。`,
        });
    });
    return router;
}
