import { Router } from 'express';
import { z } from 'zod';
import { fail, idSchema } from './protocol.js';
import { hashPassword } from './accounts.js';
import { createAccountWithApkId } from './account-apk.js';
import { accountContext, MEMBER_LIMIT } from './account-hierarchy.js';

const deadline = z.number().int().positive().max(8640000000000000).nullable();
const password = z.string().min(8).max(128);
const baseCreate = {
    requestId: z.string().uuid(),
    username: z
        .string()
        .regex(/^[a-zA-Z0-9_]{3,32}$/)
        .transform((v) => v.toLowerCase()),
    password,
    confirmPassword: password,
    validUntil: deadline,
    note: z.string().trim().max(200).default(''),
};
const createSchema = (studio) =>
    z
        .object({ ...baseCreate, ...(studio ? { name: z.string().trim().min(1).max(80) } : {}) })
        .strict()
        .refine((v) => v.password === v.confirmPassword, { message: '两次密码不一致' });
export class AccountManagement {
    constructor(db, accounts) {
        Object.assign(this, { db, accounts });
    }
    manager(user) {
        if (!['superadmin', 'studio_admin'].includes(user.role))
            throw fail(403, '子账号没有账号管理权限');
    }
    async actor(user, db) {
        this.manager(user);
        const fresh = await accountContext(db, await db('accounts').where('id', user.id).first());
        if (fresh.session_id !== user.session_id) throw fail(401, '登录状态已变更');
        return fresh;
    }
    async target(actor, id, db = this.db) {
        this.manager(actor);
        const row = await db('accounts').where('id', id).first();
        if (
            !row ||
            !['studio_admin', 'member'].includes(row.role) ||
            (actor.role !== 'superadmin' &&
                (row.role !== 'member' ||
                    row.parent_account_id !== actor.id ||
                    row.project_id !== actor.project_id))
        )
            throw fail(404, '账号不存在');
        return row;
    }
    async quota(db, parentId) {
        const { n } = await db('accounts')
            .where({ parent_account_id: parentId, role: 'member', enabled: true })
            .count('* as n')
            .first();
        if (n >= MEMBER_LIMIT)
            throw fail(409, `最多启用 ${MEMBER_LIMIT} 个子账号，请先停用一个账号`);
    }
    validateDeadline(value, parent = null, required = false) {
        if ((required && value === null) || (value !== null && value <= Date.now()))
            throw fail(422, '请选择未来的到期日');
        if (parent && value !== null && value > parent.valid_until)
            throw fail(422, '子账号有效期不能超过总台');
    }
    async audit(db, actor, target, event, changes) {
        await db('account_audit').insert({
            ts: Date.now(),
            actor_id: actor.id,
            target_id: target.id,
            project_id: target.project_id,
            event,
            result: 'success',
            changes: JSON.stringify(changes),
            ip: null,
        });
    }
    async dto(row) {
        const context = await accountContext(this.db, row, { requireActive: false });
        const project =
            row.role === 'studio_admin'
                ? await this.db('projects').where('id', row.project_id).first()
                : null;
        const { n } = await this.db('accounts')
            .where({ parent_account_id: row.id, role: 'member', enabled: true })
            .count('* as n')
            .first();
        return {
            id: row.id,
            username: row.username,
            role: row.role,
            apkId: row.apk_id,
            projectId: row.project_id,
            parentAccountId: row.parent_account_id,
            enabled: Boolean(row.enabled),
            validUntil: context.effective_valid_until,
            ownValidUntil: row.valid_until,
            inheritsValidity: context.inherits_validity,
            createdAt: row.created_at,
            note: row.note,
            name: project?.name || '',
            enabledMembers: Number(n),
            memberLimit: MEMBER_LIMIT,
        };
    }
    async create(user, input, studio, parentId) {
        this.manager(user);
        if (studio && user.role !== 'superadmin') throw fail(403, '仅超管可创建总台');
        if (!studio && user.role === 'studio_admin') parentId = user.id;
        const data = createSchema(studio).parse(input);
        const fields = JSON.stringify({
            username: data.username,
            validUntil: data.validUntil,
            note: data.note,
            name: data.name ?? null,
            parentId: parentId ?? null,
            studio,
        });
        const password_hash = await hashPassword(data.password);
        const saved = await this.db.transaction(async (trx) => {
            const actor = await this.actor(user, trx);
            const existing = await trx('accounts')
                .where('creation_request_id', data.requestId)
                .first();
            if (existing) {
                if (existing.creation_actor_id !== actor.id || existing.creation_fields !== fields)
                    throw fail(409, '创建编号已用于其他配置');
                await this.target(actor, existing.id, trx);
                return existing;
            }
            if (await trx('accounts').where('username', data.username).first())
                throw fail(409, '账号已存在');
            let parent = null,
                projectId;
            if (!studio) {
                parent = await trx('accounts')
                    .where({ id: parentId, role: 'studio_admin' })
                    .first();
                if (!parent || (actor.role !== 'superadmin' && parent.id !== actor.id))
                    throw fail(404, '总台不存在');
                parent = await accountContext(trx, parent);
                await this.quota(trx, parent.id);
                projectId = parent.project_id;
            }
            this.validateDeadline(data.validUntil, parent, studio);
            if (studio)
                [projectId] = await trx('projects').insert({
                    name: data.name,
                    type: 'studio',
                    created_at: Date.now(),
                });
            const row = await createAccountWithApkId(
                trx,
                {
                    username: data.username,
                    password_hash,
                    role: studio ? 'studio_admin' : 'member',
                    enabled: true,
                    created_at: Date.now(),
                    project_id: projectId,
                    parent_account_id: parent?.id ?? null,
                    valid_until: data.validUntil,
                    note: data.note,
                    creation_request_id: data.requestId,
                    creation_actor_id: actor.id,
                    creation_fields: fields,
                },
                projectId,
            );
            if (studio)
                await trx('studios').insert({
                    project_id: projectId,
                    owner_account_id: row.id,
                    created_at: Date.now(),
                });
            await this.audit(trx, actor, row, 'account_created', {
                role: row.role,
                validUntil: row.valid_until,
            });
            return row;
        });
        return this.dto(saved);
    }
    async change(user, id, action, input) {
        const patch =
            action === 'status'
                ? z.object({ enabled: z.boolean() }).strict().parse(input)
                : action === 'validity'
                  ? z.object({ validUntil: deadline }).strict().parse(input)
                  : z
                        .object({ password, confirmPassword: password })
                        .strict()
                        .refine((v) => v.password === v.confirmPassword)
                        .parse(input);
        const password_hash = action === 'password' ? await hashPassword(patch.password) : null;
        const changed = await this.db.transaction(async (trx) => {
            const actor = await this.actor(user, trx);
            const row = await this.target(actor, id, trx);
            const parent =
                row.role === 'member'
                    ? await trx('accounts').where('id', row.parent_account_id).first()
                    : null;
            if (action === 'validity')
                this.validateDeadline(patch.validUntil, parent, row.role === 'studio_admin');
            if (action === 'status' && patch.enabled) {
                if (parent) await accountContext(trx, parent);
                this.validateDeadline(row.valid_until, null, row.role === 'studio_admin');
                if (parent && !row.enabled) await this.quota(trx, parent.id);
            }
            const values =
                action === 'status'
                    ? { enabled: patch.enabled }
                    : action === 'validity'
                      ? { valid_until: patch.validUntil }
                      : { password_hash };
            await trx('accounts').where('id', row.id).update(values);
            const ids = [
                row.id,
                ...(row.role === 'studio_admin'
                    ? await trx('accounts').where('parent_account_id', row.id).pluck('id')
                    : []),
            ];
            await trx('accounts')
                .whereIn('id', ids)
                .update({ session_id: null, session_expires_at: null });
            await this.audit(
                trx,
                actor,
                row,
                `account_${action}_changed`,
                action === 'password' ? { sessionsRevoked: true } : patch,
            );
            return { row: { ...row, ...values }, ids };
        });
        for (const userId of changed.ids)
            this.accounts.emit('sessionChanged', {
                userId,
                reason: action === 'password' ? 'password_changed' : 'session_expired',
            });
        await this.accounts.onAccountsChanged?.({ ids: changed.ids });
        this.accounts.emit('accountsChanged', { ids: changed.ids });
        return this.dto(changed.row);
    }
    routes() {
        const router = Router();
        router.use('/accounts', (req, _res, next) => {
            try {
                this.manager(req.user);
                next();
            } catch (e) {
                next(e);
            }
        });
        router.get('/accounts', async (req, res) => {
            const f = z
                .object({
                    parentId: z.coerce.number().int().positive().optional(),
                    q: z.string().max(100).default(''),
                    page: z.coerce.number().int().min(1).max(100000).default(1),
                    sort: z
                        .enum(['username', 'apkId', 'createdAt', 'validUntil'])
                        .default('createdAt'),
                    direction: z.enum(['asc', 'desc']).default('desc'),
                })
                .strict()
                .parse(req.query);
            const parentId = req.user.role === 'studio_admin' ? req.user.id : f.parentId;
            const parent = parentId
                ? await this.db('accounts').where({ id: parentId, role: 'studio_admin' }).first()
                : null;
            if (parentId && !parent) throw fail(404, '总台不存在');
            const query = this.db('accounts').where('role', parentId ? 'member' : 'studio_admin');
            if (parentId) query.where('parent_account_id', parentId);
            if (req.user.role !== 'superadmin') query.where('project_id', req.user.project_id);
            if (f.q) query.where('username', 'like', `%${f.q}%`);
            const { total } = await query.clone().count('* as total').first();
            const cols = {
                username: 'username',
                apkId: 'apk_id',
                createdAt: 'created_at',
                validUntil: 'valid_until',
            };
            const rows = await query
                .orderBy(cols[f.sort], f.direction)
                .orderBy('id')
                .limit(20)
                .offset((f.page - 1) * 20);
            const { n } = parentId
                ? await this.db('accounts')
                      .where({ parent_account_id: parentId, role: 'member', enabled: true })
                      .count('* as n')
                      .first()
                : { n: 0 };
            res.json({
                data: await Promise.all(rows.map((r) => this.dto(r))),
                total: Number(total),
                page: f.page,
                parent: parent ? await this.dto(parent) : null,
                enabledMembers: Number(n),
                memberLimit: MEMBER_LIMIT,
            });
        });
        router.post('/accounts/studios', async (req, res) =>
            res.status(201).json({ account: await this.create(req.user, req.body, true) }),
        );
        router.post('/accounts/members', async (req, res) => {
            if (req.user.role !== 'studio_admin') throw fail(403, '请先选择总台');
            res.status(201).json({ account: await this.create(req.user, req.body, false) });
        });
        router.post('/accounts/studios/:id/members', async (req, res) => {
            if (req.user.role !== 'superadmin') throw fail(403, '仅超管可代管创建');
            res.status(201).json({
                account: await this.create(
                    req.user,
                    req.body,
                    false,
                    idSchema.parse(req.params.id),
                ),
            });
        });
        for (const [action, method] of [
            ['status', 'patch'],
            ['password', 'put'],
            ['validity', 'patch'],
        ])
            router[method](`/accounts/:id/${action}`, async (req, res) =>
                res.json({
                    account: await this.change(
                        req.user,
                        idSchema.parse(req.params.id),
                        action,
                        req.body,
                    ),
                }),
            );
        return router;
    }
}
