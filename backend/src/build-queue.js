import { Router } from 'express';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
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
        const backend = await backendOrigin(this.config, parsed.domain);
        const pkg = packageName(parsed.packageName);
        if (!(await this.readiness(this.config)).ready)
            throw fail(503, '本地 Android 构建工具未就绪');
        const now = new Date().toISOString();
        const job = {
            id: randomUUID(),
            project_id: this.config.projectId,
            actor_id: actor.id,
            request_id: parsed.requestId,
            request_body: requestBody,
            app_name: parsed.appName,
            home_url: parsed.homeUrl,
            template_id: template.id,
            template_name: template.name,
            template_version: template.versionName,
            template_snapshot: JSON.stringify(template),
            domain: parsed.domain,
            backend_url: backend,
            apk_id: parsed.apkId,
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
            const owner = await trx('accounts')
                .where({ id: actor.id, enabled: true, role: 'superadmin' })
                .first();
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
            const route = await trx('apk_routes').where('apk_id', parsed.apkId).first();
            if (
                route &&
                (!route.enabled ||
                    route.owner_account_id !== actor.id ||
                    route.project_id !== this.config.projectId)
            )
                throw fail(409, 'APK ID 已有其他归属或已停用，请选择另一个 ID');
            if (!route)
                await trx('apk_routes').insert({
                    apk_id: parsed.apkId,
                    owner_account_id: actor.id,
                    project_id: this.config.projectId,
                    enabled: true,
                    created_at: Date.now(),
                });
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
                const template = templateSchema.parse(JSON.parse(job.template_snapshot));
                const result = await this.runner(this.config, job, template, { signal, stage });
                if (signal.aborted) throw new Error('Interrupted');
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
        const { artifact_path, template_snapshot, request_body, request_id, ...data } = row;
        return {
            ...data,
            artifactAvailable,
            downloadUrl: artifactAvailable ? `/api/builds/${row.id}/artifact` : null,
        };
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
            const { total } = await this.db('apk_builds').count('* as total').first();
            const rows = await this.db('apk_builds')
                .orderBy('created_at', 'desc')
                .orderBy('id', 'desc')
                .limit(20)
                .offset((page - 1) * 20);
            const { n } = await this.db('apk_builds')
                .whereIn('status', activeStates)
                .count('* as n')
                .first();
            res.json({
                data: await Promise.all(rows.map((r) => this.dto(r))),
                total,
                page,
                worker: {
                    status: this.queueError ? 'error' : n ? 'busy' : 'idle',
                    active: n,
                    ...(await this.readiness(this.config)),
                },
            });
        });
        router.get('/builds/:id/artifact', async (req, res) => {
            const id = uuid.parse(req.params.id);
            const row = await this.db('apk_builds').where({ id, status: 'succeeded' }).first();
            if (!row) throw fail(404, '构建产物不存在');
            const file = await privateFile(
                path.join(this.config.privateDir, 'files'),
                row.artifact_path,
                `apk-builds/${id}/`,
            );
            res.download(file, `application-${id.slice(0, 8)}.apk`, { dotfiles: 'allow' });
        });
        router.get('/builds/:id', async (req, res) => {
            const row = await this.db('apk_builds').where('id', uuid.parse(req.params.id)).first();
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
