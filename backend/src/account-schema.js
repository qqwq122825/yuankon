// Account authentication migration; device-schema.js separately adds APK routing.
export async function migrateAccounts(db) {
    if (await db('node_migrations').where('name', '002_superadmin_auth').first()) return;
    await db.transaction(async (trx) => {
        await trx.schema.createTable('accounts', (t) => {
            t.increments('id');
            t.string('username').notNullable().unique();
            t.string('password_hash').notNullable();
            t.string('role').notNullable().defaultTo('superadmin');
            t.boolean('enabled').notNullable().defaultTo(true);
            t.string('session_id').nullable();
            t.bigInteger('session_expires_at').nullable();
            t.bigInteger('created_at').notNullable();
        });
        await trx.schema.createTable('account_audit', (t) => {
            t.increments('id');
            t.bigInteger('ts').notNullable().index();
            t.integer('actor_id').nullable();
            t.string('event').notNullable();
            t.string('ip').nullable();
        });
        await trx('node_migrations').insert({
            name: '002_superadmin_auth',
            created_at: new Date().toISOString(),
        });
    });
}

export async function migrateAccountValidity(db) {
    if (await db('node_migrations').where('name', '007_account_validity').first()) return;
    await db.transaction(async (trx) => {
        await trx.schema.alterTable('accounts', (t) => {
            // Exclusive UTC millisecond deadline; null preserves the existing superadmin.
            t.bigInteger('valid_until').nullable();
        });
        await trx('node_migrations').insert({
            name: '007_account_validity',
            created_at: new Date().toISOString(),
        });
    });
}

export async function migrateAccountApkId(db) {
    if (await db('node_migrations').where('name', '008_account_apk_id').first()) return;
    await db.transaction(async (trx) => {
        await trx.schema.alterTable('accounts', (t) => {
            t.string('apk_id').nullable().unique();
        });
        await trx.schema.alterTable('apk_builds', (t) => {
            t.string('requested_apk_id').nullable();
            t.integer('owner_account_id').nullable();
            t.string('owner_username').nullable();
            t.string('routing_reason').nullable();
        });
        await trx('node_migrations').insert({
            name: '008_account_apk_id',
            created_at: new Date().toISOString(),
        });
    });
}

export async function migrateSuperadminApkId(db) {
    if (await db('node_migrations').where('name', '009_superadmin_apk_id_1').first()) return;
    await db.transaction(async (trx) => {
        const rootQuery = trx('accounts').orderBy('id');
        if (await trx.schema.hasColumn('accounts', 'role')) rootQuery.where('role', 'superadmin');
        const root = await rootQuery.first();
        if (root && root.apk_id !== '1') {
            const conflictingAccount = await trx('accounts')
                .where('apk_id', '1')
                .whereNot('id', root.id)
                .first();
            const desiredRoute = await trx('apk_routes').where('apk_id', '1').first();
            if (conflictingAccount || (desiredRoute && desiredRoute.owner_account_id !== root.id))
                throw new Error('APK ID 1 已被其他账号占用');
            const currentRoute = root.apk_id
                ? await trx('apk_routes')
                      .where({ apk_id: root.apk_id, owner_account_id: root.id })
                      .first()
                : null;
            if (!desiredRoute)
                await trx('apk_routes').insert({
                    apk_id: '1',
                    owner_account_id: root.id,
                    project_id: currentRoute?.project_id ?? 1,
                    enabled: currentRoute?.enabled ?? true,
                    created_at: currentRoute?.created_at ?? Date.now(),
                });
            await trx('accounts').where('id', root.id).update({ apk_id: '1' });
        }
        await trx('node_migrations').insert({
            name: '009_superadmin_apk_id_1',
            created_at: new Date().toISOString(),
        });
    });
}

export async function migrateAccountApkSequence(db) {
    if (await db('node_migrations').where('name', '011_unique_account_apk_sequence').first())
        return;
    await db.transaction(async (trx) => {
        await trx.schema.createTable('account_apk_sequence', (t) => {
            t.integer('id').primary();
            t.integer('next_value').notNullable();
            t.bigInteger('updated_at').notNullable();
        });
        const values = [
            ...(await trx('accounts').whereNotNull('apk_id').pluck('apk_id')),
            ...(await trx('apk_routes').pluck('apk_id')),
        ];
        const highest = values.reduce((max, value) => {
            if (!/^\d+$/.test(String(value))) return max;
            const parsed = Number(value);
            return Number.isSafeInteger(parsed) ? Math.max(max, parsed) : max;
        }, 99);
        await trx('account_apk_sequence').insert({
            id: 1,
            next_value: Math.max(100, highest + 1),
            updated_at: Date.now(),
        });
        await trx('node_migrations').insert({
            name: '011_unique_account_apk_sequence',
            created_at: new Date().toISOString(),
        });
    });
}
