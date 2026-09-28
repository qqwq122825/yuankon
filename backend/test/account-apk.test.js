import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { openDatabase } from '../src/database.js';
import { Accounts } from '../src/accounts.js';
import { assignAccountApkId, createAccountWithApkId } from '../src/account-apk.js';
import { migrateSuperadminApkId } from '../src/account-schema.js';

test('initial account receives one fixed APK ID; creation is atomic, unique and restart keeps disabled routes disabled', async () => {
    const db = await openDatabase(':memory:');
    const accounts = new Accounts(db, { projectId: 1 }, Buffer.alloc(32, 1));
    try {
        await accounts.initialize({ seedDefault: true });
        const root = await db('accounts').first();
        assert.equal(root.apk_id, '1');
        assert.equal(
            (await db('apk_routes').where('apk_id', root.apk_id).first()).owner_account_id,
            root.id,
        );
        const create = (username) =>
            db.transaction(async (trx) => {
                const [id] = await trx('accounts').insert({
                    username,
                    password_hash: 'fixture',
                    created_at: 1,
                });
                const apkId = await assignAccountApkId(trx, { id }, 1);
                return { id, apkId };
            });
        // A historical alias reserves a number even when disabled.
        await db('apk_routes').insert({
            apk_id: '2',
            owner_account_id: root.id,
            project_id: 1,
            enabled: false,
            created_at: 1,
        });
        const second = await create('fixture_second');
        assert.equal(second.apkId, '100');
        await assert.rejects(db('accounts').where('id', second.id).update({ apk_id: root.apk_id }));
        await assert.rejects(
            db.transaction(async (trx) => {
                const [id] = await trx('accounts').insert({
                    username: 'rolled_back',
                    password_hash: 'fixture',
                    created_at: 1,
                });
                await assignAccountApkId(trx, { id }, 1);
                throw new Error('rollback fixture');
            }),
        );
        assert.equal(await db('accounts').where('username', 'rolled_back').first(), undefined);
        assert.equal((await db('apk_routes')).length, 3);
        await db('apk_routes').where('apk_id', root.apk_id).update({ enabled: false });
        assert.equal(
            await db.transaction((trx) => assignAccountApkId(trx, { id: root.id }, 1)),
            root.apk_id,
        );
        await accounts.initialize();
        assert.equal((await db('accounts').where('id', root.id).first()).apk_id, root.apk_id);
        assert.equal((await db('apk_routes').where('apk_id', root.apk_id).first()).enabled, 0);
    } finally {
        await db.destroy();
    }
});

test('migration of an account with only disabled legacy routes does not create an active replacement', async () => {
    const db = await openDatabase(':memory:');
    try {
        const [id] = await db('accounts').insert({
            username: 'disabled_fixture',
            password_hash: 'fixture',
            created_at: 1,
        });
        await db('apk_routes').insert({
            apk_id: 'DISABLED',
            owner_account_id: id,
            project_id: 1,
            enabled: false,
            created_at: 1,
        });
        assert.equal(await db.transaction((trx) => assignAccountApkId(trx, { id }, 1)), 'DISABLED');
        assert.equal((await db('apk_routes')).length, 1);
        assert.equal((await db('apk_routes').first()).enabled, 0);
    } finally {
        await db.destroy();
    }
});

test('migration changes the existing superadmin canonical APK ID to 1 without rewriting aliases, devices or historical builds', async () => {
    const db = await openDatabase(':memory:');
    const accounts = new Accounts(db, { projectId: 1 }, Buffer.alloc(32, 1));
    try {
        const [id] = await db('accounts').insert({
            username: 'mtx',
            password_hash: 'fixture',
            apk_id: '10074',
            created_at: 1,
        });
        await db('apk_routes').insert([
            {
                apk_id: 'FOREIGN',
                owner_account_id: id,
                project_id: 2,
                enabled: true,
                created_at: 0,
            },
            {
                apk_id: 'DISABLED',
                owner_account_id: id,
                project_id: 1,
                enabled: false,
                created_at: 0,
            },
            { apk_id: '10074', owner_account_id: id, project_id: 1, enabled: true, created_at: 1 },
            {
                apk_id: 'OLD_ALIAS',
                owner_account_id: id,
                project_id: 1,
                enabled: true,
                created_at: 2,
            },
        ]);
        await db('devices').insert({
            public_id: 'LEGACY',
            project_id: 1,
            owner_account_id: id,
            apk_id: 'OLD_ALIAS',
        });
        await db('apk_builds').insert({ id: 'legacy', project_id: 1, apk_id: 'OLD_ALIAS' });
        await db('node_migrations').where('name', '009_superadmin_apk_id_1').delete();
        await migrateSuperadminApkId(db);
        await migrateSuperadminApkId(db);
        await accounts.initialize();
        await accounts.initialize();
        const row = await db('accounts').where({ id }).first();
        assert.equal((await accounts.publicUser(row)).apkId, '1');
        assert.equal((await db('apk_routes')).length, 5);
        assert.equal((await db('apk_routes').where('apk_id', '1').first()).owner_account_id, id);
        assert.equal((await db('apk_routes').where('apk_id', '1').first()).enabled, 1);
        assert.equal(
            (await db('apk_routes').where('apk_id', '10074').first()).owner_account_id,
            id,
        );
        assert.equal((await db('devices').first()).apk_id, 'OLD_ALIAS');
        assert.equal((await db('apk_builds').first()).apk_id, 'OLD_ALIAS');
        assert.equal(
            await db('node_migrations')
                .where('name', '009_superadmin_apk_id_1')
                .count('* as n')
                .first()
                .then(({ n }) => n),
            1,
        );
        assert.deepEqual(await db.raw('PRAGMA foreign_key_check'), []);
    } finally {
        await db.destroy();
    }
});

