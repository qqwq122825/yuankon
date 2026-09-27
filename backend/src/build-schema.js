export async function migrateBuilds(db) {
    if (await db('node_migrations').where('name', '006_apk_queue').first()) return;
    await db.transaction(async (trx) => {
        await trx.schema.alterTable('apk_builds', (t) => {
            for (const name of [
                'template_id',
                'template_name',
                'template_version',
                'domain',
                'backend_url',
                'apk_id',
                'batch',
                'package_name',
                'stage',
                'error_message',
                'started_at',
                'finished_at',
            ])
                t.string(name).nullable();
            t.text('template_snapshot').nullable();
            t.text('request_body').nullable();
            t.integer('actor_id').nullable();
            t.string('request_id').nullable().unique();
        });
        await trx('node_migrations').insert({
            name: '006_apk_queue',
            created_at: new Date().toISOString(),
        });
    });
}
