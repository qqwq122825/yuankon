import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { once } from 'node:events';
import { WebSocket } from 'ws';
import { decodeJwt } from 'jose';
import { openDatabase } from '../src/database.js';
import { config, ROOT } from '../src/config.js';
import { createApplication } from '../src/app.js';
import { buildFixture } from './build-fixture.js';
let db, app, dir, base, root, a, b, m1, m2, sa, sb, sm1, sm2;
const password = 'FixturePass123!';
const sockets = [];
const date = Date.now() + 30 * 86400000;
const input = (username, studio = false) => ({
    requestId: randomUUID(),
    username,
    password,
    confirmPassword: password,
    validUntil: studio ? date : null,
    note: 'synthetic fixture',
    ...(studio ? { name: username } : {}),
});
async function req(url, token = root, method = 'GET', body) {
    const res = await fetch(base + url, {
        method,
        headers: {
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
            ...(body ? { 'Content-Type': 'application/json', 'X-Boundary-Request': '1' } : {}),
        },
        ...(body ? { body: JSON.stringify(body) } : {}),
    });
    const text = await res.text();
    return {
        status: res.status,
        body: res.headers.get('content-type')?.includes('json') ? JSON.parse(text) : text,
    };
}
async function login(username, p = password) {
    const r = await req('/api/auth/login', null, 'POST', { username, password: p });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    return r.body;
}
async function create(username, studio = false, parent, actor = root) {
    const r = await req(
        studio
            ? '/api/accounts/studios'
            : parent
              ? `/api/accounts/studios/${parent}/members`
              : '/api/accounts/members',
        actor,
        'POST',
        input(username, studio),
    );
    assert.equal(r.status, 201, JSON.stringify(r.body));
    return r.body.account;
}
async function panel(token) {
    const ticket = (await req('/api/session', token)).body.token;
    const ws = new WebSocket(`${base.replace('http', 'ws')}/ws/panel?token=${ticket}`, {
        origin: base,
    });
    sockets.push(ws);
    const messages = [];
    ws.on('message', (r) => messages.push(JSON.parse(r)));
    await once(ws, 'open');
    return { ws, messages };
}
async function waitFor(predicate) {
    for (let i = 0; i < 100; i++) {
        if (predicate()) return;
        await new Promise((r) => setTimeout(r, 10));
    }
    throw new Error('Timed out');
}
before(async () => {
    dir = await mkdtemp(path.join(tmpdir(), 'boundary-hierarchy-'));
    const settings = config({
        privateDir: dir,
        database: path.join(dir, 'db.sqlite'),
        port: 0,
        loginLimit: 200,
        apiLimit: 10000,
    });
    db = await openDatabase(settings.database);
    await db('devices').insert({ project_id: 87, public_id: 'LEGACY', source: 'sample' });
    // Rerun migration on populated legacy scopes to prove project IDs are reserved.
    await db('projects').insert({ id: 87, name: 'legacy', type: 'legacy', created_at: Date.now() });
    app = await createApplication(settings, {
        db,
        bootstrapDefault: true,
        serveFrontend: false,
        buildOptions: buildFixture,
        fetcher: async (_url, options) =>
            new Response(
                JSON.stringify({
                    data: {
                        translations: JSON.parse(options.body).q.map(() => ({
                            translatedText: '合成标签',
                        })),
                    },
                }),
            ),
    });
    await new Promise((r) => app.server.listen(0, '127.0.0.1', r));
    base = settings.origin = `http://127.0.0.1:${app.server.address().port}`;
    root = (await login('mtx', 'mtx123')).token;
});
after(async () => {
    for (const s of sockets) s.terminate();
    await app?.close();
    await db?.destroy();
    await rm(dir, { recursive: true, force: true });
});
test('studio creation is atomic, idempotent, additive and does not reassign legacy data', async () => {
    const data = input('studio_a', true);
    const r = await req('/api/accounts/studios', root, 'POST', data);
    assert.equal(r.status, 201);
    a = r.body.account;
    assert.ok(a.projectId > 87);
    assert.equal(a.apkId, '100');
    assert.deepEqual((await req('/api/accounts/studios', root, 'POST', data)).body.account, a);
    assert.equal(
        (await req('/api/accounts/studios', root, 'POST', { ...data, note: 'different' })).status,
        409,
    );
    const before = (await db('projects')).length;
    assert.equal(
        (await req('/api/accounts/studios', root, 'POST', input('studio_a', true))).status,
        409,
    );
    assert.equal((await db('projects')).length, before);
    assert.equal((await db('devices').where('public_id', 'LEGACY').first()).project_id, 87);
    b = await create('studio_b', true);
    sa = (await login(a.username)).token;
    sb = (await login(b.username)).token;
    assert.equal(
        (await req('/api/accounts/studios', sa, 'POST', input('illegal', true))).status,
        403,
    );
    assert.equal(
        (
            await req('/api/accounts/studios', root, 'POST', {
                ...input('bad', true),
                role: 'superadmin',
            })
        ).status,
        422,
    );
    assert.equal(
        (
            await req('/api/accounts/studios', root, 'POST', {
                ...input('bad', true),
                validUntil: null,
            })
        ).status,
        422,
    );
    assert.deepEqual(await db.raw('PRAGMA foreign_key_check'), []);
});
test('studio creates members with inherited deadlines; identity fields and account management are role guarded', async () => {
    m1 = await create('member_one', false, null, sa);
    m2 = await create('member_two', false, null, sa);
    sm1 = (await login(m1.username)).token;
    const logged = await login(m2.username);
    sm2 = logged.token;
    assert.equal(logged.user.validUntil, date);
    assert.equal(logged.user.inheritsValidity, true);
    assert.equal(logged.user.expiresAt, Math.min(logged.user.expiresAt, date));
    assert.ok(decodeJwt(logged.token).exp * 1000 <= date);
    assert.equal((await req('/api/accounts', sm1)).status, 403);
    assert.equal(
        (
            await req('/api/accounts/members', sa, 'POST', {
                ...input('illegal'),
                project_id: b.projectId,
            })
        ).status,
        422,
    );
    assert.equal(
        (await req(`/api/accounts/studios/${b.id}/members`, sa, 'POST', input('illegal'))).status,
        403,
    );
    assert.equal(
        (await req(`/api/accounts/${b.id}/status`, sa, 'PATCH', { enabled: false })).status,
        404,
    );
    assert.equal(
        (await req(`/api/accounts/${m1.id}/validity`, sa, 'PATCH', { validUntil: date + 1 }))
            .status,
        422,
    );
    assert.equal((await req('/api/accounts?sort=invalid', root)).status, 422);
});
test('all device/read/write/image/export/debug/memo/statistics and account route endpoints isolate two studios and two members', async () => {
    for (const [public_id, project_id, owner_account_id] of [
        ['A1', a.projectId, m1.id],
        ['A2', a.projectId, m2.id],
        ['B1', b.projectId, b.id],
    ])
        await db('devices').insert({ public_id, project_id, owner_account_id, source: 'sample' });
    const dev = await db('devices').where('public_id', 'A1').first();
    const payload = await readFile(
        path.join(ROOT, 'backend/fixtures/example-snapshot.json'),
        'utf8',
    );
    const [sid] = await db('snapshots').insert({
        device_id: dev.id,
        project_id: a.projectId,
        payload,
        source: 'sample',
        screenshot_path: 'demo:settings',
    });
    await db('lab_events').insert({ device_id: dev.id, project_id: a.projectId, kind: 'fixture' });
    assert.equal((await req('/api/devices', sa)).body.total, 2);
    assert.equal((await req('/api/devices', sm1)).body.total, 1);
    assert.equal((await req('/api/devices', sb)).body.total, 1);
    assert.equal((await req('/api/devices', sm1)).body.stats.devices, 1);
    for (const token of [sb, sm2])
        for (const path of [
            `/api/devices/${dev.id}`,
            `/api/devices/${dev.id}/ownership`,
            `/api/devices/%${dev.id.toString().charCodeAt(0).toString(16)}/ownership`,
            `/api/devices/${dev.id}/memos`,
            `/api/devices/${dev.id}/screenshot`,
            `/api/devices/${dev.id}/debug-session`,
            `/api/devices/${dev.id}/debug-events`,
            `/api/devices/${dev.id}/accessibility-snapshot?viewerId=${randomUUID()}`,
            `/api/snapshots/${sid}/image`,
            `/api/snapshots/${sid}/export`,
        ])
            assert.equal((await req(path, token)).status, 404, path);
    assert.equal((await req('/api/snapshots', sb)).body.total, 0);
    assert.equal((await req('/api/events', sm2)).body.total, 0);
    for (const [path, method, body] of [
        [`/api/devices/${dev.id}/note`, 'PATCH', { note: 'illegal' }],
        [`/api/devices/${dev.id}/blacklist`, 'PATCH', { blacklisted: true }],
        [`/api/devices/${dev.id}/revoke`, 'POST', {}],
        [`/api/devices/${dev.id}`, 'DELETE', {}],
    ])
        assert.equal((await req(path, sb, method, body)).status, 404);
    for (const token of [sa, sm1])
        for (const url of [
            '/api/logs/server',
            '/api/logs/protocol',
            '/api/logs/server/export?date=2026-10-05',
            '/api/logs/protocol/tail',
        ])
            assert.equal((await req(url, token)).status, 403);
    assert.equal((await req('/api/install/environment', sm1)).status, 403);
    assert.equal((await req('/api/apk-routes', sm1)).body.data.length, 1);
    assert.equal(
        (await req('/api/device-enrollments', sb, 'POST', { apkId: m1.apkId })).status,
        404,
    );
});
test('translation settings and caches are per project; members use translation but never read/update keys', async () => {
    assert.equal((await req('/api/settings/translation', sm1)).status, 403);
    assert.equal(
        (
            await req('/api/settings/translation', sa, 'PUT', {
                enabled: true,
                language: 'en',
                apiKey: 'SYNTHETIC-A',
            })
        ).status,
        200,
    );
    assert.equal((await req('/api/settings/translation', sb)).body.hasKey, false);
    assert.equal((await req('/api/settings/translation', sa)).body.hasKey, true);
    assert.equal(
        (await req('/api/translate', sm1, 'POST', { labels: { fixture: 'Synthetic fixture' } }))
            .status,
        200,
    );
});
test('WS list/subscriptions/broadcasts/frames are scoped and parent disable immediately revokes panels', async () => {
    const pa = await panel(sa),
        pb = await panel(sb),
        pm = await panel(sm1);
    app.store.live.set('A1', { seen: Date.now() });
    app.store.live.set('A2', { seen: Date.now() });
    app.store.live.set('B1', { seen: Date.now() });
    pm.ws.send(JSON.stringify({ type: 'get_bot_list' }));
    await waitFor(() => pm.messages.some((m) => m.type === 'bot_list'));
    assert.deepEqual(
        pm.messages.find((m) => m.type === 'bot_list').data.map((d) => d.id),
        ['A1'],
    );
    pb.ws.send(JSON.stringify({ type: 'subscribe', sessionId: 'A1' }));
    await waitFor(() => pb.messages.some((m) => m.type === 'error'));
    assert.equal(pb.messages.find((m) => m.type === 'error').code, 'not_found');
    pm.ws.send(JSON.stringify({ type: 'subscribe', sessionId: 'A2' }));
    await waitFor(() => pm.messages.some((m) => m.type === 'error'));
    await req(
        `/api/devices/${(await db('devices').where('public_id', 'A1').first()).id}/note`,
        sa,
        'PATCH',
        { note: 'scoped' },
    );
    await waitFor(() => pa.messages.some((m) => m.type === 'device_status_update'));
    assert.equal(pb.messages.filter((m) => m.type === 'device_status_update').length, 0);
    pm.ws.send(JSON.stringify({ type: 'subscribe', sessionId: 'A1' }));
    await waitFor(() => pm.messages.some((m) => m.type === 'subscribed'));
    app.ingress.notifyFrame('A1', { frameId: randomUUID() });
    await waitFor(() => pm.messages.some((m) => m.type === 'screenshot_ready'));
    assert.equal(pb.messages.filter((m) => m.type === 'screenshot_ready').length, 0);
    const closed = once(pm.ws, 'close');
    assert.equal(
        (await req(`/api/accounts/${a.id}/status`, root, 'PATCH', { enabled: false })).status,
        200,
    );
    await closed;
    assert.equal((await req('/api/devices', sm1)).status, 401);
    assert.equal((await req('/api/devices', sa)).status, 401);
    assert.equal(
        (await req(`/api/accounts/${a.id}/status`, root, 'PATCH', { enabled: true })).status,
        200,
    );
    assert.equal((await req('/api/devices', sm1)).status, 401);
    sa = (await login(a.username)).token;
    sm1 = (await login(m1.username)).token;
    sm2 = (await login(m2.username)).token;
});
test('five enabled members quota is transactional, expiry keeps slot, disabling frees slot, reenabling rechecks quota', async () => {
    await create('quota_three', false, null, sa);
    await create('quota_four', false, null, sa);
    const results = await Promise.all(
        ['quota_five', 'quota_six'].map((n) => req('/api/accounts/members', sa, 'POST', input(n))),
    );
    assert.deepEqual(results.map((r) => r.status).sort(), [201, 409]);
    const last = results.find((r) => r.status === 201).body.account;
    await db('accounts')
        .where('id', last.id)
        .update({ valid_until: Date.now() - 1 });
    assert.equal(
        (await req('/api/accounts/members', sa, 'POST', input('quota_seven'))).status,
        409,
    );
    assert.equal(
        (await req(`/api/accounts/${m2.id}/status`, sa, 'PATCH', { enabled: false })).status,
        200,
    );
    await create('quota_seven', false, null, sa);
    assert.equal(
        (await req(`/api/accounts/${m2.id}/status`, sa, 'PATCH', { enabled: true })).status,
        409,
    );
});
test('member builds default to own studio, cannot route across studios, histories/logs/delete/latestB are actor scoped', async () => {
    const templates = (await req('/api/build-templates', sm1)).body.templates;
    const t = templates.find((t) => t.kind === 'screenagent');
    const data = {
        requestId: randomUUID(),
        templateId: t.id,
        appName: 'Fixture',
        domain: 'local',
        apkId: b.apkId,
        batch: 'OK',
    };
    const r = await req('/api/builds', sm1, 'POST', data);
    assert.equal(r.status, 202, JSON.stringify(r.body));
    const job = r.body.build;
    assert.equal(job.owner_account_id, a.id);
    assert.equal(job.actor_id, m1.id);
    assert.equal(job.project_id, a.projectId);
    assert.equal(job.routing_reason, 'default_unmatched');
    await app.builds.task;
    assert.equal((await req('/api/builds', sb)).body.total, 0);
    // m2 is disabled: create a new session for the still-active quota member.
    const other = (await login('quota_seven')).token;
    assert.equal((await req('/api/builds', other)).body.total, 0);
    assert.equal((await req('/api/builds', other)).body.latestB, null);
    for (const token of [sb, other])
        for (const [url, method, body] of [
            [`/api/builds/${job.id}`, 'GET'],
            [`/api/builds/${job.id}/log`, 'GET'],
            [`/api/builds/${job.id}`, 'DELETE', {}],
        ])
            assert.equal((await req(url, token, method, body)).status, 404);
    assert.equal((await req(`/api/builds/${job.id}/artifact`, null)).status, 200);
    assert.equal((await req('/api/builds', sm1)).body.latestB.id, job.id);
});
test('superadmin can build for an explicit studio without giving other studios access', async () => {
    const templates = (await req('/api/build-templates')).body.templates;
    const data = {
        requestId: randomUUID(),
        templateId: templates.find((t) => t.kind === 'screenagent').id,
        appName: 'Fixture admin',
        domain: 'local',
        apkId: b.apkId,
    };
    const r = await req('/api/builds', root, 'POST', data);
    assert.equal(r.status, 202);
    const job = r.body.build;
    assert.equal(job.owner_account_id, b.id);
    assert.equal(job.project_id, b.projectId);
    await app.builds.task;
    assert.equal((await req(`/api/builds/${job.id}`, sb)).status, 200);
    assert.equal((await req(`/api/builds/${job.id}`, sa)).status, 404);
});
test('device JWT carries actual project; ingress stops on parent expiry and reset revokes descendant sessions without deleting records', async () => {
    const profile = {
        deviceId: 'TENANT-PHONE',
        apkId: m1.apkId,
        brand: 'Fixture',
        model: 'Fixture',
        osVersion: '15',
    };
    const r = await req('/api/client/online', null, 'POST', profile);
    assert.equal(r.status, 201);
    assert.equal(decodeJwt(r.body.deviceToken).projectId, a.projectId);
    const principal = await app.auth.verify(r.body.deviceToken, 'device', null);
    assert.equal((await app.ingress.resolve(principal)).owner_account_id, m1.id);
    await db('accounts')
        .where('id', a.id)
        .update({ valid_until: Date.now() - 1 });
    assert.equal((await req('/api/devices', sm1)).status, 401);
    await assert.rejects(app.ingress.resolve(principal), { status: 401 });
    assert.equal((await req('/api/client/online', null, 'POST', profile)).status, 401);
    await db('accounts').where('id', a.id).update({ valid_until: date });
    assert.equal(
        (
            await req(`/api/accounts/${a.id}/password`, root, 'PUT', {
                password: 'UpdatedPass123!',
                confirmPassword: 'UpdatedPass123!',
            })
        ).status,
        200,
    );
    assert.equal((await req('/api/devices', sm1)).status, 401);
    assert.equal(
        (await db('devices').where('public_id', 'TENANT-PHONE').first()).owner_account_id,
        m1.id,
    );
    const serialized = JSON.stringify(await db('account_audit'));
    assert.ok(!serialized.includes(password));
    assert.ok(!serialized.includes('UpdatedPass123!'));
    assert.ok(!serialized.includes('password_hash'));
});