test('superadmin APK ID migration rejects a conflicting owner without partial changes', async () => {
    const db = await openDatabase(':memory:');
    try {
        const [rootId] = await db('accounts').insert({
            username: 'root_fixture',
            password_hash: 'fixture',
            apk_id: '10074',
            created_at: 1,
        });
        const [otherId] = await db('accounts').insert({
            username: 'other_fixture',
            password_hash: 'fixture',
            apk_id: '1',
            created_at: 2,
        });
        await db('apk_routes').insert([
            {
                apk_id: '10074',
                owner_account_id: rootId,
                project_id: 1,
                enabled: true,
                created_at: 1,
            },
            {
                apk_id: '1',
                owner_account_id: otherId,
                project_id: 1,
                enabled: true,
                created_at: 2,
            },
        ]);
        await db('node_migrations').where('name', '009_superadmin_apk_id_1').delete();
        await assert.rejects(migrateSuperadminApkId(db), /APK ID 1 已被其他账号占用/);
        assert.equal((await db('accounts').where('id', rootId).first()).apk_id, '10074');
        assert.equal(
            await db('node_migrations').where('name', '009_superadmin_apk_id_1').first(),
            undefined,
        );
    } finally {
        await db.destroy();
    }
});

async function createManagedAccount(db, username, role = 'tenant_admin') {
    const account = await db.transaction((trx) =>
        createAccountWithApkId(
            trx,
            {
                username,
                password_hash: 'fixture',
                role,
                enabled: true,
                created_at: Date.now(),
            },
            1,
        ),
    );
    return { id: account.id, apkId: account.apk_id };
}

test('account APK IDs use one durable sequence, skip legacy collisions and are never reused', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'boundary-apk-sequence-'));
    const filename = path.join(dir, 'accounts.sqlite');
    let db;
    try {
        db = await openDatabase(filename);
        const root = await createManagedAccount(db, 'root_sequence', 'superadmin');
        assert.equal(root.apkId, '1');
        await db('apk_routes').insert({
            apk_id: '100',
            project_id: 1,
            owner_account_id: root.id,
            enabled: false,
            created_at: 1,
        });
        const created = await Promise.all([
            createManagedAccount(db, 'studio_a'),
            createManagedAccount(db, 'studio_b'),
            createManagedAccount(db, 'member_a', 'tenant_member'),
        ]);
        assert.deepEqual(
            created.map((account) => account.apkId),
            ['101', '102', '103'],
        );
        assert.equal(new Set(created.map((account) => account.apkId)).size, created.length);
        await db('accounts').where('id', created[0].id).update({ enabled: false });
        await db('apk_routes').where('apk_id', created[0].apkId).update({ enabled: false });
        assert.equal((await createManagedAccount(db, 'studio_c')).apkId, '104');
        await db.destroy();
        db = await openDatabase(filename);
        assert.equal((await createManagedAccount(db, 'studio_after_restart')).apkId, '105');
        assert.equal((await db('account_apk_sequence').where('id', 1).first()).next_value, 106);
        assert.equal(
            Number(
                (await db('accounts').whereNotNull('apk_id').countDistinct('apk_id as n').first())
                    .n,
            ),
            Number((await db('accounts').whereNotNull('apk_id').count('* as n').first()).n),
        );
        await assert.rejects(
            db.transaction((trx) =>
                createAccountWithApkId(
                    trx,
                    {
                        username: 'studio_after_restart',
                        password_hash: 'fixture',
                        role: 'tenant_admin',
                        enabled: true,
                        created_at: Date.now(),
                    },
                    1,
                ),
            ),
        );
        assert.equal((await db('account_apk_sequence').where('id', 1).first()).next_value, 106);
    } finally {
        await db?.destroy();
        await rm(dir, { recursive: true, force: true });
    }
});

test('a numeric legacy route advances the allocator instead of allowing a future collision', async () => {
    const db = await openDatabase(':memory:');
    try {
        const root = await createManagedAccount(db, 'root_legacy_sequence', 'superadmin');
        const [id] = await db('accounts').insert({
            username: 'legacy_owner',
            password_hash: 'fixture',
            role: 'tenant_admin',
            enabled: true,
            created_at: Date.now(),
        });
        await db('apk_routes').insert({
            apk_id: '900',
            project_id: 1,
            owner_account_id: id,
            enabled: true,
            created_at: 1,
        });
        assert.equal(await db.transaction((trx) => assignAccountApkId(trx, { id }, 1)), '900');
        assert.equal((await createManagedAccount(db, 'after_legacy')).apkId, '901');
        assert.equal(
            (await db('apk_routes').where('apk_id', '1').first()).owner_account_id,
            root.id,
        );
    } finally {
        await db.destroy();
    }
});
