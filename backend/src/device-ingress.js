import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { mkdir, writeFile } from 'node:fs/promises';
import { Router } from 'express';
import multer from 'multer';
import { rateLimit } from 'express-rate-limit';
import sharp from 'sharp';
import { z } from 'zod';
import { privateFile } from './files.js';
import {
    deviceIdSchema,
    fail,
    idSchema,
    normalizeLiveSnapshot,
    statusSchema,
    structuralLabelsFor,
} from './protocol.js';

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
const profileMetadata = (profile, current = {}) => ({
    app_name: profile.appName ?? current.app_name ?? '',
    app_version: profile.appVersion ?? current.app_version ?? '',
    package_name: profile.packageName ?? current.package_name ?? '',
    batch: profile.batch ?? current.batch ?? '',
    build_id: profile.buildId ?? current.build_id ?? '',
});
const debugReportSchema = z
    .object({
        sessionId: z.string().uuid(),
        events: z
            .array(
                z
                    .object({
                        ts: z.number().int().min(0).optional(),
                        level: z.enum(['info', 'warn', 'error']).default('info'),
                        source: z.enum([
                            'http',
                            'websocket',
                            'mediaprojection',
                            'taskscreenshot',
                            'capture',
                            'service',
                        ]),
                        stage: z.string().regex(/^[A-Za-z0-9_.:-]{1,80}$/),
                        message: z.string().max(300).default(''),
                        elapsedMs: z.number().int().min(0).max(3600000).nullable().optional(),
                        captureMode: z
                            .enum(['PROJECTION', 'ACCESSIBILITY', 'projection', 'accessibility'])
                            .nullable()
                            .optional(),
                        commandId: z.string().uuid().nullable().optional(),
                        details: z
                            .record(
                                z.string(),
                                z.union([z.string(), z.number(), z.boolean(), z.null()]),
                            )
                            .default({}),
                    })
                    .strict(),
            )
            .min(1)
            .max(50),
    })
    .strict();
const debugPublicState = (state) =>
    state
        ? { active: true, sessionId: state.sessionId, startedAt: state.startedAt }
        : { active: false, sessionId: null, startedAt: null };
const debugScreenshotSchema = z
    .object({
        sessionId: z.string().uuid(),
        source: z.enum(['mediaprojection', 'taskscreenshot']),
        stage: z
            .string()
            .regex(/^[A-Za-z0-9_.:-]{1,80}$/)
            .default('debug_screenshot'),
        elapsedMs: z.coerce.number().int().min(0).max(3600000).nullable().optional(),
        captureMode: z
            .enum(['PROJECTION', 'ACCESSIBILITY', 'projection', 'accessibility'])
            .optional(),
        commandId: z.string().uuid().optional(),
        ts: z.coerce.number().int().min(0).optional(),
    })
    .strict();

