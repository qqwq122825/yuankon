import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openDatabase } from '../src/database.js';
import { Accounts } from '../src/accounts.js';
import { assignAccountApkId } from '../src/account-apk.js';
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
        assert.equal(second.apkId, '3');
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
