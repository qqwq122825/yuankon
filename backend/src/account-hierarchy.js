import { fail } from './protocol.js';

export const ACCOUNT_ROLES = ['superadmin', 'studio_admin', 'member'];
export const MEMBER_LIMIT = 5;
export async function accountContext(db, row, { requireActive = true } = {}) {
    if (!row || !ACCOUNT_ROLES.includes(row.role)) throw fail(401, '账号状态已失效');
    let deadline = row.valid_until;
    let parent = null;
    if (row.role !== 'superadmin') {
        if (!Number.isInteger(row.project_id)) throw fail(401, '账号归属无效');
        const studio = await db('studios').where('project_id', row.project_id).first();
        const ownerId = row.role === 'member' ? row.parent_account_id : row.id;
        if (!studio || studio.owner_account_id !== ownerId) throw fail(401, '账号上级无效');
        parent = row.role === 'member' ? await db('accounts').where('id', ownerId).first() : row;
        if (
            parent?.role !== 'studio_admin' ||
            parent.project_id !== row.project_id ||
            !Number.isSafeInteger(parent.valid_until)
        )
            throw fail(401, '总台关系无效');
        deadline = Math.min(parent.valid_until, row.valid_until ?? Infinity);
    }
    if (
        requireActive &&
        (!row.enabled ||
            (parent && !parent.enabled) ||
            (deadline !== null &&
                (!Number.isSafeInteger(deadline) ||
                    deadline <= Date.now() ||
                    deadline > 8640000000000000)))
    )
        throw fail(401, '账号或总台已停用、到期');
    return Object.freeze({
        ...row,
        effective_valid_until: deadline,
        inherits_validity: row.role === 'member' && row.valid_until === null,
    });
}

export async function migrateAccountHierarchy(db) {
    const name = '017_account_hierarchy';
    if (await db('node_migrations').where({ name }).first()) return;
    await db.transaction(async (trx) => {
        await trx.schema.createTable('projects', (t) => {
            t.increments('id');
            t.string('name').notNullable();
            t.string('type').notNullable();
            t.bigInteger('created_at').notNullable();
        });
        const ids = new Set([1]);
        for (const table of [
            'devices',
            'snapshots',
            'lab_events',
            'apk_builds',
            'node_settings',
            'protocol_logs',
            'apk_routes',
            'device_enrollments',
            'server_logs',
        ]) {
            if (
                !(await trx.schema.hasTable(table)) ||
                !(await trx.schema.hasColumn(table, 'project_id'))
            )
                continue;
            for (const id of await trx(table).distinct().pluck('project_id'))
                if (Number.isInteger(id)) ids.add(id);
        }
        for (const id of [...ids].sort((a, b) => a - b))
            await trx('projects').insert({
                id,
                name: id === 1 ? '平台' : `历史项目 ${id}`,
                type: id === 1 ? 'platform' : 'legacy',
                created_at: Date.now(),
            });
        // Knex foreign-key ALTER rebuilds a referenced SQLite table, which fails
        // when existing enrolled devices/routes reference accounts. Native ADD
        // COLUMN with a nullable REFERENCES clause preserves rows and FKs.
        await trx.raw(
            'ALTER TABLE accounts ADD COLUMN project_id INTEGER NULL REFERENCES projects(id)',
        );
        await trx.raw(
            'ALTER TABLE accounts ADD COLUMN parent_account_id INTEGER NULL REFERENCES accounts(id)',
        );
        await trx.schema.alterTable('accounts', (t) => {
            t.index(['project_id']);
            t.index(['parent_account_id']);
            t.string('note').notNullable().defaultTo('');
            t.string('creation_request_id').nullable().unique();
            t.integer('creation_actor_id').nullable();
            t.text('creation_fields').nullable();
        });
        await trx.schema.createTable('studios', (t) => {
            t.integer('project_id').primary().references('projects.id');
            t.integer('owner_account_id').notNullable().unique().references('accounts.id');
            t.bigInteger('created_at').notNullable();
        });
        if (!(await trx.schema.hasTable('account_audit')))
            await trx.schema.createTable('account_audit', (t) => {
                t.increments('id');
                t.bigInteger('ts').notNullable().index();
                t.integer('actor_id').nullable();
                t.string('event').notNullable();
                t.string('ip').nullable();
            });
        await trx.schema.alterTable('account_audit', (t) => {
            t.integer('target_id').nullable();
            t.integer('project_id').nullable().index();
            t.string('result').nullable();
            t.text('changes').nullable();
        });
        await trx('node_migrations').insert({ name, created_at: new Date().toISOString() });
    });
}
