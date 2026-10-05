import { Router } from 'express';
import { performance } from 'node:perf_hooks';
import { z } from 'zod';

const events = {
    application_ready: ['info', 'runtime', '服务器应用初始化完成'],
    server_listening: ['info', 'runtime', '服务器开始监听'],
    server_stopping: ['info', 'runtime', '服务器正在停止'],
    server_stopped: ['info', 'runtime', '服务器已停止'],
    server_start_failed: ['error', 'runtime', '服务器启动失败'],
    http_request: ['info', 'http', 'HTTP 请求完成'],
    http_rejected: ['warn', 'http', 'HTTP 请求被拒绝'],
    http_error: ['error', 'http', 'HTTP 请求处理异常'],
};
const errorKinds = [
    'Error',
    'TypeError',
    'RangeError',
    'ReferenceError',
    'SyntaxError',
    'ZodError',
];
const errorCodes = [
    'SQLITE_BUSY',
    'SQLITE_FULL',
    'SQLITE_READONLY',
    'SQLITE_CORRUPT',
    'ENOENT',
    'EACCES',
    'ECONNREFUSED',
    'ECONNRESET',
    'ETIMEDOUT',
    'EADDRINUSE',
    'EADDRNOTAVAIL',
    'SQLITE_CANTOPEN',
];
const dateSchema = z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .refine((date) => {
        const ts = Date.parse(`${date}T00:00:00Z`);
        return Number.isFinite(ts) && new Date(ts).toISOString().slice(0, 10) === date;
    });
const filterSchema = z.object({
    level: z.enum(['info', 'warn', 'error']).optional(),
    category: z.enum(['runtime', 'http']).optional(),
    date: dateSchema.optional(),
});
const tailSchema = filterSchema
    .extend({
        afterId: z.coerce.number().int().min(0).max(Number.MAX_SAFE_INTEGER).optional(),
        limit: z.coerce.number().int().min(1).max(100).default(100),
    })
    .strict();
const exportSchema = filterSchema.extend({ date: dateSchema }).strict();

export class ServerLogs {
    constructor(db, config, { maxRows = 50000, retentionMs = 7 * 86400000 } = {}) {
        Object.assign(this, { db, config, maxRows, retentionMs });
        this.pending = Promise.resolve();
        this.pendingCount = 0;
        this.writes = 0;
    }
    record(event, metadata = {}) {
        if (!Object.hasOwn(events, event)) throw new Error('Unknown server log event');
        if (this.pendingCount >= 1000) return this.pending;
        const [level, category, message] = events[event];
        const row = {
            project_id: this.config.projectId,
            ts: Date.now(),
            level,
            category,
            event,
            message,
        };
        if (metadata.error) {
            row.error_kind = errorKinds.includes(metadata.error.name)
                ? metadata.error.name
                : 'Error';
            row.error_code = errorCodes.includes(metadata.error.code) ? metadata.error.code : null;
        }
        if (category === 'http') {
            row.request_method = [
                'GET',
                'HEAD',
                'POST',
                'PUT',
                'PATCH',
                'DELETE',
                'OPTIONS',
            ].includes(metadata.method)
                ? metadata.method
                : 'OTHER';
            // Only router templates enter storage, never user URLs, queries, bodies or headers.
            row.request_path = metadata.route || '/unmatched';
            row.response_status = metadata.status;
            row.duration_ms = Math.max(0, Math.round(metadata.duration));
        }
        this.pendingCount++;
        this.pending = this.pending
            .then(async () => {
                await this.db('server_logs').insert(row);
                if (++this.writes % 100 === 0) await this.prune();
            })
            .catch(() => {
                console.error('服务器日志写入失败');
            })
            .finally(() => {
                this.pendingCount--;
            });
        return this.pending;
    }
    middleware() {
        return (req, res, next) => {
            const started = performance.now();
            const apiRequest = req.path.startsWith('/api/');
            const logRequest = req.path.startsWith('/api/logs/');
            res.once('finish', () => {
                // Successful static requests and log polling do not fill their own log stream.
                if (res.statusCode < 400 && (!apiRequest || logRequest)) return;
                const template = req.route?.path;
                const routeTemplate = Array.isArray(template) ? template[0] : template;
                const route =
                    typeof routeTemplate === 'string'
                        ? `${req.baseUrl || ''}${routeTemplate}`
                        : '/unmatched';
                this.record(
                    res.statusCode >= 500
                        ? 'http_error'
                        : res.statusCode >= 400
                          ? 'http_rejected'
                          : 'http_request',
                    {
                        method: req.method,
                        route,
                        status: res.statusCode,
                        duration: performance.now() - started,
                        error: res.locals.serverLogError,
                    },
                );
            });
            next();
        };
    }
    query(filter) {
        const query = this.db('server_logs');
        if (filter.level) query.where('level', filter.level);
        if (filter.category) query.where('category', filter.category);
        if (filter.date) {
            const from = Date.parse(`${filter.date}T00:00:00Z`);
            query.where('ts', '>=', from).where('ts', '<', from + 86400000);
        }
        return query;
    }
    async list(input) {
        const filter = tailSchema.parse(input);
        await this.pending;
        const query = this.query(filter);
        if (filter.afterId !== undefined) query.where('id', '>', filter.afterId);
        const rows = await query
            .orderBy('id', filter.afterId === undefined ? 'desc' : 'asc')
            .limit(filter.limit);
        if (filter.afterId === undefined) rows.reverse();
        return {
            data: rows,
            payloadPolicy: 'metadata-only',
            retentionDays: 7,
            source: 'node-server',
        };
    }
    routes(requireSuperadmin) {
        const router = Router();
        router.use('/logs/server', requireSuperadmin);
        router.get(['/logs/server', '/logs/server/tail'], async (req, res) =>
            res.json(await this.list(req.query)),
        );
        router.get('/logs/server/export', async (req, res) => {
            const filter = exportSchema.parse(req.query);
            await this.pending;
            const rows = await this.query(filter).orderBy('id').limit(10000);
            res.attachment(`server-${filter.date}.jsonl`)
                .type('application/x-ndjson')
                .send(rows.map((row) => JSON.stringify(row)).join('\n'));
        });
        return router;
    }
    async prune() {
        await this.db('server_logs')
            .where('ts', '<', Date.now() - this.retentionMs)
            .delete();
        const oldest = await this.db('server_logs')
            .select('id')
            .orderBy('id', 'desc')
            .offset(this.maxRows)
            .first();
        if (oldest) await this.db('server_logs').where('id', '<=', oldest.id).delete();
    }
    async close() {
        await this.pending;
    }
}
