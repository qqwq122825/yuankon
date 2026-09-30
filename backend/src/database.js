import knex from 'knex';
import {
    migrateAccounts,
    migrateAccountValidity,
    migrateAccountApkId,
    migrateSuperadminApkId,
    migrateAccountApkSequence,
} from './account-schema.js';
import {
    migrateDevices,
    migrateDeviceManagement,
    migrateDeviceMetadataAndMemos,
    migrateDeviceDebugReports,
    migrateDeviceDebugScreenshots,
} from './device-schema.js';
import { migrateAbPackageBuilds, migrateBuilds } from './build-schema.js';
import { migrateClientRequestLogs } from './log-schema.js';
import { mkdirSync, chmodSync } from 'node:fs';
import path from 'node:path';

export async function openDatabase(filename) {
    if (filename !== ':memory:')
        mkdirSync(path.dirname(filename), { recursive: true, mode: 0o700 });
    const db = knex({
        client: 'better-sqlite3',
        connection: { filename },
        useNullAsDefault: true,
        pool: {
            min: 1,
            max: 1,
            afterCreate(connection, done) {
                connection.pragma('foreign_keys = ON');
                connection.pragma('journal_mode = WAL');
                done(null, connection);
            },
        },
    });
    if (!(await db.schema.hasTable('node_migrations'))) {
        await db.transaction(async (trx) => {
            await trx.schema.createTable('node_migrations', (t) => {
                t.string('name').primary();
                t.string('created_at');
            });
            await trx.schema.createTable('devices', (t) => {
                t.increments('id');
                t.integer('project_id').notNullable().index();
                t.string('public_id').notNullable().unique();
                for (const field of ['name', 'brand', 'android_version', 'source', 'note'])
                    t.string(field).notNullable().defaultTo('');
                t.boolean('accessibility_enabled').nullable();
                t.integer('battery').nullable();
                t.string('last_received_at').nullable();
                t.string('last_heartbeat_at').nullable();
            });
            await trx.schema.createTable('snapshots', (t) => {
                t.increments('id');
                t.integer('project_id').notNullable().index();
                t.integer('device_id').notNullable().references('devices.id');
                t.string('source');
                t.string('captured_at');
                t.text('payload');
                t.integer('node_count');
                t.integer('window_count');
                t.string('screenshot_path').nullable();
            });
            await trx.schema.createTable('lab_events', (t) => {
                t.increments('id');
                t.integer('project_id').notNullable().index();
                t.integer('device_id').references('devices.id');
                t.string('kind');
                t.string('source');
                t.string('occurred_at');
            });
            await trx.schema.createTable('apk_builds', (t) => {
                t.string('id').primary();
                t.integer('project_id').notNullable().index();
                for (const f of [
                    'app_name',
                    'home_url',
                    'status',
                    'artifact_path',
                    'sha256',
                    'delivery_status',
                    'created_at',
                ])
                    t.string(f).nullable();
                t.bigInteger('size').nullable();
            });
            await trx.schema.createTable('node_settings', (t) => {
                t.integer('project_id').primary();
                t.text('translation');
            });
            await trx.schema.createTable('protocol_logs', (t) => {
                t.increments('id');
                t.integer('project_id').notNullable().index();
                t.bigInteger('ts').index();
                t.string('device_id').nullable();
                t.string('dir');
                t.string('channel');
                t.string('type');
                t.integer('size');
            });
            await trx('node_migrations').insert({
                name: '001_initial',
                created_at: new Date().toISOString(),
            });
        });
    }
    await migrateAccounts(db);
    await migrateDevices(db);
    await migrateDeviceManagement(db);
    await migrateBuilds(db);
    await migrateAccountValidity(db);
    await migrateAccountApkId(db);
    await migrateSuperadminApkId(db);
    await migrateAbPackageBuilds(db);
    await migrateAccountApkSequence(db);
    await migrateClientRequestLogs(db);
    await migrateDeviceMetadataAndMemos(db);
    await migrateDeviceDebugReports(db);
    await migrateDeviceDebugScreenshots(db);
    if (filename !== ':memory:') chmodSync(filename, 0o600);
    return db;
}
