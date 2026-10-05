export async function migrateClientRequestLogs(db) {
    if (await db('node_migrations').where('name', '012_client_request_logs').first()) return;
    await db.transaction(async (trx) => {
        if (!(await trx.schema.hasTable('protocol_logs')))
            await trx.schema.createTable('protocol_logs', (t) => {
                t.increments('id');
                t.integer('project_id').notNullable().index();
                t.bigInteger('ts').index();
                t.string('device_id').nullable();
                t.string('dir');
                t.string('channel');
                t.string('type');
                t.integer('size');
                t.string('request_method').nullable();
                t.string('request_path').nullable();
                t.integer('response_status').nullable();
                t.integer('duration_ms').nullable();
            });
        else
            await trx.schema.alterTable('protocol_logs', (t) => {
                t.string('request_method').nullable();
                t.string('request_path').nullable();
                t.integer('response_status').nullable();
                t.integer('duration_ms').nullable();
            });
        await trx('node_migrations').insert({
            name: '012_client_request_logs',
            created_at: new Date().toISOString(),
        });
    });
}

export async function migrateServerLogs(db) {
    if (await db('node_migrations').where('name', '016_server_logs').first()) return;
    await db.transaction(async (trx) => {
        await trx.schema.createTable('server_logs', (t) => {
            t.increments('id');
            t.integer('project_id').notNullable().index();
            t.bigInteger('ts').notNullable().index();
            t.string('level').notNullable().index();
            t.string('category').notNullable().index();
            t.string('event').notNullable();
            t.string('message').notNullable();
            t.string('request_method').nullable();
            t.string('request_path').nullable();
            t.integer('response_status').nullable();
            t.integer('duration_ms').nullable();
            t.string('error_kind').nullable();
            t.string('error_code').nullable();
        });
        await trx('node_migrations').insert({
            name: '016_server_logs',
            created_at: new Date().toISOString(),
        });
    });
}
