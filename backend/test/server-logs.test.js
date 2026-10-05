import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { config } from '../src/config.js';
import { openDatabase } from '../src/database.js';
import { createApplication } from '../src/app.js';
import { ServerLogs } from '../src/server-logs.js';
import { migrateServerLogs } from '../src/log-schema.js';

let dir, db, app, base, token;
before(async () => {
    dir = await mkdtemp(path.join(tmpdir(), 'boundary-server-logs-'));
    const settings = config({
        privateDir: dir,
        database: path.join(dir, 'logs.sqlite'),
        port: 0,
        apiLimit: 10000,
    });
    db = await openDatabase(settings.database);
    app = await createApplication(settings, { db, serveFrontend: false, bootstrapDefault: true });
    await new Promise((resolve) => app.server.listen(0, '127.0.0.1', resolve));
    base = settings.origin = `http://127.0.0.1:${app.server.address().port}`;
    const response = await request('/api/auth/login', {
        method: 'POST',
        body: { username: 'mtx', password: 'mtx123' },
        authenticated: false,
    });
    assert.equal(response.status, 200);
    token = response.body.token;
});
after(async () => {
    await app.close();
    await db.destroy();
    await rm(dir, { recursive: true, force: true });
});
async function request(url, { method = 'GET', body, authenticated = true, headers = {} } = {}) {
    const response = await fetch(base + url, {
        method,
        headers: {
            ...(authenticated ? { Authorization: `Bearer ${token}` } : {}),
            ...(body ? { 'Content-Type': 'application/json', 'X-Boundary-Request': '1' } : {}),
            ...headers,
        },
        ...(body ? { body: JSON.stringify(body) } : {}),
    });
    const raw = await response.text();
    return {
        status: response.status,
        body: response.headers.get('content-type')?.includes('application/json')
            ? JSON.parse(raw)
            : raw,
        headers: response.headers,
    };
}

test('server log migration is additive and idempotent, preserving device protocol records', async () => {
    await db('protocol_logs').insert({
        project_id: 2,
        ts: Date.now(),
        device_id: 'PRESERVED',
        type: 'device_fixture',
        channel: 'device',
    });
    await migrateServerLogs(db);
    await migrateServerLogs(db);
    assert.equal((await db('node_migrations').where('name', '016_server_logs')).length, 1);
    assert.equal((await db('protocol_logs').where('device_id', 'PRESERVED')).length, 1);
});

test('global server log contains runtime and HTTP events, not device protocol content', async () => {
    assert.equal((await request('/api/system/info')).status, 200);
    const result = await request('/api/logs/server');
    assert.equal(result.status, 200);
    assert.equal(result.headers.get('cache-control'), 'no-store');
    assert.equal(result.body.source, 'node-server');
    assert.equal(result.body.payloadPolicy, 'metadata-only');
    assert.ok(result.body.data.some((row) => row.event === 'application_ready'));
    assert.ok(result.body.data.some((row) => row.event === 'server_listening'));
    assert.ok(
        result.body.data.some(
            (row) => row.request_path === '/api/system/info' && row.response_status === 200,
        ),
    );
    assert.ok(
        result.body.data.every(
            (row) => !Object.hasOwn(row, 'device_id') && row.event !== 'device_fixture',
        ),
    );
});

test('all log routes reject unauthenticated requests; explicit role guard also rejects future ordinary accounts', async () => {
    const paths = [
        '/api/logs/server',
        '/api/logs/server/tail',
        '/api/logs/server/export?date=2026-10-05',
        '/api/logs/protocol',
        '/api/logs/protocol/tail',
        '/api/logs/protocol/export?date=2026-10-05',
    ];
    for (const url of paths)
        assert.equal((await request(url, { authenticated: false })).status, 401, url);
    // Model an authenticated ordinary account without opening ordinary-account login in production.
    const resolve = app.accounts.resolveSession;
    app.accounts.resolveSession = async (...args) => ({
        ...(await resolve.apply(app.accounts, args)),
        role: 'member',
    });
    try {
        for (const url of paths)
            assert.equal(
                (await request(url, { headers: { 'X-Role': 'superadmin' } })).status,
                403,
                url,
            );
    } finally {
        app.accounts.resolveSession = resolve;
    }
    assert.equal((await request('/api/logs/server')).status, 200);
});

test('role guard fails closed for unknown roles and missing users', () => {
    const guard = app.accounts.requireSuperadmin();
    for (const role of ['member', 'studio', 'admin', undefined]) {
        let error;
        guard({ user: { role } }, {}, (value) => {
            error = value;
        });
        assert.equal(error.status, 403);
    }
    let missing;
    guard({}, {}, (value) => {
        missing = value;
    });
    assert.equal(missing.status, 401);
});

