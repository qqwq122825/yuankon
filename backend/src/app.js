import express from 'express';
import { StudioExpiry } from './studio-expiry.js';
import { AccountManagement } from './account-management.js';
import helmet from 'helmet';
import { rateLimit } from 'express-rate-limit';
import { createServer } from 'node:http';
import { access } from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';
import { openDatabase } from './database.js';
import { loadKey } from './config.js';
import { localOnly, tokens } from './security.js';
import { Store } from './store.js';
import { fail, idSchema, labelsFor, wireDevice } from './protocol.js';
import { privateFile, checkPng } from './files.js';
import { Translation } from './translation.js';
import { attachWebSockets } from './websocket.js';
import { Accounts } from './accounts.js';
import { authRoutes } from './auth-routes.js';
import { DeviceIngress } from './device-ingress.js';
import { DeviceManagement } from './device-management.js';
import { DeviceMemos } from './device-memos.js';
import { BuildQueue } from './build-queue.js';
import { Installation } from './installation.js';
import { BuildEnvironment } from './build-environment.js';
import { ServerLogs } from './server-logs.js';

export async function createApplication(
    config,
    {
        dev = false,
        db: providedDb,
        fetcher = fetch,
        serveFrontend = true,
        buildOptions = {},
        environmentOptions = {},
        bootstrapDefault = false,
    } = {},
) {
    const db = providedDb || (await openDatabase(config.database)),
        key = loadKey(config.privateDir);
    const store = new Store(db, null),
        auth = tokens(key, config.projectId),
        translation = new Translation(db, config, key, fetcher);
    const accounts = new Accounts(db, config, key);
    await accounts.initialize({ seedDefault: bootstrapDefault });
    const installation = new Installation(db, config, accounts);
    await installation.initialize();
    const environment = new BuildEnvironment(config, environmentOptions);
    await environment.initialize();
    const ingress = new DeviceIngress(db, auth, store, config);
    const deviceManagement = new DeviceManagement(db, store, ingress);
    const deviceMemos = new DeviceMemos(db, store);
    const studioExpiry = new StudioExpiry(db, accounts, config);
    const accountManagement = new AccountManagement(db, accounts, studioExpiry);
    const translations = new Map([[config.projectId, translation]]);
    const builds = new BuildQueue(db, config, buildOptions);
    await builds.initialize();
    const app = express(),
        server = createServer(app);
    const serverLogs = new ServerLogs(db, config);
    await serverLogs.prune();
    app.use(serverLogs.middleware());
    server.on('listening', () => serverLogs.record('server_listening'));
    server.on('error', (error) => serverLogs.record('server_start_failed', { error }));
    app.disable('x-powered-by');
    app.set('trust proxy', config.trustProxy ? 'loopback' : false);
    const workspaceOnly = localOnly(config);
    app.use((req, res, next) => {
        const sharedArtifact =
            ['GET', 'HEAD'].includes(req.method) &&
            /^\/api\/builds\/[^/]+\/artifact\/?$/.test(req.path);
        return sharedArtifact ? next() : workspaceOnly(req, res, next);
    });
    app.use(
        helmet({
            contentSecurityPolicy: dev
                ? false
                : {
                      directives: {
                          'script-src': ["'self'"],
                          'connect-src': ["'self'", config.origin.replace('http', 'ws')],
                          'img-src': ["'self'", 'data:', 'blob:'],
                          'upgrade-insecure-requests': null,
                      },
                  },
            crossOriginEmbedderPolicy: false,
            strictTransportSecurity: false,
        }),
    );
    const realtimeFrameRequest = (req) =>
        (req.method === 'POST' &&
            req.path === '/device/screenshot' &&
            req.headers['x-capture-mode'] === 'viewer-stream') ||
        (req.method === 'GET' && /^\/devices\/\d+\/screenshot\/[0-9a-f-]{36}$/i.test(req.path));
    app.use(
        '/api',
        rateLimit({
            windowMs: 60000,
            limit: 6000,
            skip: (req) => !realtimeFrameRequest(req),
            standardHeaders: 'draft-8',
            legacyHeaders: false,
            message: { error: '截图请求频率超限' },
        }),
    );
    app.use(
        '/api',
        rateLimit({
            windowMs: 60000,
            limit: config.apiLimit || 300,
            skip: realtimeFrameRequest,
            standardHeaders: 'draft-8',
            legacyHeaders: false,
            message: { error: '请求频率超限' },
        }),
    );
    app.use('/api', (_req, res, next) => {
        res.set('Cache-Control', 'no-store');
        next();
    });
    app.use(express.json({ limit: '32kb' }));
    app.use(accounts.passport.initialize());
    const installLimit = rateLimit({
        windowMs: 15 * 60000,
        limit: 10,
        standardHeaders: 'draft-8',
        legacyHeaders: false,
        message: { error: '初始化尝试过多，请稍后再试' },
    });
    const requireEnvironmentAccess = accounts.requireLogin();
    const environmentAccess = (req, res, next) =>
        installation.installed
            ? requireEnvironmentAccess(req, res, (error) =>
                  error ? next(error) : accounts.requireSuperadmin()(req, res, next),
              )
            : next();
    app.get('/api/install/status', (_req, res) => res.json(installation.status()));
    app.get('/api/install/environment', environmentAccess, async (_req, res) => {
        res.json(await environment.status());
    });
    app.post('/api/install/environment', environmentAccess, installLimit, async (_req, res) => {
        const status = await environment.install();
        res.status(status.ready ? 200 : 202).json(status);
    });
    app.post('/api/install', installLimit, async (req, res) => {
        if (installation.installed) throw fail(409, '系统已完成初始化安装');
        await environment.requireReady();
        res.status(201).json(await installation.install(req.body, req.socket.remoteAddress));
    });
    app.use('/api', (_req, _res, next) =>
        installation.installed ? next() : next(fail(503, '请先完成初始化安装')),
    );
    app.use('/api', async (_req, _res, next) => {
        await studioExpiry.sweep();
        next();
    });
    app.use('/api', builds.publicRoutes());
    app.use('/api', ingress.deviceRoutes());
    app.use('/api', (req, _res, next) => {
        if (!['GET', 'HEAD'].includes(req.method) && !req.is('application/json'))
            return next(fail(415, '请使用 JSON 请求'));
        next();
    });
    app.get('/api/health', (_req, res) =>
        res.json({
            ok: true,
            runtime: 'node',
            frontend: 'vue',
            protocol: 'boundary-node-v1',
            mode: config.trustProxy ? 'trusted-proxy' : 'local-only',
        }),
    );
    app.use('/api/auth', authRoutes(accounts, config));
    app.use('/api', accounts.requireLogin());
    app.use('/api', async (req, _res, next) => {
        req.store = store.withScope(req.user);
        const projectId = req.user.role === 'superadmin' ? config.projectId : req.user.project_id;
        if (!translations.has(projectId))
            translations.set(
                projectId,
                new Translation(db, { ...config, projectId }, key, fetcher),
            );
        req.translation = translations.get(projectId);
        if (req.path.startsWith('/settings/translation') && req.user.role === 'member')
            throw fail(403, '子账号不管理翻译配置');
        next();
    });
    app.use('/api/devices/:id', async (req, _res, next) => {
        const id = idSchema.parse(req.params.id);
        if (req.method === 'DELETE' && ['/', ''].includes(req.path)) {
            const query = db('devices').where({ id });
            if (req.user.role !== 'superadmin') query.where('project_id', req.user.project_id);
            if (req.user.role === 'member') query.where('owner_account_id', req.user.id);
            if (!(await query.first())) throw fail(404, '设备不存在');
        } else await req.store.device(id);
        next();
    });
    app.use('/api', accountManagement.routes());
    app.use('/api', serverLogs.routes(accounts.requireSuperadmin()));
    app.use('/api/logs/protocol', accounts.requireSuperadmin());
    app.use('/api', ingress.accountRoutes());
    app.use('/api', builds.routes());
    app.get('/api/session', async (req, res) => res.json(await accounts.panelTicket(req.user)));
    app.get('/api/system/info', (_req, res) =>
        res.json({
            runtime: 'Node + Express + ws',
            frontend: 'Vue 3',
            mode: config.trustProxy ? 'trusted-proxy' : 'local-only',
            capabilities: [
                'superadmin-login',
                'studio-accounts',
                'tenant-isolation',
                'single-session',
                'all-devices',
                'device-list',
                'snapshots',
                'status-ws',
                'translation',
                'apk-id-auto-online',
                'device-enrollment',
                'single-screenshot',
                'accessibility-first-thumbnail',
                'viewer-requested-screenshot',
                'leased-accessibility-preview',
                'apk-build-queue',
            ],
            pending: ['telegram-otp', 'telegram-worker', 'continuous-frame-stream'],
        }),
    );
    app.get(['/api/devices', '/api/device/list'], async (req, res) => {
        const result = await req.store.list(req.query);
        result.data = result.data.map((device) => ({
            ...device,
            thumbnail: ingress.thumbnail(device.id),
        }));
        res.json(result);
    });
    app.get('/api/devices/:id', async (req, res) =>
        res.json(
            await req.store.detail(
                idSchema.parse(req.params.id),
                req.query.snapshot ? idSchema.parse(req.query.snapshot) : undefined,
            ),
        ),
    );
    app.patch('/api/devices/:id/note', async (req, res) => {
        const { note } = z
            .object({ note: z.string().max(200) })
            .strict()
            .parse(req.body);
        const device = await req.store.note(idSchema.parse(req.params.id), note);
        await ws.broadcast({
            type: 'device_status_update',
            data: wireDevice(device),
            timestamp: Date.now(),
        });
        await req.store.audit('note_updated', 'http', device.public_id);
        res.json(device);
    });
    const memoInput = z
        .object({
            body: z.string().trim().min(1).max(500),
            label: z.enum(['none', 'important', 'follow_up', 'handled']).default('none'),
        })
        .strict();
    app.get('/api/devices/:id/memos', async (req, res) =>
        res.json(await deviceMemos.list(idSchema.parse(req.params.id))),
    );
    app.post('/api/devices/:id/memos', async (req, res) => {
        const deviceId = idSchema.parse(req.params.id);
        const memo = await deviceMemos.create(deviceId, memoInput.parse(req.body), req.user.id);
        const device = await req.store.device(deviceId);
        await req.store.audit('device_memo_created', 'http', device.public_id);
        res.status(201).json(memo);
    });
    app.patch('/api/devices/:id/memos/:memoId', async (req, res) => {
        const deviceId = idSchema.parse(req.params.id);
        const memo = await deviceMemos.update(
            deviceId,
            idSchema.parse(req.params.memoId),
            memoInput.parse(req.body),
        );
        const device = await req.store.device(deviceId);
        await req.store.audit('device_memo_updated', 'http', device.public_id);
        res.json(memo);
    });
    app.delete('/api/devices/:id/memos/:memoId', async (req, res) => {
        z.object({}).strict().parse(req.body);
        const deviceId = idSchema.parse(req.params.id);
        await deviceMemos.remove(deviceId, idSchema.parse(req.params.memoId));
        const device = await req.store.device(deviceId);
        await req.store.audit('device_memo_deleted', 'http', device.public_id);
        res.json({ ok: true });
    });
    app.patch('/api/devices/:id/blacklist', async (req, res) => {
        const { blacklisted } = z.object({ blacklisted: z.boolean() }).strict().parse(req.body);
        const device = await deviceManagement.change(
            idSchema.parse(req.params.id),
            { blacklisted },
            req.user.id,
        );
        res.json({ device: req.store.dto(device) });
    });
    app.delete('/api/devices/:id', async (req, res) => {
        z.object({}).strict().parse(req.body);
        await deviceManagement.change(idSchema.parse(req.params.id), { remove: true }, req.user.id);
        res.json({ ok: true, mode: 'soft-delete' });
    });
    app.get('/api/snapshots', async (req, res) => {
        const page = z.coerce.number().int().min(1).max(100000).default(1).parse(req.query.page);
        const query = req.store.snapshotQuery();
        const { total } = await query.clone().count('* as total').first();
        res.json({
            data: await query
                .select('id', 'device_id', 'source', 'captured_at', 'node_count', 'window_count')
                .orderBy('id', 'desc')
                .limit(20)
                .offset((page - 1) * 20),
            total,
            page,
        });
    });
    app.get('/api/snapshots/:id/export', async (req, res) => {
        const snapshot = await req.store.snapshot(idSchema.parse(req.params.id));
        await req.store.audit(
            'snapshot_export',
            'http',
            (await req.store.device(snapshot.device_id)).public_id,
        );
        res.attachment(`snapshot-${snapshot.id}.json`)
            .type('json')
            .send(JSON.stringify(snapshot.payload, null, 2));
    });
    app.get('/api/snapshots/:id/image', async (req, res) => {
        const snapshot = await req.store.snapshot(idSchema.parse(req.params.id));
        if (snapshot.source === 'sample' && snapshot.screenshot_path === 'demo:settings')
            return res
                .type('svg')
                .sendFile(path.join(config.root, 'backend/fixtures/settings.svg'));
        const file = await privateFile(
            path.join(config.privateDir, 'files'),
            snapshot.screenshot_path,
            'screenshots/',
        );
        const png = await checkPng(file);
        res.type('png').send(png);
    });
    app.get('/api/events', async (req, res) => {
        const page = z.coerce.number().int().min(1).max(100000).default(1).parse(req.query.page);
        const query = db('lab_events').whereExists(
            req.store
                .devices()
                .select(db.raw('1'))
                .whereColumn('devices.id', 'lab_events.device_id')
                .whereColumn('devices.project_id', 'lab_events.project_id'),
        );
        const { total } = await query.clone().count('* as total').first();
        res.json({
            data: await query
                .orderBy('occurred_at', 'desc')
                .limit(20)
                .offset((page - 1) * 20),
            total,
            page,
        });
    });
    const translationLimit = rateLimit({
        windowMs: 60000,
        limit: 20,
        standardHeaders: 'draft-8',
        legacyHeaders: false,
        message: { error: '翻译调用频率超限' },
    });
    app.get('/api/settings/translation', async (req, res) =>
        res.json(await req.translation.publicState()),
    );
    app.put('/api/settings/translation', translationLimit, async (req, res) =>
        res.json(await req.translation.save(req.body)),
    );
    app.delete('/api/settings/translation', translationLimit, async (req, res) =>
        res.json(await req.translation.clear()),
    );
    app.post('/api/settings/translation/verify', translationLimit, async (req, res) => {
        await req.translation.translate({ test: 'Synthetic fixture' }, true);
        res.json(await req.translation.publicState());
    });

    const translateLabelsSchema = z
        .object({
            labels: z
                .record(z.string().min(1).max(120), z.string().min(1).max(500))
                .refine((value) => Object.keys(value).length <= 200, '最多翻译 200 个标签'),
        })
        .strict();
    app.post('/api/translate', translationLimit, async (req, res) => {
        const body = translateLabelsSchema.parse(req.body);
        res.json({ labels: await req.translation.translate(body.labels, false, null) });
    });
    app.post('/api/snapshots/:id/translate', translationLimit, async (req, res) => {
        z.object({}).strict().parse(req.body);
        res.json({
            labels: await req.translation.translate(
                labelsFor(await req.store.snapshot(idSchema.parse(req.params.id))),
            ),
        });
    });
    const logSchema = z.object({
        afterId: z.coerce.number().int().min(0).default(0),
        limit: z.coerce.number().int().min(1).max(100).default(50),
        channel: z.enum(['panel', 'device', 'http', 'client']).optional(),
        scope: z.enum(['client']).optional(),
    });
    app.get(['/api/logs/protocol', '/api/logs/protocol/tail'], async (req, res) => {
        const filter = logSchema.parse(req.query),
            query = db('protocol_logs').where('id', '>', filter.afterId);
        if (filter.scope === 'client') query.whereIn('channel', ['client', 'device']);
        if (filter.channel) query.where('channel', filter.channel);
        res.json({
            data: await query.orderBy('id', 'asc').limit(filter.limit),
            payloadPolicy: 'metadata-only',
        });
    });
    app.get('/api/logs/protocol/export', async (req, res) => {
        const input = z
            .object({
                date: z
                    .string()
                    .regex(/^\d{4}-\d{2}-\d{2}$/)
                    .refine((s) => Number.isFinite(Date.parse(s))),
                scope: z.enum(['client']).optional(),
            })
            .parse(req.query);
        const date = input.date;
        const from = Date.parse(`${date}T00:00:00Z`);
        const query = db('protocol_logs')
            .where('ts', '>=', from)
            .where('ts', '<', from + 86400000);
        if (input.scope === 'client') query.whereIn('channel', ['client', 'device']);
        const rows = await query.orderBy('id').limit(10000);
        res.attachment(`${input.scope === 'client' ? 'client' : 'protocol'}-${date}.jsonl`)
            .type('application/x-ndjson')
            .send(rows.map((r) => JSON.stringify(r)).join('\n'));
    });
    app.use('/api', (_req, _res, next) => next(fail(404, '接口尚未实现或不存在')));
    app.use(
        '/vendor',
        express.static(path.join(config.root, 'frontend/public/vendor'), {
            dotfiles: 'deny',
            index: false,
        }),
    );
    app.get('/favicon.svg', (_req, res) =>
        res.sendFile(path.join(config.root, 'frontend/public/favicon.svg')),
    );
    let vite;
    if (dev) {
        const { createServer: createVite } = await import('vite');
        vite = await createVite({
            configFile: path.join(config.root, 'frontend/vite.config.js'),
            server: { middlewareMode: true, ws: { server } },
        });
        app.use(vite.middlewares);
    } else if (serveFrontend) {
        const dist = path.join(config.root, 'frontend/dist');
        await access(path.join(dist, 'index.html'));
        app.use(express.static(dist, { index: false }));
        app.get(
            [
                '/',
                '/devices/:id',
                '/builds',
                '/accounts',
                '/accounts/:studioAccountId/members',
                '/ai',
                '/injection',
                '/push',
                '/blacklist',
                '/performance',
                '/settings/translation',
                '/settings/account',
                '/login',
                '/install',
                '/snapshots',
                '/events',
                '/logs',
                '/protocol',
            ],
            (_req, res) => res.sendFile(path.join(dist, 'index.html')),
        );
    }
    app.use((_req, _res, next) => next(fail(404, '页面不存在')));
    app.use((err, _req, res, _next) => {
        res.locals.serverLogError = err;
        const validation = err instanceof z.ZodError,
            parse = err.type === 'entity.parse.failed';
        const status =
            validation || parse ? 422 : err.status >= 400 && err.status <= 599 ? err.status : 500;
        res.status(status).json({
            error: validation
                ? '参数格式不符合要求'
                : parse
                  ? 'JSON 格式无效'
                  : status === 500
                    ? '服务暂时异常'
                    : err.message,
        });
    });
    const ws = attachWebSockets(server, store, auth, config, { dev, accounts, ingress });
    accounts.onAccountsChanged = async ({ ids, devices = [] }) => {
        const rows = [...devices, ...(await db('devices').whereIn('owner_account_id', ids))];
        for (const device of rows) {
            ingress.frames.delete(device.id);
            ingress.recentImages.delete(device.id);
            ingress.nodeFrames.delete(device.id);
            ingress.viewerLeases.delete(device.id);
            ingress.grants.delete(device.id);
            ingress.pendingCaptures.delete(device.id);
            ingress.tapFrames.delete(device.id);
            ingress.autoCaptureAt.delete(device.id);
            ingress.debugSessions.delete(device.id);
            ws.disconnectDevice(device.public_id, devices.length > 0);
        }
    };
    ingress.beforeResolve = () => studioExpiry.sweep();
    studioExpiry.onError = (error) => serverLogs.record('studio_expiry_failed', { error });
    studioExpiry.onTransferred = async ({ devices }) => {
        await serverLogs.record('studio_expiry_takeover');
        for (const device of devices) if (!device.deleted_at) await ws.publish(device.public_id);
    };
    ingress.publish = ws.publish;
    ingress.notifyFrame = ws.frameReady;
    deviceManagement.disconnect = ws.disconnectDevice;
    deviceManagement.notify = (device) =>
        device.deleted_at
            ? ws.broadcast({
                  type: 'device_removed',
                  data: { id: device.public_id, localId: device.id },
                  timestamp: Date.now(),
              })
            : ws.publish(device.public_id);
    await studioExpiry.sweep();
    studioExpiry.start();
    await db('protocol_logs')
        .where('ts', '<', Date.now() - 7 * 86400000)
        .delete();
    const prune = setInterval(
        () =>
            db('protocol_logs')
                .where('ts', '<', Date.now() - 7 * 86400000)
                .delete()
                .then(() => serverLogs.prune())
                .catch(() => {}),
        3600000,
    );
    prune.unref();
    await serverLogs.record('application_ready');
    return {
        app,
        server,
        store,
        auth,
        accounts,
        installation,
        environment,
        translation,
        ingress,
        deviceManagement,
        accountManagement,
        studioExpiry,
        builds,
        serverLogs,
        async close() {
            clearInterval(prune);
            await studioExpiry.close();
            await serverLogs.record('server_stopping');
            ingress.close();
            await environment.close();
            await builds.close();
            await ws.close();
            await vite?.close();
            await new Promise((r) => server.close(r));
            await serverLogs.record('server_stopped');
            await serverLogs.close();
            if (!providedDb) await db.destroy();
        },
    };
}
