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

export async function migrateAbPackageBuilds(db) {
    if (await db('node_migrations').where('name', '010_ab_package_builds').first()) return;
    await db.transaction(async (trx) => {
        await trx.schema.alterTable('apk_builds', (t) => {
            t.string('artifact_role').nullable().index();
            t.string('payload_build_id').nullable().index();
            t.string('payload_sha256').nullable();
            t.string('payload_package_name').nullable();
        });
        await trx('apk_builds')
            .where('template_id', 'screenagent-1.0')
            .whereNull('artifact_role')
            .update({ artifact_role: 'b' });
        await trx('apk_builds')
            .whereNotNull('template_id')
            .whereNull('artifact_role')
            .update({ artifact_role: 'standalone' });
        await trx('node_migrations').insert({
            name: '010_ab_package_builds',
            created_at: new Date().toISOString(),
        });
    });
}
