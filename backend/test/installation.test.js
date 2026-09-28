import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import argon2 from 'argon2';
import { config } from '../src/config.js';
import { openDatabase } from '../src/database.js';
import { createApplication } from '../src/app.js';

async function call(base, url, body) {
    const response = await fetch(base + url, {
        method: body === undefined ? 'GET' : 'POST',
        headers:
            body === undefined
                ? {}
                : { 'Content-Type': 'application/json', 'X-Boundary-Request': '1' },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    return {
        status: response.status,
        body: await response.json(),
        cookie: response.headers.get('set-cookie'),
    };
}

test('web installer creates the only superadmin and completion lock before enabling login', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'boundary-web-install-'));
    const settings = config({
        privateDir: path.join(dir, '.node-private'),
        database: path.join(dir, 'install.sqlite'),
        port: 0,
    });
    const db = await openDatabase(settings.database);
    let app = await createApplication(settings, { db, serveFrontend: false });
    try {
        await new Promise((resolve) => app.server.listen(0, '127.0.0.1', resolve));
        settings.origin = `http://127.0.0.1:${app.server.address().port}`;
        assert.deepEqual((await call(settings.origin, '/api/install/status')).body, {
            installed: false,
        });
        assert.equal((await call(settings.origin, '/api/health')).status, 503);
        assert.equal(
            (
                await call(settings.origin, '/api/install', {
                    username: 'owner_admin',
                    password: 'short',
                    confirmPassword: 'short',
                })
            ).status,
            422,
        );
        assert.equal(
            (
                await call(settings.origin, '/api/install', {
                    username: 'owner_admin',
                    password: 'StrongPass123!',
                    confirmPassword: 'different-pass',
                })
            ).status,
            422,
        );

        const installed = await call(settings.origin, '/api/install', {
            username: 'Owner_Admin',
            password: 'StrongPass123!',
            confirmPassword: 'StrongPass123!',
        });
        assert.equal(installed.status, 201);
        assert.equal(installed.body.installed, true);
        assert.equal(installed.body.user.username, 'owner_admin');
        assert.equal(installed.body.user.apkId, '1');
        const root = await db('accounts').first();
        assert.equal(root.username, 'owner_admin');
        assert.equal(await argon2.verify(root.password_hash, 'StrongPass123!'), true);
        assert.equal((await db('accounts')).length, 1);
        assert.equal((await db('account_audit').where('event', 'installed')).length, 1);

        const lockText = await readFile(path.join(settings.privateDir, 'install.lock'), 'utf8');
        const lock = JSON.parse(lockText);
        assert.equal(lock.source, 'web-installer');
        assert.equal(lock.username, 'owner_admin');
        assert.equal(lock.apkId, '1');
        assert.doesNotMatch(lockText, /StrongPass123/);
        assert.deepEqual((await call(settings.origin, '/api/install/status')).body, {
            installed: true,
        });
        assert.equal(
            (
                await call(settings.origin, '/api/install', {
                    username: 'second_admin',
                    password: 'AnotherPass123!',
                    confirmPassword: 'AnotherPass123!',
                })
            ).status,
            409,
        );
        const login = await call(settings.origin, '/api/auth/login', {
            username: 'owner_admin',
            password: 'StrongPass123!',
        });
        assert.equal(login.status, 200);
        assert.match(login.cookie, /HttpOnly/);

        await app.close();
        app = null;
        app = await createApplication(settings, { db, serveFrontend: false });
        await new Promise((resolve) => app.server.listen(0, '127.0.0.1', resolve));
        settings.origin = `http://127.0.0.1:${app.server.address().port}`;
        assert.deepEqual((await call(settings.origin, '/api/install/status')).body, {
            installed: true,
        });
        assert.equal((await db('accounts')).length, 1);
    } finally {
        await app?.close();
        await db.destroy();
        await rm(dir, { recursive: true, force: true });
    }
});

test('an existing legacy superadmin is marked installed even when disabled', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'boundary-existing-install-'));
    const settings = config({
        privateDir: path.join(dir, '.node-private'),
        database: path.join(dir, 'existing.sqlite'),
        port: 0,
    });
    const db = await openDatabase(settings.database);
    const [id] = await db('accounts').insert({
        username: 'legacy_admin',
        password_hash: await argon2.hash('LegacyPass123!'),
        role: 'superadmin',
        enabled: false,
        created_at: Date.now(),
    });
    const app = await createApplication(settings, { db, serveFrontend: false });
    try {
        await new Promise((resolve) => app.server.listen(0, '127.0.0.1', resolve));
        settings.origin = `http://127.0.0.1:${app.server.address().port}`;
        assert.deepEqual((await call(settings.origin, '/api/install/status')).body, {
            installed: true,
        });
        const lock = JSON.parse(
            await readFile(path.join(settings.privateDir, 'install.lock'), 'utf8'),
        );
        assert.equal(lock.accountId, id);
        assert.equal(lock.source, 'existing-account');
        assert.equal(
            (
                await call(settings.origin, '/api/install', {
                    username: 'replacement',
                    password: 'Replacement123!',
                    confirmPassword: 'Replacement123!',
                })
            ).status,
            409,
        );
    } finally {
        await app.close();
        await db.destroy();
        await rm(dir, { recursive: true, force: true });
    }
});