test('server errors record allowlisted cause metadata, never passwords, JWTs, queries, raw URLs or error messages', async () => {
    const secret = 'SYNTHETIC_PRIVATE_VALUE';
    await request(`/api/auth/login?token=${secret}`, {
        authenticated: false,
        method: 'POST',
        body: { username: 'unknown', password: secret },
    });
    await request(`/api/not-found/${secret}?password=${secret}`);
    const scope = app.store.withScope;
    app.store.withScope = function (user) {
        const scoped = scope.call(this, user);
        scoped.list = async () => {
            throw Object.assign(new TypeError(secret), { code: 'SQLITE_BUSY' });
        };
        return scoped;
    };
    try {
        assert.equal((await request('/api/devices')).status, 500);
    } finally {
        app.store.withScope = scope;
    }
    const result = await request('/api/logs/server?level=error');
    assert.ok(
        result.body.data.some(
            (row) =>
                row.event === 'http_error' &&
                row.error_kind === 'TypeError' &&
                row.error_code === 'SQLITE_BUSY',
        ),
    );
    const serialized = JSON.stringify(await db('server_logs'));
    assert.equal(serialized.includes(secret), false);
    assert.equal(serialized.includes(token), false);
    assert.equal(serialized.includes('password_hash'), false);
    assert.equal(serialized.includes('Authorization'), false);
    assert.ok(
        (await db('server_logs')).some(
            (row) => row.response_status === 401 && row.request_path.endsWith('/login'),
        ),
    );
});

test('latest page, ascending incremental cursor, level/category filtering, empty state and bounded input work', async () => {
    for (let i = 0; i < 105; i++) await app.serverLogs.record('application_ready');
    const recent = (await request('/api/logs/server/tail?category=runtime')).body.data;
    assert.equal(recent.length, 100);
    assert.ok(recent.every((row, i) => i === 0 || row.id > recent[i - 1].id));
    const lastId = recent.at(-1).id;
    await app.serverLogs.record('server_start_failed');
    const incremental = await request(
        `/api/logs/server/tail?afterId=${lastId}&level=error&category=runtime`,
    );
    assert.equal(incremental.body.data.length, 1);
    assert.equal(incremental.body.data[0].event, 'server_start_failed');
    const empty = await request(`/api/logs/server/tail?afterId=${incremental.body.data[0].id}`);
    assert.deepEqual(empty.body.data, []);
    for (const query of [
        'limit=101',
        'limit=0',
        'afterId=-1',
        'level=debug',
        'category=device',
        'path=/etc/passwd',
        'date=2026-02-31',
    ])
        assert.equal((await request(`/api/logs/server?${query}`)).status, 422, query);
    assert.equal((await request('/api/logs/server/tail?date=2000-01-01')).body.data.length, 0);
});

test('superadmin JSONL export obeys UTC date and filters without leaking device logs', async () => {
    const date = new Date().toISOString().slice(0, 10);
    const result = await request(
        `/api/logs/server/export?date=${date}&category=runtime&level=error`,
    );
    assert.equal(result.status, 200);
    assert.match(result.headers.get('content-disposition'), /server-.*\.jsonl/);
    const rows = result.body.split('\n').filter(Boolean).map(JSON.parse);
    assert.ok(rows.length > 0);
    assert.ok(
        rows.every(
            (row) =>
                row.level === 'error' &&
                row.category === 'runtime' &&
                new Date(row.ts).toISOString().startsWith(date),
        ),
    );
    assert.equal((await request('/api/logs/server/export?date=2000-01-01')).body, '');
    assert.equal((await request('/api/logs/server/export?date=2026-02-31')).status, 422);
});

test('seven-day retention and row cap only prune server logs, leaving existing protocol logs intact', async () => {
    const limitedDb = await openDatabase(':memory:');
    try {
        const logs = new ServerLogs(limitedDb, { projectId: 1 }, { maxRows: 3 });
        await limitedDb('protocol_logs').insert({ project_id: 1, ts: 1, type: 'keep_device_log' });
        await limitedDb('server_logs').insert({
            project_id: 1,
            ts: 1,
            level: 'info',
            category: 'runtime',
            event: 'application_ready',
            message: 'expired fixture',
        });
        for (let i = 0; i < 5; i++) await logs.record('application_ready');
        await logs.prune();
        assert.equal((await limitedDb('server_logs')).length, 3);
        assert.equal((await limitedDb('server_logs').where('ts', 1)).length, 0);
        assert.equal((await limitedDb('protocol_logs')).length, 1);
    } finally {
        await limitedDb.destroy();
    }
});

test('server shutdown writes and drains lifecycle logs before closing storage', async () => {
    const shutdownDb = await openDatabase(':memory:');
    const shutdown = await createApplication(config({ privateDir: dir }), {
        db: shutdownDb,
        serveFrontend: false,
    });
    await new Promise((resolve) => shutdown.server.listen(0, '127.0.0.1', resolve));
    await shutdown.close();
    assert.deepEqual(
        (
            await shutdownDb('server_logs')
                .whereIn('event', ['server_stopping', 'server_stopped'])
                .orderBy('id')
        ).map((row) => row.event),
        ['server_stopping', 'server_stopped'],
    );
    await shutdownDb.destroy();
});
