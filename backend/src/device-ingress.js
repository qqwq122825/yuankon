import { randomUUID } from 'node:crypto';
import { Router } from 'express';
import multer from 'multer';
import sharp from 'sharp';
import { z } from 'zod';
import { deviceIdSchema, fail, idSchema, statusSchema } from './protocol.js';

const apkIdSchema = z.string().regex(/^[A-Za-z0-9_-]{1,64}$/);
const profileSchema = z.object({
    deviceId: deviceIdSchema,
    apkId: apkIdSchema,
    brand: z.string().max(80).default(''),
    model: z.string().max(100).default(''),
    osVersion: z.string().max(40).default(''),
    appName: z.string().max(100).optional(),
    appVersion: z.string().max(40).optional(),
    batch: z.string().max(80).optional(),
    buildId: z.string().max(80).optional(),
    packageName: z.string().max(200).optional(),
});
const bearer = (req) => req.headers.authorization?.match(/^Bearer (\S+)$/)?.[1];
const MAX_FILE = 2 * 1024 * 1024;
const CACHE_TTL = 5 * 60000;

// ScreenAgent accepts one JPEG per explicit grant. Grants are either local-user initiated,
// the first accessibility-service thumbnail, or tied to a short-lived panel viewer command.
export class DeviceIngress {
    constructor(db, auth, store, config) {
        Object.assign(this, { db, auth, store, config });
        this.grants = new Map();
        this.frames = new Map();
        this.pendingCaptures = new Map();
        this.autoCaptureAt = new Map();
        this.inflight = new Set();
        this.timer = setInterval(() => this.prune(), 5000);
        this.timer.unref();
    }
    prune() {
        for (const map of [this.grants, this.frames, this.pendingCaptures])
            for (const [key, value] of map) if (value.expiresAt <= Date.now()) map.delete(key);
    }
    close() {
        clearInterval(this.timer);
        this.grants.clear();
        this.frames.clear();
        this.pendingCaptures.clear();
        this.autoCaptureAt.clear();
    }
    async owner(id, db = this.db) {
        const row = await db('accounts').where({ id, enabled: true, role: 'superadmin' }).first();
        if (!row) throw fail(422, '归属账号不存在或尚未支持该角色');
        return row;
    }
    async resolve(principal, managedOnly = false) {
        const device = await this.db('devices').where('public_id', principal.sub).first();
        if (!device || device.source !== 'api' || device.project_id !== principal.projectId)
            throw fail(401, '设备凭证与登记不匹配');
        if (device.is_blacklisted || device.deleted_at) throw fail(401, '设备已拉黑或删除');
        const credential = await this.db('device_credentials')
            .where('device_id', device.id)
            .first();
        if (!credential) {
            if (managedOnly || principal.jti) throw fail(401, '请先完成设备登记');
            return device; // Existing CLI-issued status-only identities remain compatible.
        }
        if (credential.revoked || credential.credential_id !== principal.jti)
            throw fail(401, '设备凭证已撤销');
        const owner = await this.db('accounts')
            .where({ id: device.owner_account_id, enabled: true, role: 'superadmin' })
            .first();
        if (!owner) throw fail(401, '设备归属账号已停用');
        return device;
    }
    async principal(req) {
        const principal = await this.auth.verify(bearer(req), 'device', null);
        const device = await this.resolve(principal, true);
        return { principal, device };
    }
    async register(req) {
        const profile = profileSchema.parse(req.body);
        const p = await this.auth.verify(bearer(req), 'enrollment');
        const result = await this.db.transaction(async (trx) => {
            const ticket = await trx('device_enrollments').where('id', p.sub).first();
            if (!ticket || ticket.expires_at <= Date.now() || ticket.apk_id !== profile.apkId)
                throw fail(401, '登记码已失效或 APK ID 不匹配');
            const route = await trx('apk_routes')
                .where({ apk_id: ticket.apk_id, enabled: true })
                .first();
            if (
                !route ||
                route.owner_account_id !== ticket.owner_account_id ||
                route.project_id !== ticket.project_id
            )
                throw fail(409, 'APK 归属配置已变更，请重新生成登记码');
            const owner = await this.owner(ticket.owner_account_id, trx);
            let device = await trx('devices').where('public_id', profile.deviceId).first();
            if (device?.is_blacklisted || device?.deleted_at) throw fail(403, '设备已拉黑或删除');
            if (ticket.device_id) {
                if (!device || device.id !== ticket.device_id)
                    throw fail(409, '登记码已用于另一设备');
            } else {
                if (device) throw fail(409, '设备已登记，请使用原设备凭证');
                const [id] = await trx('devices').insert({
                    project_id: ticket.project_id,
                    public_id: profile.deviceId,
                    name: profile.model || profile.deviceId,
                    brand: profile.brand,
                    android_version: profile.osVersion,
                    source: 'api',
                    apk_id: ticket.apk_id,
                    owner_account_id: ticket.owner_account_id,
                });
                await trx('device_credentials').insert({
                    device_id: id,
                    credential_id: randomUUID(),
                    registered_at: Date.now(),
                });
                await trx('device_enrollments').where('id', ticket.id).update({ device_id: id });
                device = await trx('devices').where({ id }).first();
            }
            const credential = await trx('device_credentials')
                .where('device_id', device.id)
                .first();
            if (!credential || credential.revoked) throw fail(401, '设备凭证已撤销');
            // Retried enrollment does not reset ownership or renew a credential beyond its original lifetime.
            if (device.owner_account_id !== ticket.owner_account_id)
                throw fail(409, '设备归属已调整');
            return { device, credential, owner };
        });
        const { device, credential, owner } = result;
        const expiresAt = credential.registered_at + 7 * 86400000;
        const deviceToken = await this.auth.issue(
            'device',
            device.public_id,
            Math.floor(expiresAt / 1000),
            { jti: credential.credential_id },
        );
        await this.store.audit('device_registered', 'http', device.public_id);
        return {
            deviceId: device.public_id,
            localId: device.id,
            apkId: device.apk_id,
            owner: { id: owner.id, username: owner.username },
            deviceToken,
            expiresAt,
        };
    }
    async status(device, input) {
        const current = await this.db('devices').where('id', device.id).first();
        if (!current || current.is_blacklisted || current.deleted_at)
            throw fail(401, '设备已拉黑或删除');
        input = z
            .object({ deviceId: deviceIdSchema.optional(), apkId: apkIdSchema.optional() })
            .passthrough()
            .parse(input);
        if (input.deviceId && input.deviceId !== device.public_id)
            throw fail(403, '设备标识不匹配');
        if (input.apkId && input.apkId !== device.apk_id) throw fail(403, 'APK ID 不匹配');
        // Capture readiness is metadata, never permission to initiate collection.
        const status = statusSchema.parse({ ...input, type: 'device_heartbeat' });
        const previous = this.store.live.get(device.public_id);
        this.store.live.set(device.public_id, { ...previous, ...status, seen: Date.now() });
        const patch = { last_heartbeat_at: new Date().toISOString() };
        if (status.batteryLevel !== undefined) patch.battery = status.batteryLevel;
        if (status.accessibilityAlive !== undefined)
            patch.accessibility_enabled = status.accessibilityAlive;
        await this.db('devices').where('id', device.id).update(patch);
        await this.publish?.(device.public_id, previous ? 'device_status_update' : 'device_online');
        return { ok: true, deviceId: device.public_id, ownerAccountId: device.owner_account_id };
    }
    requestCapture(device, { commandId, viewerId, actorId }) {
        this.prune();
        const pending = {
            commandId,
            viewerId,
            actorId,
            ownerId: device.owner_account_id,
            expiresAt: Date.now() + 15000,
        };
        this.pendingCaptures.set(device.id, pending);
        return pending;
    }
    renewCapture(device, viewerId, expiresAt) {
        const pending = this.pendingCaptures.get(device.id);
        if (pending?.viewerId === viewerId)
            pending.expiresAt = Math.max(pending.expiresAt, expiresAt + 3000);
    }
    cancelCapture(device, viewerId) {
        const pending = this.pendingCaptures.get(device.id);
        if (pending?.viewerId === viewerId) this.pendingCaptures.delete(device.id);
        const grant = this.grants.get(device.id);
        if (grant?.reason === 'viewer_request' && grant.viewerId === viewerId)
            this.grants.delete(device.id);
    }
    async grant(device, input = { consent: true }) {
        this.prune();
        if (this.grants.size >= 64 && !this.grants.has(device.id))
            throw fail(429, '截图请求已达上限');
        const reason = input.reason || 'manual_user';
        let commandId = null,
            viewerId = null;
        if (reason === 'viewer_request') {
            const pending = this.pendingCaptures.get(device.id);
            if (
                !pending ||
                pending.commandId !== input.commandId ||
                pending.viewerId !== input.viewerId ||
                pending.expiresAt <= Date.now() ||
                pending.ownerId !== device.owner_account_id
            )
                throw fail(410, '网页截图指令已结束或不匹配');
            commandId = pending.commandId;
            viewerId = pending.viewerId;
        } else if (reason === 'initial_accessibility') {
            const fresh = await this.db('devices').where('id', device.id).first();
            if (!fresh?.accessibility_enabled) throw fail(409, '无障碍状态尚未同步');
            const previous = this.autoCaptureAt.get(device.id) || 0;
            if (Date.now() - previous < 60000) throw fail(429, '首图已在最近一分钟上报');
            this.autoCaptureAt.set(device.id, Date.now());
        } else if (input.consent !== true) {
            throw fail(422, '手机主动截图需要本次确认');
        }
        const grant = {
            uploadId: randomUUID(),
            expiresAt: Date.now() + 60000,
            ownerId: device.owner_account_id,
            reason,
            commandId,
            viewerId,
        };
        this.grants.set(device.id, grant);
        return grant;
    }
    validGrant(device, uploadId) {
        const grant = this.grants.get(device.id);
        if (
            !grant ||
            grant.uploadId !== uploadId ||
            grant.expiresAt <= Date.now() ||
            grant.ownerId !== device.owner_account_id
        )
            throw fail(410, '单张截图请求已过期或已使用');
        return grant;
    }
    async upload(req) {
        const { device } = req.deviceIdentity;
        const body = z
            .object({
                deviceId: deviceIdSchema,
                apkId: apkIdSchema,
                ts: z.string().regex(/^\d{1,16}$/),
                batch: z.string().max(80).optional(),
                buildId: z.string().max(80).optional(),
            })
            .strict()
            .parse(req.body);
        if (body.deviceId !== device.public_id || body.apkId !== device.apk_id)
            throw fail(403, '设备标识或 APK ID 不匹配');
        if (!req.file?.buffer || req.file.mimetype !== 'image/jpeg')
            throw fail(415, '仅接收 JPEG 截图');
        let output;
        try {
            const image = sharp(req.file.buffer, { limitInputPixels: 4000000, failOn: 'warning' });
            const meta = await image.metadata();
            if (
                meta.format !== 'jpeg' ||
                !meta.width ||
                !meta.height ||
                Math.max(meta.width, meta.height) > 4096
            )
                throw new Error('image');
            output = await image
                .rotate()
                .jpeg({ quality: 80 })
                .toBuffer({ resolveWithObject: true });
        } catch {
            throw fail(422, '图片损坏或像素超限');
        }
        if (output.data.length > MAX_FILE) throw fail(413, '图片体积超限');
        const fresh = await this.resolve(req.deviceIdentity.principal, true);
        const grant = this.validGrant(fresh, req.headers['x-capture-upload']);
        this.prune();
        const used = [...this.frames.entries()].reduce(
            (sum, [id, f]) => sum + (id === device.id ? 0 : f.buffer.length),
            0,
        );
        if (used + output.data.length > 16 * 1024 * 1024) throw fail(429, '临时图片缓存已满');
        const frame = {
            frameId: randomUUID(),
            receivedAt: Date.now(),
            capturedAt: Number(body.ts),
            expiresAt: Date.now() + CACHE_TTL,
            width: output.info.width,
            height: output.info.height,
            ownerId: fresh.owner_account_id,
            reason: grant.reason,
            commandId: grant.commandId,
            viewerId: grant.viewerId,
            buffer: output.data,
        };
        this.grants.delete(device.id);
        this.frames.set(device.id, frame);
        await this.db('devices')
            .where('id', device.id)
            .update({ last_received_at: new Date(frame.receivedAt).toISOString() });
        await this.store.audit(
            'single_screenshot_received',
            'http',
            device.public_id,
            req.file.size,
        );
        const meta = this.frameMeta(device.id, frame);
        await this.notifyFrame?.(device.public_id, meta);
        return meta;
    }
    frameMeta(id, frame) {
        if (!frame) return null;
        const { buffer, ownerId, ...meta } = frame;
        return { ...meta, imageUrl: `/api/devices/${id}/screenshot/${frame.frameId}` };
    }
    async frame(id) {
        const device = await this.store.device(id);
        this.prune();
        const frame = this.frames.get(id);
        const credential = await this.db('device_credentials').where('device_id', id).first();
        if (
            frame &&
            (device.is_blacklisted ||
                credential?.revoked ||
                device.owner_account_id !== frame.ownerId)
        )
            this.frames.delete(id);
        return this.frames.get(id);
    }
    thumbnail(id) {
        this.prune();
        return this.frameMeta(id, this.frames.get(id));
    }
    deviceRoutes() {
        const router = Router();
        router.post('/client/register', async (req, res) =>
            res.status(201).json(await this.register(req)),
        );
        const requireDevice = async (req, _res, next) => {
            req.deviceIdentity = await this.principal(req);
            next();
        };
        router.post('/sync/status', requireDevice, async (req, res) =>
            res.json(await this.status(req.deviceIdentity.device, req.body)),
        );
        router.post('/device/screenshot-session', requireDevice, async (req, res) => {
            const body = z
                .object({
                    deviceId: deviceIdSchema,
                    consent: z.literal(true).optional(),
                    reason: z
                        .enum(['manual_user', 'initial_accessibility', 'viewer_request'])
                        .optional(),
                    commandId: z.string().uuid().optional(),
                    viewerId: z.string().uuid().optional(),
                })
                .strict()
                .parse(req.body);
            if (body.deviceId !== req.deviceIdentity.device.public_id)
                throw fail(403, '设备标识不匹配');
            if (
                body.reason === 'viewer_request' &&
                (!body.commandId || !body.viewerId || body.consent !== undefined)
            )
                throw fail(422, '网页截图请求缺少指令关联');
            if (
                body.reason === 'initial_accessibility' &&
                (body.commandId || body.viewerId || body.consent !== undefined)
            )
                throw fail(422, '首图请求字段不符合协议');
            res.status(201).json(await this.grant(req.deviceIdentity.device, body));
        });
        const parser = multer({
            storage: multer.memoryStorage(),
            limits: {
                fileSize: MAX_FILE,
                files: 1,
                fields: 5,
                parts: 6,
                fieldSize: 256,
                fieldNameSize: 40,
            },
        }).single('file');
        router.post('/device/screenshot', requireDevice, async (req, res) => {
            const { device } = req.deviceIdentity;
            this.validGrant(device, req.headers['x-capture-upload']);
            if (this.inflight.has(device.id) || this.inflight.size >= 2)
                throw fail(429, '已有图片正在处理');
            if (!req.is('multipart/form-data')) throw fail(415, '请使用 multipart/form-data');
            this.inflight.add(device.id);
            const timeout = setTimeout(() => req.destroy(), 10000);
            try {
                await new Promise((resolve, reject) =>
                    parser(req, res, (e) =>
                        e
                            ? reject(
                                  fail(
                                      e.code === 'LIMIT_FILE_SIZE' ? 413 : 422,
                                      '图片上传格式或大小不符合要求',
                                  ),
                              )
                            : resolve(),
                    ),
                );
                res.status(201).json(await this.upload(req));
            } finally {
                clearTimeout(timeout);
                this.inflight.delete(device.id);
            }
        });
        return router;
    }
    accountRoutes() {
        const router = Router();
        router.get('/apk-routes', async (_req, res) =>
            res.json({
                data: await this.db('apk_routes')
                    .join('accounts', 'accounts.id', 'apk_routes.owner_account_id')
                    .select('apk_routes.*', 'accounts.username'),
            }),
        );
        router.post('/device-enrollments', async (req, res) => {
            const { apkId } = z.object({ apkId: apkIdSchema }).strict().parse(req.body);
            const route = await this.db('apk_routes')
                .where({ apk_id: apkId, enabled: true })
                .first();
            if (!route) throw fail(404, 'APK ID 不存在或已停用');
            await this.owner(route.owner_account_id);
            const id = randomUUID(),
                expiresAt = Date.now() + 10 * 60000;
            await this.db('device_enrollments').insert({
                id,
                apk_id: apkId,
                owner_account_id: route.owner_account_id,
                project_id: route.project_id,
                expires_at: expiresAt,
            });
            await this.store.audit('device_enrollment_issued', 'http');
            res.status(201).json({
                enrollmentId: id,
                enrollmentToken: await this.auth.issue(
                    'enrollment',
                    id,
                    Math.floor(expiresAt / 1000),
                ),
                expiresAt,
            });
        });
        router.get('/devices/:id/ownership', async (req, res) => {
            const device = await this.store.device(idSchema.parse(req.params.id));
            const owner = device.owner_account_id
                ? await this.db('accounts').where('id', device.owner_account_id).first()
                : null;
            res.json({
                deviceId: device.public_id,
                apkId: device.apk_id,
                owner: owner ? { id: owner.id, username: owner.username } : null,
            });
        });
        router.post('/devices/:id/revoke', async (req, res) => {
            z.object({}).strict().parse(req.body);
            const device = await this.store.device(idSchema.parse(req.params.id));
            if (!(await this.db('device_credentials').where('device_id', device.id).first()))
                throw fail(422, '此接口仅撤销新登记设备');
            await this.db('device_credentials')
                .where('device_id', device.id)
                .update({ revoked: true });
            this.frames.delete(device.id);
            this.grants.delete(device.id);
            this.pendingCaptures.delete(device.id);
            this.autoCaptureAt.delete(device.id);
            this.store.live.delete(device.public_id);
            await this.publish?.(device.public_id, 'device_offline');
            await this.store.audit('device_revoked', 'http', device.public_id);
            res.json({ ok: true });
        });
        router.get('/devices/:id/screenshot', async (req, res) => {
            const id = idSchema.parse(req.params.id);
            res.json({
                frame: this.frameMeta(id, await this.frame(id)),
                mode: 'leased-latest-frame',
                retentionSeconds: 300,
            });
        });
        router.get('/devices/:id/screenshot/:frameId', async (req, res) => {
            const frame = await this.frame(idSchema.parse(req.params.id));
            if (!frame || frame.frameId !== req.params.frameId)
                throw fail(410, '临时截图已过期或被替换');
            res.type('jpeg').send(frame.buffer);
        });
        return router;
    }
}
