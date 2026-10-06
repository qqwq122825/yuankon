import { accountContext } from './account-hierarchy.js';
import { fail } from './protocol.js';

export async function migrateStudioExpiry(db) {
    const name = '018_studio_expiry_takeover';
    if (await db('node_migrations').where({ name }).first()) return;
    await db.transaction(async (trx) => {
        await trx.schema.createTable('studio_expiry_takeovers', (t) => {
            t.increments('id');
            t.integer('studio_account_id').notNullable().references('accounts.id');
            t.integer('from_project_id').notNullable().references('projects.id');
            t.integer('to_owner_account_id').notNullable().references('accounts.id');
            t.integer('to_project_id').notNullable().references('projects.id');
            t.bigInteger('expired_at').notNullable();
            t.bigInteger('transferred_at').notNullable();
            t.integer('device_count').notNullable();
            t.unique(['studio_account_id', 'expired_at']);
        });
        await trx.schema.createTable('device_expiry_takeovers', (t) => {
            t.integer('device_id').primary().references('devices.id');
            t.integer('takeover_id').notNullable().references('studio_expiry_takeovers.id');
            t.integer('from_owner_account_id').nullable().references('accounts.id');
        });
        await trx('node_migrations').insert({ name, created_at: new Date().toISOString() });
    });
}

// A durable (studio, deadline) record prevents duplicate transfers, including
// after a restart. Renewal settles the old deadline inside its own transaction.
export class StudioExpiry {
    constructor(db, accounts, config) {
        Object.assign(this, { db, accounts, config });
        this.running = null;
    }
    expired(db, now, studioId) {
        const query = db('accounts as a')
            .join('studios as s', 's.owner_account_id', 'a.id')
            .where('a.role', 'studio_admin')
            .whereColumn('a.project_id', 's.project_id')
            .whereBetween('a.valid_until', [1, now])
            .whereNotExists(
                db('studio_expiry_takeovers as t')
                    .select(db.raw('1'))
                    .whereColumn('t.studio_account_id', 'a.id')
                    .whereColumn('t.expired_at', 'a.valid_until'),
            );
        if (studioId) query.where('a.id', studioId);
        return query.select('a.*').orderBy('a.id');
    }
    async transferExpired(trx, { now = Date.now(), studioId } = {}) {
        const studios = await this.expired(trx, now, studioId);
        if (!studios.length) return [];
        // Canonical platform superadmin; no silent fallback to another tenant.
        const root = await trx('accounts').where({ role: 'superadmin', apk_id: '1' }).first();
        try {
            await accountContext(trx, root);
        } catch {
            throw fail(503, '接管超管账号暂不可用，请检查平台账号状态');
        }
        const changes = [];
        for (const studio of studios) {
            const devices = await trx('devices').where('project_id', studio.project_id);
            const [takeoverId] = await trx('studio_expiry_takeovers').insert({
                studio_account_id: studio.id,
                from_project_id: studio.project_id,
                to_owner_account_id: root.id,
                to_project_id: this.config.projectId,
                expired_at: studio.valid_until,
                transferred_at: now,
                device_count: devices.length,
            });
            // Chunk IN clauses for SQLite limits on a large fleet.
            for (let offset = 0; offset < devices.length; offset += 200) {
                const chunk = devices.slice(offset, offset + 200);
                const ids = chunk.map((d) => d.id);
                await trx('device_expiry_takeovers').insert(
                    chunk.map((d) => ({
                        device_id: d.id,
                        takeover_id: takeoverId,
                        from_owner_account_id: d.owner_account_id,
                    })),
                );
                await trx('devices').whereIn('id', ids).update({
                    project_id: this.config.projectId,
                    owner_account_id: root.id,
                });
                for (const table of [
                    'snapshots',
                    'lab_events',
                    'device_memos',
                    'device_debug_reports',
                ])
                    await trx(table)
                        .whereIn('device_id', ids)
                        .update({ project_id: this.config.projectId });
                await trx('protocol_logs')
                    .where('project_id', studio.project_id)
                    .whereIn(
                        'device_id',
                        chunk.map((d) => d.public_id),
                    )
                    .update({ project_id: this.config.projectId });
            }
            const ids = [
                studio.id,
                ...(await trx('accounts')
                    .where({
                        role: 'member',
                        parent_account_id: studio.id,
                        project_id: studio.project_id,
                    })
                    .pluck('id')),
            ];
            await trx('accounts')
                .whereIn('id', ids)
                .update({ session_id: null, session_expires_at: null });
            await trx('account_audit').insert({
                ts: now,
                actor_id: null,
                target_id: studio.id,
                project_id: studio.project_id,
                event: 'studio_expiry_devices_transferred',
                result: 'success',
                changes: JSON.stringify({
                    takeoverId,
                    expiredAt: studio.valid_until,
                    toOwnerAccountId: root.id,
                    toProjectId: this.config.projectId,
                    deviceCount: devices.length,
                }),
                ip: null,
            });
            changes.push({ ids, devices, takeoverId });
        }
        return changes;
    }
    async notify(changes) {
        for (const change of changes) {
            for (const userId of change.ids)
                this.accounts.emit('sessionChanged', { userId, reason: 'session_expired' });
            await this.accounts.onAccountsChanged?.(change);
            this.accounts.emit('accountsChanged', { ids: change.ids });
            await this.onTransferred?.(change);
        }
    }
    sweep() {
        if (this.running) return this.running;
        this.running = (async () => {
            if (!(await this.expired(this.db, Date.now()).first())) return [];
            const changes = await this.db.transaction((trx) => this.transferExpired(trx));
            await this.notify(changes);
            return changes;
        })().finally(() => {
            this.running = null;
        });
        return this.running;
    }
    start() {
        this.timer = setInterval(() => this.sweep().catch((error) => this.onError?.(error)), 5000);
        this.timer.unref();
    }
    async close() {
        clearInterval(this.timer);
        await this.running?.catch(() => {});
    }
}
