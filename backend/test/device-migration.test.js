import { test } from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { openDatabase } from '../src/database.js';

test('device enrollment migration preserves populated legacy devices and referencing snapshots with foreign keys enabled', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'boundary-device-migration-'));
    const filename = path.join(dir, 'old.sqlite');
    const old = new Database(filename);
    old.exec(`
        PRAGMA foreign_keys = ON;
        CREATE TABLE node_migrations (name TEXT PRIMARY KEY, created_at TEXT);
        INSERT INTO node_migrations VALUES ('001_initial','fixture'), ('002_superadmin_auth','fixture');
        CREATE TABLE accounts (id INTEGER PRIMARY KEY);
        CREATE TABLE devices (id INTEGER PRIMARY KEY, public_id TEXT UNIQUE, project_id INTEGER);
        CREATE TABLE snapshots (id INTEGER PRIMARY KEY, device_id INTEGER REFERENCES devices(id), payload TEXT);
        CREATE TABLE apk_builds (id TEXT PRIMARY KEY, project_id INTEGER, app_name TEXT, status TEXT);
        INSERT INTO apk_builds VALUES ('legacy-build', 1, 'Preserved build', 'succeeded');
        INSERT INTO devices VALUES (1,'PRESERVED_DEVICE',1);
        INSERT INTO snapshots VALUES (1,1,'preserved fixture');
    `);
    old.close();
    let db;
    try {
        db = await openDatabase(filename);
        assert.deepEqual(await db('snapshots').first(), {
            id: 1,
            device_id: 1,
            payload: 'preserved fixture',
        });
        const device = await db('devices').first();
        assert.equal(device.public_id, 'PRESERVED_DEVICE');
        assert.equal(device.owner_account_id, null);
        assert.equal(device.apk_id, null);
        assert.equal((await db('apk_builds').first()).app_name, 'Preserved build');
        assert.equal((await db('apk_builds').first()).template_id, null);
        assert.equal(await db.schema.hasColumn('accounts', 'valid_until'), true);
        assert.equal(await db.schema.hasColumn('accounts', 'apk_id'), true);
        assert.equal((await db('apk_builds').first()).routing_reason, null);
        assert.deepEqual(await db.raw('PRAGMA foreign_key_check'), []);
        await assert.rejects(db('devices').where('id', 1).update({ owner_account_id: 999 }));
        await db.destroy();
        db = await openDatabase(filename);
        assert.equal(
            (await db('node_migrations').where('name', '004_device_enrollment')).length,
            1,
        );
        assert.equal((await db('node_migrations').where('name', '007_account_validity')).length, 1);
        assert.equal((await db('node_migrations').where('name', '008_account_apk_id')).length, 1);
        assert.equal(
            (await db('node_migrations').where('name', '009_superadmin_apk_id_1')).length,
            1,
        );
        assert.equal(
            (await db('node_migrations').where('name', '010_ab_package_builds')).length,
            1,
        );
        assert.equal(
            (await db('node_migrations').where('name', '011_unique_account_apk_sequence')).length,
            1,
        );
        assert.equal((await db('account_apk_sequence').where('id', 1).first()).next_value, 100);
    } finally {
        await db?.destroy();
        await rm(dir, { recursive: true, force: true });
    }
});