// ScreenAgent accepts one JPEG per explicit grant. Grants are either local-user initiated,
// the first accessibility-service thumbnail, or tied to a short-lived panel viewer command.
export class DeviceIngress {
    constructor(db, auth, store, config) {
        Object.assign(this, { db, auth, store, config });
        this.grants = new Map();
        this.frames = new Map();
        this.recentImages = new Map();
        this.tapFrames = new Map();
        this.nodeFrames = new Map();
        this.viewerLeases = new Map();
        this.pendingCaptures = new Map();
        this.autoCaptureAt = new Map();
        this.debugSessions = new Map();
        this.inflight = new Set();
        this.timer = setInterval(() => this.prune(), 5000);
        this.timer.unref();
    }
    prune() {
        for (const [id, frames] of this.recentImages) {
            const recent = frames.filter((f) => Date.now() - f.receivedAt <= 3000);
            if (recent.length) this.recentImages.set(id, recent);
            else this.recentImages.delete(id);
        }
        for (const [id, frames] of this.tapFrames) {
            const recent = frames.filter((f) => Date.now() - f.receivedAt <= 5000);
            if (recent.length) this.tapFrames.set(id, recent);
            else this.tapFrames.delete(id);
        }
        for (const map of [
            this.grants,
            this.frames,
            this.nodeFrames,
            this.viewerLeases,
            this.pendingCaptures,
        ])
            for (const [key, value] of map) if (value.expiresAt <= Date.now()) map.delete(key);
    }
    close() {
        clearInterval(this.timer);
        this.grants.clear();
        this.frames.clear();
        this.recentImages.clear();
        this.tapFrames.clear();
        this.nodeFrames.clear();
        this.viewerLeases.clear();
        this.pendingCaptures.clear();
        this.autoCaptureAt.clear();
        this.debugSessions.clear();
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
        req.clientLogDeviceId = profile.deviceId;
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
                    ...profileMetadata(profile),
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
    async online(req) {
        const profile = profileSchema.parse(req.body);
        req.clientLogDeviceId = profile.deviceId;
        const now = Date.now();
        const result = await this.db.transaction(async (trx) => {
            const route = await trx('apk_routes')
                .where({ apk_id: profile.apkId, enabled: true })
                .first();
            if (!route) throw fail(404, 'APK ID 不存在或已停用');
            const owner = await this.owner(route.owner_account_id, trx);
            let device = await trx('devices').where('public_id', profile.deviceId).first();
            if (device?.is_blacklisted || device?.deleted_at) throw fail(403, '设备已拉黑或删除');
            if (
                device &&
                (device.source !== 'api' ||
                    device.project_id !== route.project_id ||
                    device.apk_id !== route.apk_id ||
                    device.owner_account_id !== route.owner_account_id)
            )
                throw fail(409, '设备标识已用于其他归属');
            let created = false;
            if (!device) {
                const [id] = await trx('devices').insert({
                    project_id: route.project_id,
                    public_id: profile.deviceId,
                    name: profile.model || profile.deviceId,
                    brand: profile.brand,
                    android_version: profile.osVersion,
                    source: 'api',
                    apk_id: route.apk_id,
                    owner_account_id: route.owner_account_id,
                    ...profileMetadata(profile),
                });
                await trx('device_credentials').insert({
                    device_id: id,
                    credential_id: randomUUID(),
                    registered_at: now,
                });
                device = await trx('devices').where({ id }).first();
                created = true;
            } else {
                await trx('devices')
                    .where('id', device.id)
                    .update({
                        name: profile.model || device.name,
                        brand: profile.brand || device.brand,
                        android_version: profile.osVersion || device.android_version,
                        ...profileMetadata(profile, device),
                    });
            }
            let credential = await trx('device_credentials').where('device_id', device.id).first();
            if (!credential) {
                await trx('device_credentials').insert({
                    device_id: device.id,
                    credential_id: randomUUID(),
                    registered_at: now,
                });
                credential = await trx('device_credentials').where('device_id', device.id).first();
            }
            if (credential.revoked) throw fail(403, '设备凭证已撤销');
            return { device, credential, owner, created };
        });
        const expiresAt = now + 30 * 86400000;
        const deviceToken = await this.auth.issue(
            'device',
            result.device.public_id,
            Math.floor(expiresAt / 1000),
            { jti: result.credential.credential_id },
        );
        await this.store.audit(
            result.created ? 'device_auto_registered' : 'device_auto_renewed',
            'http',
            result.device.public_id,
        );
        return {
            deviceId: result.device.public_id,
            localId: result.device.id,
            apkId: result.device.apk_id,
            owner: { id: result.owner.id, username: result.owner.username },
            deviceToken,
            expiresAt,
            heartbeatSeconds: 20,
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
        return {
            ok: true,
            deviceId: device.public_id,
            ownerAccountId: device.owner_account_id,
            debug: this.debugState(device),
        };
    }

    debugState(device) {
        const state = this.debugSessions.get(device.id);
        if (!state || state.ownerId !== device.owner_account_id) return debugPublicState(null);
        return debugPublicState(state);
    }

    async debugSession(id, active) {
        const device = await this.store.device(id);
        if (active) {
            const previous = this.debugSessions.get(device.id);
            if (previous?.ownerId === device.owner_account_id)
                return this.debugSummary(device, previous);
            const state = {
                sessionId: randomUUID(),
                ownerId: device.owner_account_id,
                startedAt: Date.now(),
            };
            this.debugSessions.set(device.id, state);
            await this.store.audit('device_debug_started', 'panel', device.public_id);
            return this.debugSummary(device, state);
        }
        this.debugSessions.delete(device.id);
        await this.store.audit('device_debug_stopped', 'panel', device.public_id);
        return this.debugSummary(device, null);
    }

    async debugSummary(device, state = this.debugSessions.get(device.id)) {
        return {
            ...debugPublicState(state?.ownerId === device.owner_account_id ? state : null),
            retention: 'debug-screenshots-private',
            events: await this.debugEvents(device.id, { limit: 100 }),
        };
    }

    async debugEvents(id, { afterId = 0, limit = 100 } = {}) {
        await this.store.device(id);
        const rows = await this.db('device_debug_reports')
            .where('device_id', id)
            .where('id', '>', afterId)
            .orderBy('id', 'asc')
            .limit(limit);
        return rows.map((row) => ({
            ...row,
            imageUrl: row.screenshot_path ? `/api/devices/${id}/debug-screenshot/${row.id}` : null,
        }));
    }

    async recordDebugReport(device, input) {
        const report = debugReportSchema.parse(input);
        const state = this.debugSessions.get(device.id);
        if (
            !state ||
            state.sessionId !== report.sessionId ||
            state.ownerId !== device.owner_account_id
        )
            return { ok: true, stored: 0, active: false };
        const now = Date.now();
        const rows = report.events.map((event) => ({
            project_id: device.project_id,
            device_id: device.id,
            public_id: device.public_id,
            session_id: state.sessionId,
            ts: event.ts || now,
            level: event.level,
            source: event.source,
            stage: event.stage,
            message: event.message,
            elapsed_ms: event.elapsedMs ?? null,
            capture_mode: event.captureMode ?? null,
            command_id: event.commandId ?? null,
            details: Object.keys(event.details || {}).length
                ? JSON.stringify(event.details).slice(0, 4096)
                : null,
            screenshot_path: null,
            screenshot_width: null,
            screenshot_height: null,
            screenshot_size: null,
        }));
        await this.db('device_debug_reports').insert(rows);
        await this.store.audit('device_debug_report', 'device', device.public_id, rows.length);
        return { ok: true, stored: rows.length, active: true };
    }

    async recordDebugScreenshot(req) {
        const { device } = req.deviceIdentity;
        const body = debugScreenshotSchema.parse(req.body);
        const state = this.debugSessions.get(device.id);
        if (
            !state ||
            state.sessionId !== body.sessionId ||
            state.ownerId !== device.owner_account_id
        )
            return { ok: true, stored: 0, active: false };
        if (!req.file?.buffer || req.file.mimetype !== 'image/jpeg')
            throw fail(415, '仅接收 JPEG 调试截图');
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
                .jpeg({ quality: 75 })
                .toBuffer({ resolveWithObject: true });
        } catch {
            throw fail(422, '调试截图损坏或像素超限');
        }
        if (output.data.length > MAX_FILE) throw fail(413, '调试截图体积超限');
        const dir = path.join(this.config.privateDir, 'debug-screenshots', String(device.id));
        await mkdir(dir, { recursive: true, mode: 0o700 });
        const filename = `${Date.now()}-${randomUUID()}.jpg`;
        const relative = `debug-screenshots/${device.id}/${filename}`;
        await writeFile(path.join(dir, filename), output.data, { mode: 0o600 });
        const [id] = await this.db('device_debug_reports').insert({
            project_id: device.project_id,
            device_id: device.id,
            public_id: device.public_id,
            session_id: state.sessionId,
            ts: body.ts || Date.now(),
            level: 'info',
            source: body.source,
            stage: body.stage,
            message: 'debug screenshot uploaded',
            elapsed_ms: body.elapsedMs ?? null,
            capture_mode: body.captureMode ?? null,
            command_id: body.commandId ?? null,
            details: JSON.stringify({ content: 'jpeg', retained: 'private-debug' }),
            screenshot_path: relative,
            screenshot_width: output.info.width,
            screenshot_height: output.info.height,
            screenshot_size: output.data.length,
        });
        await this.store.audit(
            'device_debug_screenshot',
            'device',
            device.public_id,
            output.data.length,
        );
        return {
            ok: true,
            stored: 1,
            active: true,
            id,
            imageUrl: `/api/devices/${device.id}/debug-screenshot/${id}`,
            width: output.info.width,
            height: output.info.height,
            size: output.data.length,
        };
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
        this.viewerLeases.set(device.id, {
            viewerId,
            ownerId: device.owner_account_id,
            expiresAt,
        });
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
        const lease = this.viewerLeases.get(device.id);
        if (lease?.viewerId === viewerId) {
            this.viewerLeases.delete(device.id);
            this.nodeFrames.delete(device.id);
        }
    }
    async receiveAccessibilitySnapshot(device, viewerId, input) {
        this.prune();
        const lease = this.viewerLeases.get(device.id);
        if (
            !lease ||
            lease.viewerId !== viewerId ||
            lease.ownerId !== device.owner_account_id ||
            lease.expiresAt <= Date.now()
        )
            throw fail(410, '阅读器查看租约已结束');
        const payload = normalizeLiveSnapshot(input);
        const nodeCount = payload.windows.reduce((sum, window) => sum + window.nodes.length, 0);
        const frame = {
            id: randomUUID(),
            source: 'live',
            captured_at: payload.captured_at,
            received_at: new Date().toISOString(),
            expiresAt: Math.min(lease.expiresAt + 3000, Date.now() + 30000),
            ownerId: device.owner_account_id,
            viewerId,
            node_count: nodeCount,
            window_count: payload.windows.length,
            payload,
            labels: structuralLabelsFor(payload),
        };
        this.nodeFrames.set(device.id, frame);
        await this.store.audit('accessibility_snapshot_received', 'device', device.public_id);
        return frame;
    }
    async accessibilitySnapshot(id, viewerId) {
        const device = await this.store.device(id);
        this.prune();
        const lease = this.viewerLeases.get(id);
        const frame = this.nodeFrames.get(id);
        const credential = await this.db('device_credentials').where('device_id', id).first();
        if (
            device.is_blacklisted ||
            credential?.revoked ||
            frame?.ownerId !== device.owner_account_id
        ) {
            if (frame) this.nodeFrames.delete(id);
            return null;
        }
        if (
            !lease ||
            lease.viewerId !== viewerId ||
            lease.ownerId !== device.owner_account_id ||
            !frame ||
            frame.viewerId !== viewerId
        )
            return null;
        const { ownerId, viewerId: _viewerId, expiresAt, ...safe } = frame;
        return { ...safe, expires_at: expiresAt };
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
    validateViewerStream(device, input) {
        const now = Date.now();
        const lease = this.viewerLeases.get(device.id);
        const pending = this.pendingCaptures.get(device.id);
        const live = this.store.live.get(device.public_id);
        if (
            !lease ||
            !pending ||
            lease.expiresAt <= now ||
            pending.expiresAt <= now ||
            lease.viewerId !== input.viewerId ||
            pending.viewerId !== input.viewerId ||
            pending.commandId !== input.commandId ||
            lease.ownerId !== device.owner_account_id ||
            pending.ownerId !== device.owner_account_id
        )
            throw fail(410, '实时查看心跳已过期或指令已变化');
        if (!live || now - live.seen >= 90000) throw fail(409, '设备心跳已过期');
        return { reason: 'viewer_request', commandId: pending.commandId, viewerId: lease.viewerId };
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
                commandId: z.string().uuid().optional(),
                viewerId: z.string().uuid().optional(),
            })
            .strict()
            .parse(req.body);
        if (body.deviceId !== device.public_id || body.apkId !== device.apk_id)
            throw fail(403, '设备标识或 APK ID 不匹配');
        if (!req.file?.buffer || req.file.mimetype !== 'image/jpeg')
            throw fail(415, '仅接收 JPEG 截图');
        const direct = req.headers['x-capture-mode'] === 'viewer-stream';
        if (direct) {
            if (!body.commandId || !body.viewerId || req.headers['x-capture-upload'])
                throw fail(422, '直接帧需要查看指令关联，不能混用单张许可');
            this.validateViewerStream(device, body);
        } else if (body.commandId || body.viewerId) throw fail(422, '旧单张上传不能附带连续帧字段');
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
            if (direct && !meta.exif && !meta.xmp && !meta.icc && !meta.iptc && !meta.orientation) {
                // Decode validation remains; Android's metadata-free JPEG need not be re-encoded.
                await image.resize(1, 1).raw().toBuffer();
                output = {
                    data: req.file.buffer,
                    info: { width: meta.width, height: meta.height },
                };
            } else {
                output = await image
                    .rotate()
                    .jpeg({ quality: 80 })
                    .toBuffer({ resolveWithObject: true });
            }
        } catch {
            throw fail(422, '图片损坏或像素超限');
        }
        if (output.data.length > MAX_FILE) throw fail(413, '图片体积超限');
        const fresh = await this.resolve(req.deviceIdentity.principal, true);
        const grant = direct
            ? this.validateViewerStream(fresh, body)
            : this.validGrant(fresh, req.headers['x-capture-upload']);
        this.prune();
        const previous = this.frames.get(device.id);
        const history = (this.recentImages.get(device.id) || []).filter(
            (f) => Date.now() - f.receivedAt <= 3000,
        );
        if (
            previous &&
            Date.now() - previous.receivedAt <= 3000 &&
            previous.ownerId === fresh.owner_account_id
        )
            history.push(previous);
        if (direct) this.recentImages.set(device.id, history.slice(-30));
        else this.recentImages.delete(device.id);
        const used = [...this.frames.entries()].reduce(
            (sum, [id, f]) => sum + (id === device.id ? 0 : f.buffer.length),
            0,
        );
        let historyBytes = [...this.recentImages.values()]
            .flat()
            .reduce((sum, f) => sum + f.buffer.length, 0);
        if (used + historyBytes + output.data.length > 16 * 1024 * 1024) {
            this.recentImages.clear();
            historyBytes = 0;
        }
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
        const recent = (this.tapFrames.get(device.id) || []).filter(
            (f) => Date.now() - f.receivedAt <= 5000,
        );
        recent.push({
            frameId: frame.frameId,
            receivedAt: frame.receivedAt,
            width: frame.width,
            height: frame.height,
            viewerId: frame.viewerId,
            ownerId: frame.ownerId,
        });
        this.tapFrames.set(device.id, recent.slice(-32));
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
    validateTap(device, viewerId, frameId) {
        const frame = (this.tapFrames.get(device.id) || []).find((f) => f.frameId === frameId);
        const latest = this.frames.get(device.id);
        if (
            !frame ||
            !latest ||
            frame.viewerId !== viewerId ||
            latest.viewerId !== viewerId ||
            frame.ownerId !== device.owner_account_id ||
            latest.ownerId !== device.owner_account_id ||
            device.is_blacklisted ||
            device.status === 'offline' ||
            frame.width !== latest.width ||
            frame.height !== latest.height ||
            Date.now() - frame.receivedAt > 5000 ||
            latest.expiresAt <= Date.now()
        )
            throw fail(410, '截图已变化，请重新点击');
        return frame;
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
        ) {
            this.frames.delete(id);
            this.recentImages.delete(id);
        }
        return this.frames.get(id);
    }
    thumbnail(id) {
        this.prune();
        return this.frameMeta(id, this.frames.get(id));
    }
    deviceRoutes() {
        const router = Router();
        const requestPaths = new Set([
            '/client/online',
            '/client/register',
            '/sync/status',
            '/device/screenshot-session',
            '/device/screenshot',
            '/device/debug-report',
            '/device/debug-screenshot',
        ]);
        router.use((req, res, next) => {
            if (!requestPaths.has(req.path)) return next();
            const started = Date.now();
            res.once('finish', () => {
                const rawSize = Number(req.get('content-length') || 0);
                const size = Number.isSafeInteger(rawSize)
                    ? Math.max(0, Math.min(rawSize, 10 * 1024 * 1024))
                    : 0;
                this.store
                    .audit(
                        'client_request',
                        'client',
                        req.deviceIdentity?.device?.public_id || req.clientLogDeviceId || null,
                        size,
                        'up',
                        {
                            method: req.method,
                            path: `/api${req.path}`,
                            status: res.statusCode,
                            durationMs: Date.now() - started,
                        },
                    )
                    .catch(() => {});
            });
            next();
        });
        router.post('/client/online', async (req, res) =>
            res.status(201).json(await this.online(req)),
        );
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
                fields: 8,
                parts: 9,
                fieldSize: 256,
                fieldNameSize: 40,
            },
        }).single('file');
        router.post('/device/debug-report', requireDevice, async (req, res) => {
            res.json(await this.recordDebugReport(req.deviceIdentity.device, req.body));
        });
        router.post('/device/debug-screenshot', requireDevice, async (req, res) => {
            const timeout = setTimeout(() => req.destroy(), 10000);
            try {
                await new Promise((resolve, reject) =>
                    parser(req, res, (e) =>
                        e
                            ? reject(
                                  fail(
                                      e.code === 'LIMIT_FILE_SIZE' ? 413 : 422,
                                      '调试截图上传格式或大小不符合要求',
                                  ),
                              )
                            : resolve(),
                    ),
                );
                res.status(201).json(await this.recordDebugScreenshot(req));
            } finally {
                clearTimeout(timeout);
            }
        });
        const frameLimit = rateLimit({
            windowMs: 1000,
            limit: 30,
            keyGenerator: (req) => req.deviceIdentity.device.public_id,
            skip: (req) => req.headers['x-capture-mode'] !== 'viewer-stream',
            standardHeaders: 'draft-8',
            legacyHeaders: false,
            message: { error: '截图帧过快，请稍后重试' },
        });
        router.post('/device/screenshot', requireDevice, frameLimit, async (req, res) => {
            const { device } = req.deviceIdentity;
            if (req.headers['x-capture-mode'] !== 'viewer-stream')
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
            this.nodeFrames.delete(device.id);
            this.viewerLeases.delete(device.id);
            this.grants.delete(device.id);
            this.pendingCaptures.delete(device.id);
            this.autoCaptureAt.delete(device.id);
            this.debugSessions.delete(device.id);
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
        router.get('/devices/:id/debug-session', async (req, res) => {
            const device = await this.store.device(idSchema.parse(req.params.id));
            res.json(await this.debugSummary(device));
        });
        router.post('/devices/:id/debug-session', async (req, res) => {
            const input = z.object({ active: z.boolean() }).strict().parse(req.body);
            res.json(await this.debugSession(idSchema.parse(req.params.id), input.active));
        });
        router.get('/devices/:id/debug-events', async (req, res) => {
            const query = z
                .object({
                    afterId: z.coerce.number().int().min(0).default(0),
                    limit: z.coerce.number().int().min(1).max(200).default(100),
                })
                .parse(req.query);
            res.json({ data: await this.debugEvents(idSchema.parse(req.params.id), query) });
        });
        router.get('/devices/:id/debug-screenshot/:debugId', async (req, res) => {
            const id = idSchema.parse(req.params.id);
            await this.store.device(id);
            const row = await this.db('device_debug_reports')
                .where({ id: idSchema.parse(req.params.debugId), device_id: id })
                .first();
            if (!row?.screenshot_path) throw fail(404, '调试截图不存在');
            res.type('jpeg').send(
                await privateFile(
                    this.config.privateDir,
                    row.screenshot_path,
                    'debug-screenshots/',
                ),
            );
        });
        router.get('/devices/:id/accessibility-snapshot', async (req, res) => {
            const id = idSchema.parse(req.params.id);
            const viewerId = z.string().uuid().parse(req.query.viewerId);
            res.json({
                snapshot: await this.accessibilitySnapshot(id, viewerId),
                mode: 'leased-structural-preview',
                textPolicy: 'uploaded',
            });
        });
        router.get('/devices/:id/screenshot/:frameId', async (req, res) => {
            const frame = await this.frame(idSchema.parse(req.params.id));
            const image =
                frame?.frameId === req.params.frameId
                    ? frame
                    : (this.recentImages.get(Number(req.params.id)) || []).find(
                          (f) =>
                              f.frameId === req.params.frameId &&
                              f.ownerId === frame?.ownerId &&
                              Date.now() - f.receivedAt <= 3000,
                      );
            if (!image) throw fail(410, '临时截图已过期或被替换');
            res.type('jpeg').send(image.buffer);
        });
        return router;
    }
}
