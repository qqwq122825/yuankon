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
