import { accountContext } from './account-hierarchy.js';
import { Router } from 'express';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { rm } from 'node:fs/promises';
import { z } from 'zod';
import { fail } from './protocol.js';
import { privateFile } from './files.js';
import {
    buildInput,
    packageName,
    loadTemplates,
    templateSchema,
    templateSource,
    backendOrigin,
} from './build-templates.js';
import { buildApk, checkTools } from './apk-builder.js';
import { resolveBuildRecipient } from './account-apk.js';

const uuid = z.string().uuid();
const activeStates = ['queued', 'building'];
export class BuildQueue {
    constructor(db, config, { runner = buildApk, readiness = checkTools } = {}) {
        Object.assign(this, { db, config, runner, readiness });
        this.stopping = false;
        this.task = null;
        this.controller = null;
    }
    async initialize() {
        await this.db('apk_builds').where('status', 'building').whereNotNull('template_id').update({
            status: 'failed',
            stage: 'failed',
            error_message: '服务重启中断构建，请重新提交',
            finished_at: new Date().toISOString(),
        });
        this.kick();
    }
    async catalog() {
        const templates = await loadTemplates(this.config.root);
        return {
            templates,
            worker: await this.readiness(this.config),
            defaultDomain: 'local',
            localOrigin: this.config.origin,
        };
    }
    scope(actor, db = this.db) {
        const query = db('apk_builds');
        if (actor.role !== 'superadmin') query.where('project_id', actor.project_id);
        if (actor.role === 'member') query.where('actor_id', actor.id);
        return query;
    }
    async enqueue(input, actor) {
        if (this.stopping) throw fail(503, '构建队列正在关闭');
        const parsed = buildInput.parse(input);
        const existing = await this.db('apk_builds').where('request_id', parsed.requestId).first();
        const requestBody = JSON.stringify(parsed);
        if (existing) {
            if (existing.actor_id !== actor.id || existing.request_body !== requestBody)
                throw fail(409, '提交标识已用于其他配置');
            return this.dto(existing);
        }
        const template = (await loadTemplates(this.config.root)).find(
            (t) => t.id === parsed.templateId,
        );
        if (!template) throw fail(422, '请选择已登记的模板版本');
        await templateSource(this.config.root, template);
        const role =
            template.kind === 'screenagent'
                ? 'b'
                : template.kind === 'installer'
                  ? 'a'
                  : 'standalone';
        if (role === 'b' && !parsed.domain) throw fail(422, 'B 包必须填写后台域名');
        if (role === 'b' && parsed.homeUrl) throw fail(422, 'B 包不接收首页地址');
        if (role === 'a' && parsed.domain) throw fail(422, 'A 包不接收后台域名');
        if (role === 'a' && !parsed.homeUrl) throw fail(422, 'A 包必须填写 HTTPS 首页地址');
        if (role === 'standalone' && (!parsed.domain || !parsed.homeUrl))
            throw fail(422, '浏览器模板必须填写后台域名与 HTTPS 首页地址');
        const backend = role === 'a' ? '' : await backendOrigin(this.config, parsed.domain);
        const pkg = packageName(parsed.packageName);
        if (!(await this.readiness(this.config)).ready)
            throw fail(503, '本地 Android 构建工具未就绪');
        const now = new Date().toISOString();
        const job = {
            id: randomUUID(),
            project_id: actor.role === 'superadmin' ? this.config.projectId : actor.project_id,
            actor_id: actor.id,
            request_id: parsed.requestId,
            request_body: requestBody,
            app_name: parsed.appName,
            home_url: parsed.homeUrl,
            template_id: template.id,
            template_name: template.name,
            template_version: template.versionName,
            template_snapshot: JSON.stringify(template),
            artifact_role: role,
            domain: parsed.domain,
            backend_url: backend,
            batch: parsed.batch,
            package_name: pkg,
            status: 'queued',
            stage: 'queued',
            delivery_status: 'not-requested',
            created_at: now,
        };
        const saved = await this.db.transaction(async (trx) => {
            const duplicate = await trx('apk_builds').where('request_id', parsed.requestId).first();
            if (duplicate) {
                if (duplicate.actor_id !== actor.id || duplicate.request_body !== requestBody)
                    throw fail(409, '提交标识已用于其他配置');
                return duplicate;
            }
            const owner = await accountContext(
                trx,
                await trx('accounts').where({ id: actor.id }).first(),
            );
            if (!owner) throw fail(403, '当前账号没有构建权限');
            const { n } = await trx('apk_builds')
                .whereIn('status', activeStates)
                .count('* as n')
                .first();
            if (n >= 10) throw fail(429, '队列最多 10 个任务，请等待后再提交');
            const { size } = await trx('apk_builds')
                .where('status', 'succeeded')
                .sum('size as size')
                .first();
            if (Number(size) + (Number(n) + 1) * 150 * 1024 ** 2 > 2 * 1024 ** 3)
                throw fail(409, '构建产物配额不足（含排队预留），请管理员归档清理后重试');
            Object.assign(
                job,
                await resolveBuildRecipient(trx, parsed.apkId, owner, job.project_id),
            );
            if (role === 'a' && (template.payloadFormat ?? 'plain') !== 'none') {
                const payload = await this.latestB(
                    job.owner_account_id,
                    trx,
                    owner,
                    job.project_id,
                );
                if (!payload) throw fail(409, '请先完成同一归属账号的 B 包构建，再构建 A 包');
                if (payload.package_name === pkg) throw fail(422, 'A 包与 B 包必须使用不同包名');
                Object.assign(job, {
                    payload_build_id: payload.id,
                    payload_sha256: payload.sha256,
                    payload_package_name: payload.package_name,
                });
            }
            await trx('apk_builds').insert(job);
            await trx('account_audit').insert({
                ts: Date.now(),
                actor_id: actor.id,
                event: `build_queued:${job.id}`,
                ip: null,
            });
            return job;
        });
        this.kick();
        return this.dto(saved);
    }
    async latestB(ownerId, connection = this.db, actor = null, projectId = null) {
        const rows = await connection('apk_builds')
            .where({
                project_id:
                    projectId ??
                    (actor && actor.role !== 'superadmin'
                        ? actor.project_id
                        : this.config.projectId),
                owner_account_id: ownerId,
                artifact_role: 'b',
                status: 'succeeded',
            })
            .modify((query) => {
                if (actor?.role === 'member') query.where('actor_id', actor.id);
            })
            .orderBy('finished_at', 'desc')
            .orderBy('created_at', 'desc')
            .orderBy('id', 'desc')
            .limit(20);
        for (const row of rows) {
            try {
                if (!/^[a-f0-9]{64}$/.test(row.sha256 || '') || !row.package_name) continue;
                await privateFile(
                    path.join(this.config.privateDir, 'files'),
                    row.artifact_path,
                    `apk-builds/${row.id}/`,
                );
                return row;
            } catch {}
        }
        return null;
    }
    kick() {
        if (this.stopping) return;
        if (this.task) {
            this.again = true;
            return;
        }
        this.again = false;
        this.task = this.drain()
            .catch(() => {
                this.queueError = true;
            })
            .finally(() => {
                this.task = null;
                if (this.again) this.kick();
            });
    }
    async drain() {
        while (!this.stopping) {
            const job = await this.db('apk_builds')
                .where('status', 'queued')
                .whereNotNull('template_id')
                .orderBy('created_at')
                .orderBy('id')
                .first();
            if (!job) return;
            this.controller = new AbortController();
            const signal = AbortSignal.any([
                this.controller.signal,
                AbortSignal.timeout(20 * 60000),
            ]);
            const stage = async (value) => {
                await this.db('apk_builds').where('id', job.id).update({ stage: value });
            };
            await this.db('apk_builds').where('id', job.id).update({
                status: 'building',
                stage: 'preparing',
                started_at: new Date().toISOString(),
            });
            try {
                const actor = await accountContext(
                    this.db,
                    await this.db('accounts').where('id', job.actor_id).first(),
                );
                await accountContext(
                    this.db,
                    await this.db('accounts').where('id', job.owner_account_id).first(),
                );
                const template = templateSchema.parse(JSON.parse(job.template_snapshot));
                let payloadFile;
                if (job.artifact_role === 'a' && (template.payloadFormat ?? 'plain') !== 'none') {
                    const payload = await this.db('apk_builds')
                        .where({
                            id: job.payload_build_id,
                            project_id: job.project_id,
                            owner_account_id: job.owner_account_id,
                            artifact_role: 'b',
                            status: 'succeeded',
                        })
                        .first();
                    if (
                        (actor.role === 'member' && payload?.actor_id !== actor.id) ||
                        !payload ||
                        payload.sha256 !== job.payload_sha256 ||
                        payload.package_name !== job.payload_package_name
                    )
                        throw new Error('B package reference changed');
                    payloadFile = await privateFile(
                        path.join(this.config.privateDir, 'files'),
                        payload.artifact_path,
                        `apk-builds/${payload.id}/`,
                    );
                }
                const result = await this.runner(this.config, job, template, {
                    signal,
                    stage,
                    payloadFile,
                });
                if (signal.aborted) throw new Error('Interrupted');
                await accountContext(
                    this.db,
                    await this.db('accounts').where('id', job.actor_id).first(),
                );
                await accountContext(
                    this.db,
                    await this.db('accounts').where('id', job.owner_account_id).first(),
                );
                await privateFile(
                    path.join(this.config.privateDir, 'files'),
                    result.artifact_path,
                    `apk-builds/${job.id}/`,
                );
                if (
                    !/^[a-f0-9]{64}$/.test(result.sha256) ||
                    !Number.isSafeInteger(result.size) ||
                    result.size <= 0
                )
                    throw new Error('Invalid result');
                await this.db('apk_builds').where('id', job.id).update({
                    artifact_path: result.artifact_path,
                    sha256: result.sha256,
                    size: result.size,
                    status: 'succeeded',
                    stage: 'succeeded',
                    finished_at: new Date().toISOString(),
                });
            } catch {
                await this.db('apk_builds')
                    .where('id', job.id)
                    .update({
                        status: 'failed',
                        stage: 'failed',
                        error_message: signal.aborted
                            ? '构建被中断或超过 20 分钟，请重新提交'
                            : '构建或产物校验失败；管理员可检查私有 build-work 目录日志',
                        finished_at: new Date().toISOString(),
                    });
            } finally {
                this.controller = null;
            }
        }
    }
    async dto(row) {
        let artifactAvailable = false;
        let logAvailable = false;
        if (row.status === 'succeeded' && uuid.safeParse(row.id).success) {
            try {
                await privateFile(
                    path.join(this.config.privateDir, 'files'),
                    row.artifact_path,
                    `apk-builds/${row.id}/`,
                );
                artifactAvailable = true;
            } catch {}
        }
        if (uuid.safeParse(row.id).success) {
            try {
                await privateFile(
                    path.join(this.config.privateDir, 'build-work'),
                    `${row.id}/build.log`,
                    `${row.id}/`,
                );
                logAvailable = true;
            } catch {}
        }
        const { artifact_path, template_snapshot, request_body, request_id, ...data } = row;
        return {
            ...data,
            artifactAvailable,
            downloadUrl: artifactAvailable ? `/api/builds/${row.id}/artifact` : null,
            logAvailable,
            logUrl: logAvailable ? `/api/builds/${row.id}/log` : null,
        };
    }
    async remove(id, actor) {
        const buildId = uuid.parse(id);
        return this.db.transaction(async (trx) => {
            const row = await this.scope(actor, trx).where('id', buildId).first();
            if (!row) throw fail(404, '构建任务不存在');
            if (activeStates.includes(row.status)) throw fail(409, '构建进行中，完成后再删除');
            if (
                row.artifact_role === 'b' &&
                (await trx('apk_builds')
                    .where('payload_build_id', buildId)
                    .whereIn('status', activeStates)
                    .first())
            )
                throw fail(409, '该 B 包正被 A 包构建使用，完成后再删除');
            await rm(path.join(this.config.privateDir, 'files', 'apk-builds', buildId), {
                recursive: true,
                force: true,
                maxRetries: 2,
            });
            await rm(path.join(this.config.privateDir, 'build-work', buildId), {
                recursive: true,
                force: true,
                maxRetries: 2,
            });
            await trx('apk_builds').where('id', buildId).delete();
            await trx('account_audit').insert({
                ts: Date.now(),
                actor_id: actor.id,
                event: `build_deleted:${buildId}`,
                ip: null,
            });
            return { ok: true, recordDeleted: true, filesDeleted: true };
        });
    }
    async sendArtifact(req, res) {
        const id = uuid.parse(req.params.id);
        const row = await this.db('apk_builds').where({ id, status: 'succeeded' }).first();
        if (!row) throw fail(404, '构建产物不存在');
        const file = await privateFile(
            path.join(this.config.privateDir, 'files'),
            row.artifact_path,
            `apk-builds/${id}/`,
        );
        const prefix =
            row.artifact_role === 'a'
                ? 'installer-a'
                : row.artifact_role === 'b'
                  ? 'worker-b'
                  : 'application';
        res.download(file, `${prefix}-${id.slice(0, 8)}.apk`, { dotfiles: 'allow' });
    }
    publicRoutes() {
        const router = Router();
        router.get('/builds/:id/artifact', (req, res) => this.sendArtifact(req, res));
        return router;
    }
    routes() {
        const router = Router();
        router.get('/build-templates', async (_req, res) => res.json(await this.catalog()));
        router.post('/builds', async (req, res) =>
            res.status(202).json({ build: await this.enqueue(req.body, req.user) }),
        );
        router.get('/builds', async (req, res) => {
            const page = z.coerce
                .number()
                .int()
                .min(1)
                .max(100000)
                .default(1)
                .parse(req.query.page);
            const { total } = await this.scope(req.user).count('* as total').first();
            const rows = await this.scope(req.user)
                .orderBy('created_at', 'desc')
                .orderBy('id', 'desc')
                .limit(20)
                .offset((page - 1) * 20);
            const { n } = await this.scope(req.user)
                .whereIn('status', activeStates)
                .count('* as n')
                .first();
            res.json({
                data: await Promise.all(rows.map((r) => this.dto(r))),
                latestB: await (async () => {
                    const row = await this.latestB(
                        req.user.role === 'member' ? req.user.parent_account_id : req.user.id,
                        this.db,
                        req.user,
                    );
                    return row ? this.dto(row) : null;
                })(),
                total,
                page,
                worker: {
                    status: this.queueError ? 'error' : n ? 'busy' : 'idle',
                    active: n,
                    ...(await this.readiness(this.config)),
                },
            });
        });
        router.get('/builds/:id/log', async (req, res) => {
            const id = uuid.parse(req.params.id);
            const row = await this.scope(req.user).where('id', id).first();
            if (!row) throw fail(404, '构建日志不存在');
            const file = await privateFile(
                path.join(this.config.privateDir, 'build-work'),
                `${id}/build.log`,
                `${id}/`,
            );
            const prefix =
                row.artifact_role === 'a'
                    ? 'installer-a'
                    : row.artifact_role === 'b'
                      ? 'worker-b'
                      : 'application';
            res.download(file, `${prefix}-${id.slice(0, 8)}.log`, { dotfiles: 'allow' });
        });
        router.delete('/builds/:id', async (req, res) => {
            z.object({}).strict().parse(req.body);
            res.json(await this.remove(req.params.id, req.user));
        });
        router.get('/builds/:id', async (req, res) => {
            const row = await this.scope(req.user).where('id', uuid.parse(req.params.id)).first();
            if (!row) throw fail(404, '构建任务不存在');
            res.json({ build: await this.dto(row) });
        });
        return router;
    }
    async close() {
        this.stopping = true;
        this.controller?.abort();
        await this.task;
    }
}
