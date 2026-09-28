import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { once } from 'node:events';
import { decodeJwt } from 'jose';
import { WebSocket } from 'ws';
import { config, ROOT } from '../src/config.js';
import { openDatabase } from '../src/database.js';
import { createApplication } from '../src/app.js';

let dir, db, app, settings, base;
let password = 'mtx123';
const sockets = [];
before(async () => {
    dir = await mkdtemp(path.join(tmpdir(), 'boundary-auth-'));
    settings = config({
        privateDir: dir,
        database: path.join(dir, 'auth.sqlite'),
        port: 0,
        loginLimit: 100,
    });
    db = await openDatabase(settings.database);
    await db('devices').insert([
        { id: 1, project_id: 1, public_id: 'ROOT-A', name: 'Studio A', source: 'sample' },
        { id: 2, project_id: 2, public_id: 'ROOT-B', name: 'Studio B', source: 'sample' },
    ]);
    const payload = await readFile(
        path.join(ROOT, 'backend/fixtures/example-snapshot.json'),
        'utf8',
    );
    await db('snapshots').insert({
        id: 1,
        project_id: 2,
        device_id: 2,
        source: 'sample',
        payload,
        node_count: 19,
        window_count: 2,
        screenshot_path: 'demo:settings',
    });
    app = await createApplication(settings, { db, serveFrontend: false, bootstrapDefault: true });
    await new Promise((r) => app.server.listen(0, '127.0.0.1', r));
    base = settings.origin = `http://127.0.0.1:${app.server.address().port}`;
});
after(async () => {
    for (const ws of sockets) ws.terminate();
    await app?.close();
    await db?.destroy();
    await rm(dir, { recursive: true, force: true });
});
async function request(url, { token, method = 'GET', body, cookie, headers = {} } = {}) {
    const response = await fetch(base + url, {
        method,
        headers: {
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
            ...(cookie ? { Cookie: cookie } : {}),
            ...(body !== undefined
                ? { 'Content-Type': 'application/json', 'X-Boundary-Request': '1' }
                : {}),
            ...headers,
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    const text = await response.text();
    return {
        status: response.status,
        body: response.headers.get('content-type')?.includes('json') ? JSON.parse(text) : text,
        headers: response.headers,
    };
}
async function login(p = password) {
    const r = await request('/api/auth/login', {
        method: 'POST',
        body: { username: 'mtx', password: p },
    });
    assert.equal(r.status, 200);
    return { ...r.body, cookie: r.headers.get('set-cookie').split(';')[0], headers: r.headers };
}
async function panel(token) {
    const ticket = (await request('/api/session', { token })).body.token;
    const ws = new WebSocket(`${base.replace('http', 'ws')}/ws/panel?token=${ticket}`, {
        origin: base,
    });
    sockets.push(ws);
    const messages = [];
    ws.on('message', (raw) => messages.push(JSON.parse(raw.toString())));
    await once(ws, 'open');
    return { ws, ticket, messages };
}
async function rejectTicket(ticket) {
    const ws = new WebSocket(`${base.replace('http', 'ws')}/ws/panel?token=${ticket}`, {
        origin: base,
    });
    sockets.push(ws);
    const [e] = await once(ws, 'error');
    assert.match(e.message, /401/);
}

test('test fixture superadmin is seeded once with Argon2id, not plaintext', async () => {
    const user = await db('accounts').first();
    assert.equal(user.username, 'mtx');
    assert.equal(user.role, 'superadmin');
    assert.match(user.password_hash, /^\$argon2id\$/);
    assert.ok(!user.password_hash.includes('mtx123'));
    await app.accounts.initialize();
    assert.equal((await db('accounts').count('* as n').first()).n, 1);
    assert.equal((await db('devices').count('* as n').first()).n, 2);
    assert.equal(await db.schema.hasTable('studios'), false);
});
test('every data route and panel-ticket route requires login', async () => {
    for (const url of [
        '/api/devices',
        '/api/device/list',
        '/api/devices/2',
        '/api/devices/1/memos',
        '/api/snapshots/1/image',
        '/api/snapshots/1/export',
        '/api/builds',
        '/api/settings/translation',
        '/api/logs/protocol',
        '/api/session',
        '/api/auth/me',
    ])
        assert.equal((await request(url)).status, 401, url);
    assert.equal((await request('/api/health')).status, 200);
});
test('password login issues an expiring JWT and HttpOnly cookie; bearer and cookie both work', async () => {
    const s = await login(),
        claims = decodeJwt(s.token);
    assert.equal(claims.aud, 'boundary-http');
    assert.equal(claims.iss, 'boundary-accounts');
    assert.equal(claims.exp - claims.iat, 28800);
    assert.ok(claims.sid);
    assert.match(s.headers.get('set-cookie'), /HttpOnly/);
    assert.match(s.headers.get('set-cookie'), /SameSite=Strict/);
    assert.match(s.headers.get('set-cookie'), /Path=\/api/);
    assert.equal((await request('/api/auth/me', { token: s.token })).body.user.username, 'mtx');
    assert.equal((await request('/api/auth/me', { cookie: s.cookie })).status, 200);
    assert.ok(!JSON.stringify(s.user).includes('session_id'));
    assert.ok(!JSON.stringify(s.user).includes('password_hash'));
    assert.equal(
        (await request('/api/auth/me', { cookie: s.cookie, token: 'invalid' })).status,
        401,
    );
});
test('incorrect credentials give the same error; private values never reach audit', async () => {
    const a = await request('/api/auth/login', {
            method: 'POST',
            body: { username: 'unknown', password: 'secret-invalid' },
        }),
        b = await request('/api/auth/login', {
            method: 'POST',
            body: { username: 'mtx', password: 'secret-invalid' },
        });
    assert.equal(a.status, 401);
    assert.deepEqual(a.body, b.body);
    assert.ok(!JSON.stringify(await db('account_audit')).includes('secret-invalid'));
});
test('account profile exposes one fixed APK ID, not legacy aliases, and separates validity from session expiry', async () => {
    const root = await db('accounts').first();
    const [otherId] = await db('accounts').insert({
        username: 'other_fixture',
        password_hash: root.password_hash,
        role: 'member',
        enabled: false,
        created_at: Date.now(),
    });
    try {
        await db('apk_routes').insert([
            {
                apk_id: '10074',
                project_id: 1,
                owner_account_id: root.id,
                enabled: true,
                created_at: 1,
            },
            {
                apk_id: '10075',
                project_id: 1,
                owner_account_id: root.id,
                enabled: true,
                created_at: 2,
            },
            {
                apk_id: 'DISABLED',
                project_id: 1,
                owner_account_id: root.id,
                enabled: false,
                created_at: 0,
            },
            {
                apk_id: 'OTHER',
                project_id: 2,
                owner_account_id: otherId,
                enabled: true,
                created_at: 0,
            },
        ]);
        const s = await login();
        assert.equal(s.user.apkId, root.apk_id);
        assert.ok(!('apkIds' in s.user));
        assert.equal(s.user.validUntil, null);
        assert.ok(s.user.expiresAt > Date.now());
        assert.deepEqual((await request('/api/auth/me', { token: s.token })).body.user, s.user);
        await db('apk_routes').where('apk_id', '10074').update({ enabled: false });
        assert.equal(
            (await request('/api/auth/me', { token: s.token })).body.user.apkId,
            root.apk_id,
        );
    } finally {
        await db('apk_routes').whereIn('apk_id', ['10074', '10075', 'DISABLED', 'OTHER']).delete();
        await db('accounts').where('id', otherId).delete();
    }
});
test('account validity caps tokens and expiry blocks login, HTTP and existing WS; extending validity does not revive expired sessions', async () => {
    try {
        const deadline = Date.now() + 60000;
        await db('accounts').update({ valid_until: deadline });
        const s = await login();
        assert.equal(s.user.validUntil, deadline);
        assert.equal(s.user.expiresAt, deadline);
        assert.equal(decodeJwt(s.token).exp, Math.floor(deadline / 1000));
        const p = await panel(s.token),
            closed = once(p.ws, 'close');
        await db('accounts').update({ valid_until: Date.now() - 1000 });
        assert.equal((await request('/api/devices', { token: s.token })).status, 401);
        assert.equal((await request('/api/builds', { cookie: s.cookie })).status, 401);
        assert.equal(
            (
                await request('/api/auth/login', {
                    method: 'POST',
                    body: { username: 'mtx', password },
                })
            ).status,
            401,
        );
        const wrong = await request('/api/auth/login', {
            method: 'POST',
            body: { username: 'mtx', password: 'wrong' },
        });
        assert.equal(wrong.body.error, '账号或密码错误');
        p.ws.send(JSON.stringify({ type: 'ping' }));
        assert.equal((await closed)[0], 4001);
        await rejectTicket(p.ticket);
        // A normal elapsed deadline also expires the persisted session. Renewal
        // extends account validity, not the old session or token.
        await db('accounts').update({
            session_expires_at: Date.now() - 1000,
            valid_until: Date.now() + 86400000,
        });
        assert.equal((await request('/api/auth/me', { token: s.token })).status, 401);
        assert.equal((await login()).user.username, 'mtx');
        const verified = await app.accounts.checkPassword('mtx', password);
        await db('accounts').update({ valid_until: Date.now() - 1 });
        await assert.rejects(app.accounts.login(verified, '127.0.0.1'), { status: 401 });
    } finally {
        await db('accounts').update({ valid_until: null });
    }
});
test('superadmin reads and updates all project devices and exports their snapshots', async () => {
    const s = await login();
    const list = await request('/api/devices', { token: s.token });
    assert.equal(list.body.total, 2);
    assert.deepEqual(
        list.body.data.map((d) => d.project_id),
        [1, 2],
    );
    assert.equal(
        (
            await request('/api/devices/2/note', {
                token: s.token,
                method: 'PATCH',
                body: { note: 'Root management' },
            })
        ).status,
        200,
    );
    assert.equal((await request('/api/snapshots/1/export', { token: s.token })).status, 200);
    assert.equal((await request('/api/snapshots/1/image', { cookie: s.cookie })).status, 200);
    assert.equal(
        (
            await request('/api/users', {
                token: s.token,
                method: 'POST',
                body: { username: 'later' },
            })
        ).status,
        404,
    );
});
test('new login immediately kicks the old WS and invalidates old HTTP, cookie and tickets', async () => {
    const old = await login(),
        p = await panel(old.token);
    const closed = once(p.ws, 'close');
    const current = await login();
    const [code, reason] = await closed;
    assert.equal(code, 4001);
    assert.equal(reason.toString(), 'kicked');
    assert.ok(p.messages.some((m) => m.type === 'forced_logout'));
    assert.equal((await request('/api/devices', { token: old.token })).status, 401);
    assert.equal((await request('/api/snapshots/1/image', { cookie: old.cookie })).status, 401);
    await rejectTicket(p.ticket);
    assert.equal((await request('/api/devices', { token: current.token })).status, 200);
});
test('concurrent logins leave exactly one live session', async () => {
    const [a, b] = await Promise.all([login(), login()]);
    const statuses = await Promise.all(
        [a, b].map((s) => request('/api/auth/me', { token: s.token }).then((r) => r.status)),
    );
    assert.deepEqual(statuses.sort(), [200, 401]);
});
test('logout revokes both HTTP and WS; a late old-session logout preserves the new login', async () => {
    const old = await login(),
        oldRow = await db('accounts').first(),
        current = await login();
    await app.accounts.logout(oldRow, '127.0.0.1');
    assert.equal((await request('/api/auth/me', { token: current.token })).status, 200);
    const p = await panel(current.token),
        closed = once(p.ws, 'close');
    const r = await request('/api/auth/logout', { token: current.token, method: 'POST', body: {} });
    assert.equal(r.status, 200);
    assert.match(r.headers.get('set-cookie'), /Expires=Thu, 01 Jan 1970/);
    await closed;
    await rejectTicket(p.ticket);
    assert.equal((await request('/api/devices', { token: current.token })).status, 401);
    assert.equal((await request('/api/devices', { token: old.token })).status, 401);
});
test('password change checks the original password, revokes sessions and survives initialization', async () => {
    const old = await login();
    assert.equal(
        (
            await request('/api/auth/change-password', {
                token: old.token,
                method: 'POST',
                body: { oldPassword: 'wrong', newPassword: 'new-secret-123' },
            })
        ).status,
        422,
    );
    const p = await panel(old.token),
        closed = once(p.ws, 'close');
    assert.equal(
        (
            await request('/api/auth/change-password', {
                token: old.token,
                method: 'POST',
                body: { oldPassword: password, newPassword: 'new-secret-123' },
            })
        ).status,
        200,
    );
    const [code, reason] = await closed;
    assert.equal(code, 4001);
    assert.equal(reason.toString(), 'password_changed');
    password = 'new-secret-123';
    assert.equal((await request('/api/devices', { token: old.token })).status, 401);
    assert.equal(
        (
            await request('/api/auth/login', {
                method: 'POST',
                body: { username: 'mtx', password: 'mtx123' },
            })
        ).status,
        401,
    );
    await app.accounts.initialize();
    const current = await login();
    assert.equal(current.user.username, 'mtx');
});
test('expired sessions are blocked in HTTP and on each WS message', async () => {
    const s = await login(),
        p = await panel(s.token),
        closed = once(p.ws, 'close');
    await db('accounts').update({ session_expires_at: Date.now() - 1000 });
    assert.equal((await request('/api/devices', { token: s.token })).status, 401);
    p.ws.send(JSON.stringify({ type: 'ping' }));
    assert.equal((await closed)[0], 4001);
});
test('panel ticket expiration rotates the connection without revoking the account', async () => {
    const s = await login();
    const ticket = await app.accounts.sign(await db('accounts').first(), 'boundary-panel', 1);
    const ws = new WebSocket(`${base.replace('http', 'ws')}/ws/panel?token=${ticket}`, {
        origin: base,
    });
    sockets.push(ws);
    const messages = [];
    ws.on('message', (raw) => messages.push(JSON.parse(raw.toString())));
    await once(ws, 'open');
    const closed = once(ws, 'close');
    await new Promise((resolve) => setTimeout(resolve, 1100));
    ws.send(JSON.stringify({ type: 'ping' }));
    const [code, reason] = await closed;
    assert.equal(code, 4001);
    assert.equal(reason.toString(), 'ticket_expired');
    assert.ok(messages.some((m) => m.type === 'forced_logout' && m.code === 'ticket_expired'));
    assert.equal((await request('/api/auth/me', { token: s.token })).status, 200);
    assert.equal((await request('/api/session', { token: s.token })).status, 200);
});
test('account role and enabled state are checked, not accepted from client fields', async () => {
    const s = await login();
    await db('accounts').update({ enabled: false });
    assert.equal((await request('/api/devices', { token: s.token })).status, 401);
    assert.equal(
        (await request('/api/auth/login', { method: 'POST', body: { username: 'mtx', password } }))
            .status,
        401,
    );
    await db('accounts').update({ enabled: true });
    assert.equal(
        (
            await request('/api/auth/login', {
                method: 'POST',
                body: { username: 'mtx', password, role: 'superadmin' },
            })
        ).status,
        422,
    );
    await db('accounts').update({ role: 'member' });
    assert.equal(
        (await request('/api/auth/login', { method: 'POST', body: { username: 'mtx', password } }))
            .status,
        401,
    );
    await db('accounts').update({ role: 'superadmin' });
});
test('device tokens and panel tickets cannot be used as HTTP account tokens', async () => {
    const s = await login(),
        ticket = (await request('/api/session', { token: s.token })).body.token;
    assert.equal((await request('/api/devices', { token: ticket })).status, 401);
    assert.equal(
        (await request('/api/devices', { token: await app.auth.issue('device', 'ROOT-A') })).status,
        401,
    );
    await rejectTicket(s.token);
});
test('login limiter stops repeated failures', async () => {
    const folder = await mkdtemp(path.join(tmpdir(), 'boundary-login-limit-'));
    const c = config({
        privateDir: folder,
        database: path.join(folder, 'db.sqlite'),
        port: 0,
        loginLimit: 2,
    });
    const limited = await createApplication(c, { serveFrontend: false, bootstrapDefault: true });
    try {
        await new Promise((r) => limited.server.listen(0, '127.0.0.1', r));
        c.origin = `http://127.0.0.1:${limited.server.address().port}`;
        const statuses = [];
        for (let i = 0; i < 3; i++) {
            const r = await fetch(c.origin + '/api/auth/login', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'X-Boundary-Request': '1' },
                body: JSON.stringify({ username: 'mtx', password: 'wrong' }),
            });
            await r.text();
            statuses.push(r.status);
        }
        assert.deepEqual(statuses, [401, 401, 429]);
    } finally {
        await limited.close();
        await rm(folder, { recursive: true, force: true });
    }
});
