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

export async function repairDeviceRegistrationTimes(db) {
    // Older automatic-online builds renewed registered_at on every reconnect. Restore the
    // immutable first registration timestamp from the existing audit trail when available.
    await db.raw(`
            UPDATE device_credentials
               SET registered_at = (
                   SELECT MIN(protocol_logs.ts)
                     FROM protocol_logs
                     JOIN devices ON devices.public_id = protocol_logs.device_id
                    WHERE devices.id = device_credentials.device_id
                      AND protocol_logs.type IN ('device_auto_registered', 'device_registered')
               )
             WHERE EXISTS (
                   SELECT 1
                     FROM protocol_logs
                     JOIN devices ON devices.public_id = protocol_logs.device_id
                    WHERE devices.id = device_credentials.device_id
                      AND protocol_logs.type IN ('device_auto_registered', 'device_registered')
                      AND protocol_logs.ts < device_credentials.registered_at
               )
        `);
}

export async function migrateDeviceMetadataAndMemos(db) {
    if (await db('node_migrations').where('name', '013_device_metadata_memos').first()) return;
    await db.transaction(async (trx) => {
        await trx.schema.alterTable('devices', (t) => {
            t.string('app_name').nullable();
            t.string('app_version').nullable();
            t.string('package_name').nullable();
            t.string('batch').nullable();
            t.string('build_id').nullable();
        });
        await trx.schema.createTable('device_memos', (t) => {
            t.increments('id');
            t.integer('project_id').notNullable().index();
            t.integer('device_id').notNullable().references('devices.id').index();
            t.integer('author_account_id').notNullable().references('accounts.id');
            t.text('body').notNullable();
            t.string('label').notNullable().defaultTo('none');
            t.bigInteger('created_at').notNullable();
            t.bigInteger('updated_at').notNullable();
        });
        await repairDeviceRegistrationTimes(trx);
        await trx('node_migrations').insert({
            name: '013_device_metadata_memos',
            created_at: new Date().toISOString(),
        });
    });
}
