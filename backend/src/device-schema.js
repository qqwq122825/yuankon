export async function migrateDevices(db) {
    if (await db('node_migrations').where('name', '004_device_enrollment').first()) return;
    await db.transaction(async (trx) => {
        await trx.schema.createTable('apk_routes', (t) => {
            t.string('apk_id').primary();
            t.integer('project_id').notNullable();
            t.integer('owner_account_id').notNullable().references('accounts.id');
            t.boolean('enabled').notNullable().defaultTo(true);
            t.bigInteger('created_at').notNullable();
        });
        // SQLite can add nullable FK columns in place. Knex's multi-step FK alteration
        // rebuilds the referenced table, which fails when existing snapshots refer to it.
        await trx.raw('ALTER TABLE ?? ADD COLUMN ?? TEXT REFERENCES ?? (??) DEFAULT NULL', [
            'devices',
            'apk_id',
            'apk_routes',
            'apk_id',
        ]);
        await trx.raw('ALTER TABLE ?? ADD COLUMN ?? INTEGER REFERENCES ?? (??) DEFAULT NULL', [
            'devices',
            'owner_account_id',
            'accounts',
            'id',
        ]);
        await trx.schema.createTable('device_credentials', (t) => {
            t.integer('device_id').primary().references('devices.id');
            t.string('credential_id').notNullable().unique();
            t.boolean('revoked').notNullable().defaultTo(false);
            t.bigInteger('registered_at').notNullable();
        });
        await trx.schema.createTable('device_enrollments', (t) => {
            t.string('id').primary();
            t.string('apk_id').notNullable().references('apk_routes.apk_id');
            t.integer('owner_account_id').notNullable().references('accounts.id');
            t.integer('project_id').notNullable();
            t.bigInteger('expires_at').notNullable();
            t.integer('device_id').nullable().references('devices.id');
        });
        await trx('node_migrations').insert({
            name: '004_device_enrollment',
            created_at: new Date().toISOString(),
        });
    });
}

export async function migrateDeviceManagement(db) {
    if (await db('node_migrations').where('name', '005_device_management').first()) return;
    await db.transaction(async (trx) => {
        await trx.schema.alterTable('devices', (t) => {
            t.boolean('is_blacklisted').notNullable().defaultTo(false);
            t.bigInteger('deleted_at').nullable();
        });
        await trx('node_migrations').insert({
            name: '005_device_management',
            created_at: new Date().toISOString(),
        });
    });
}
