import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { once } from 'node:events';
import { WebSocket } from 'ws';
import { decodeJwt } from 'jose';
import { config, ROOT } from '../src/config.js';
import { openDatabase } from '../src/database.js';
import { createApplication } from '../src/app.js';
import { migrateStudioExpiry } from '../src/studio-expiry.js';
import { buildFixture } from './build-fixture.js';

const password = 'SyntheticExpiry123!';
async function fixture() {
    const dir = await mkdtemp(path.join(tmpdir(), 'boundary-expiry-'));
    const settings = config({
        privateDir: dir,
        database: path.join(dir, 'db.sqlite'),
        port: 0,
        loginLimit: 1000,
        apiLimit: 10000,
    });
    const db = await openDatabase(settings.database);
    let app = await createApplication(settings, {
        db,
        bootstrapDefault: true,
        serveFrontend: false,
        buildOptions: buildFixture,
    });
    await new Promise((r) => app.server.listen(0, '127.0.0.1', r));
    let base = (settings.origin = `http://127.0.0.1:${app.server.address().port}`);
    const sockets = [];
    async function req(url, token, method = 'GET', body) {
        const res = await fetch(base + url, {
            method,
            headers: {
                ...(token ? { Authorization: `Bearer ${token}` } : {}),
                ...(body ? { 'Content-Type': 'application/json', 'X-Boundary-Request': '1' } : {}),
            },
            ...(body ? { body: JSON.stringify(body) } : {}),
        });
        return { status: res.status, body: await res.json() };
    }
    async function login(username = 'mtx', pass = 'mtx123') {
        const r = await req('/api/auth/login', null, 'POST', { username, password: pass });
        assert.equal(r.status, 200, JSON.stringify(r.body));
        return r.body;
    }
    const admin = await login();
    async function studio(username = 'expiry_studio', validUntil = Date.now() + 86400000) {
        const r = await req('/api/accounts/studios', admin.token, 'POST', {
            requestId: randomUUID(),
            username,
            password,
            confirmPassword: password,
            validUntil,
            note: '',
            name: username,
        });
        assert.equal(r.status, 201, JSON.stringify(r.body));
        return r.body.account;
    }
    async function member(parent, username = 'expiry_member') {
        const r = await req(`/api/accounts/studios/${parent.id}/members`, admin.token, 'POST', {
            requestId: randomUUID(),
            username,
            password,
            confirmPassword: password,
            validUntil: null,
            note: '',
        });
        assert.equal(r.status, 201);
        return r.body.account;
    }
    async function phone(owner, id = 'EXPIRY-PHONE') {
        const profile = {
            deviceId: id,
            apkId: owner.apkId,
            model: 'Synthetic phone',
            brand: 'Fixture',
            osVersion: '15',
        };
        const r = await req('/api/client/online', null, 'POST', profile);
        assert.equal(r.status, 201);
        return { profile, ...r.body, row: await db('devices').where('id', r.body.localId).first() };
    }
    async function panel(token) {
        const r = await req('/api/session', token);
        assert.equal(r.status, 200);
        const ws = new WebSocket(`${base.replace('http', 'ws')}/ws/panel?token=${r.body.token}`, {
            origin: base,
        });
        sockets.push(ws);
        const messages = [];
        ws.on('message', (b) => messages.push(JSON.parse(b)));
        await once(ws, 'open');
        return { ws, messages };
    }
    return {
        db,
        settings,
        req,
        login,
        admin,
        studio,
        member,
        phone,
        panel,
        get app() {
            return app;
        },
        async deviceSocket(token) {
            const ws = new WebSocket(`${base.replace('http', 'ws')}/ws/device`, {
                headers: { Authorization: `Bearer ${token}` },
            });
            sockets.push(ws);
            await once(ws, 'open');
            return ws;
        },
        async restart() {
            for (const s of sockets) s.terminate();
            await app.close();
            app = await createApplication(settings, {
                db,
                serveFrontend: false,
                buildOptions: buildFixture,
            });
            await new Promise((r) => app.server.listen(0, '127.0.0.1', r));
            base = settings.origin = `http://127.0.0.1:${app.server.address().port}`;
        },
        async close() {
            for (const s of sockets) s.terminate();
            await app.close();
            await db.destroy();
            await rm(dir, { recursive: true, force: true });
        },
    };
}
async function waitFor(predicate, timeout = 2000) {
    const start = Date.now();
    while (Date.now() - start < timeout) {
        if (await predicate()) return;
        await new Promise((r) => setTimeout(r, 20));
    }
    throw new Error('Timed out waiting for expiry takeover');
}

test('expiry atomically moves the studio and member fleet plus history, preserving flags, IDs, credentials and APK routes', async () => {
    const f = await fixture();
    try {
        const a = await f.studio(),
            m = await f.member(a),
            b = await f.studio('other_studio');
        const p = await f.phone(a),
            pm = await f.phone(m, 'MEMBER-PHONE'),
            pb = await f.phone(b, 'OTHER-PHONE');
        const [blocked] = await f.db('devices').insert({
            project_id: a.projectId,
            public_id: 'BLOCKED',
            source: 'sample',
            owner_account_id: a.id,
            is_blacklisted: true,
        });
        const [deleted] = await f.db('devices').insert({
            project_id: a.projectId,
            public_id: 'DELETED',
            source: 'sample',
            owner_account_id: m.id,
            deleted_at: 123,
        });
        const [sid] = await f.db('snapshots').insert({
            project_id: a.projectId,
            device_id: p.localId,
            source: 'sample',
            payload: await readFile(
                path.join(ROOT, 'backend/fixtures/example-snapshot.json'),
                'utf8',
            ),
            screenshot_path: 'demo:settings',
        });
        await f
            .db('lab_events')
            .insert({ project_id: a.projectId, device_id: p.localId, kind: 'synthetic' });
        await f.db('device_memos').insert({
            project_id: a.projectId,
            device_id: p.localId,
            author_account_id: m.id,
            body: 'Synthetic memo',
            label: 'none',
            created_at: 1,
            updated_at: 1,
        });
        await f.db('device_debug_reports').insert({
            project_id: a.projectId,
            device_id: p.localId,
            public_id: p.deviceId,
            session_id: randomUUID(),
            ts: 1,
            level: 'info',
            source: 'client',
            stage: 'test',
            message: 'synthetic',
            screenshot_path: 'debug-screenshots/fixture.jpg',
        });
        await f.db('protocol_logs').insert({
            project_id: a.projectId,
            device_id: p.deviceId,
            ts: Date.now(),
            type: 'synthetic',
        });
        const credentials = await f.db('device_credentials').orderBy('device_id'),
            routes = await f.db('apk_routes').orderBy('apk_id');
        const studioLogin = await f.login(a.username, password),
            memberLogin = await f.login(m.username, password);
        const expires = Date.now() - 1;
        await f.db('accounts').where('id', a.id).update({ valid_until: expires });
        await Promise.all([
            f.app.studioExpiry.sweep(),
            f.app.studioExpiry.sweep(),
            f.app.studioExpiry.sweep(),
        ]);
        for (const id of [p.localId, pm.localId, blocked, deleted]) {
            const row = await f.db('devices').where({ id }).first();
            assert.equal(row.project_id, 1);
            assert.equal(row.owner_account_id, f.admin.user.id);
        }
        assert.equal((await f.db('devices').where('id', blocked).first()).is_blacklisted, 1);
        assert.equal((await f.db('devices').where('id', deleted).first()).deleted_at, 123);
        assert.deepEqual(await f.db('device_credentials').orderBy('device_id'), credentials);
        assert.deepEqual(await f.db('apk_routes').orderBy('apk_id'), routes);
        for (const table of ['snapshots', 'lab_events', 'device_memos', 'device_debug_reports'])
            assert.equal((await f.db(table).where('device_id', p.localId).first()).project_id, 1);
        assert.equal(
            (
                await f
                    .db('protocol_logs')
                    .where({ device_id: p.deviceId, type: 'synthetic' })
                    .first()
            ).project_id,
            1,
        );
        assert.equal(
            (await f.db('devices').where('id', pb.localId).first()).project_id,
            b.projectId,
        );
        assert.equal((await f.req('/api/devices', studioLogin.token)).status, 401);
        assert.equal((await f.req('/api/devices', memberLogin.token)).status, 401);
        assert.equal(
            (
                await f.req(
                    `/api/snapshots/${sid}/image`,
                    (await f.login(b.username, password)).token,
                )
            ).status,
            404,
        );
        const run = await f.db('studio_expiry_takeovers').first();
        assert.equal(run.device_count, 4);
        assert.equal(run.expired_at, expires);
        assert.equal((await f.db('device_expiry_takeovers')).length, 4);
        assert.equal(
            (await f.db('account_audit').where('event', 'studio_expiry_devices_transferred'))
                .length,
            1,
        );
        assert.deepEqual(await f.db.raw('PRAGMA foreign_key_check'), []);
        await f.app.studioExpiry.sweep();
        await migrateStudioExpiry(f.db);
        assert.equal((await f.db('studio_expiry_takeovers')).length, 1);
    } finally {
        await f.close();
    }
});

test('expired renewal settles the old deadline in the renewal transaction; renewal never returns transferred devices', async () => {
    const f = await fixture();
    try {
        const a = await f.studio(),
            m = await f.member(a),
            p = await f.phone(m);
        const expired = Date.now() - 1;
        await f.db('accounts').where('id', a.id).update({ valid_until: expired });
        const actor = await f.db('accounts').where('id', f.admin.user.id).first();
        const row = await f.app.accountManagement.change(actor, a.id, 'validity', {
            validUntil: Date.now() + 86400000,
        });
        assert.equal(row.expiryTakeover.deviceCount, 1);
        assert.equal(
            (await f.db('devices').where('id', p.localId).first()).owner_account_id,
            f.admin.user.id,
        );
        const login = await f.login(a.username, password),
            memberLogin = await f.login(m.username, password);
        assert.equal((await f.req(`/api/devices/${p.localId}`, login.token)).status, 404);
        assert.equal(
            (await f.req(`/api/devices/${p.localId}/ownership`, memberLogin.token)).status,
            404,
        );
        assert.equal((await f.req('/api/devices', login.token)).body.total, 0);
        const fresh = await f.phone(m, 'POST-RENEWAL');
        assert.equal(fresh.owner.id, m.id);
        assert.equal((await f.req('/api/devices', login.token)).body.total, 1);
        const r = await f.req('/api/client/online', null, 'POST', p.profile);
        assert.equal(r.status, 201);
        assert.equal(r.body.owner.id, f.admin.user.id);
        assert.equal(decodeJwt(r.body.deviceToken).projectId, 1);
    } finally {
        await f.close();
    }
});

test('early renewal, manual suspension and member-only expiry do not transfer the fleet; exact studio deadline does', async () => {
    const f = await fixture();
    try {
        const a = await f.studio(),
            m = await f.member(a),
            p = await f.phone(m);
        await f
            .db('accounts')
            .where('id', m.id)
            .update({ valid_until: Date.now() - 1 });
        await f.db('accounts').where('id', a.id).update({ enabled: false });
        await f.app.studioExpiry.sweep();
        assert.equal((await f.db('devices').where('id', p.localId).first()).owner_account_id, m.id);
        const actor = await f.db('accounts').where('id', f.admin.user.id).first();
        const deadline = Date.now() + 86400000;
        await f.app.accountManagement.change(actor, a.id, 'validity', { validUntil: deadline });
        assert.equal((await f.db('studio_expiry_takeovers')).length, 0);
        assert.equal((await f.db('accounts').where('id', a.id).first()).enabled, 0);
        const before = await f.db.transaction((trx) =>
            f.app.studioExpiry.transferExpired(trx, { now: deadline - 1 }),
        );
        assert.equal(before.length, 0);
        const exact = await f.db.transaction((trx) =>
            f.app.studioExpiry.transferExpired(trx, { now: deadline }),
        );
        await f.app.studioExpiry.notify(exact);
        assert.equal(exact.length, 1);
        assert.equal(
            (await f.db('devices').where('id', p.localId).first()).owner_account_id,
            f.admin.user.id,
        );
    } finally {
        await f.close();
    }
});

test('takeover closes old panel/device sockets and leases, clears all temporary caches; old JWT fails and existing APK reconnects to superadmin', async () => {
    const f = await fixture();
    try {
        const a = await f.studio(),
            m = await f.member(a),
            p = await f.phone(m);
        const login = await f.login(m.username, password),
            panel = await f.panel(login.token);
        const rootPanel = await f.panel(f.admin.token),
            ws = await f.deviceSocket(p.deviceToken);
        for (const map of [
            'frames',
            'recentImages',
            'tapFrames',
            'nodeFrames',
            'viewerLeases',
            'grants',
            'pendingCaptures',
            'autoCaptureAt',
            'debugSessions',
        ])
            f.app.ingress[map].set(p.localId, { ownerId: m.id, expiresAt: Date.now() + 100000 });
        const principal = await f.app.auth.verify(p.deviceToken, 'device', null);
        await f
            .db('accounts')
            .where('id', a.id)
            .update({ valid_until: Date.now() - 1 });
        const r = await f.req('/api/devices', f.admin.token);
        assert.equal(r.status, 200);
        await waitFor(
            () => panel.ws.readyState === WebSocket.CLOSED && ws.readyState === WebSocket.CLOSED,
        );
        assert.ok(panel.messages.some((x) => x.type === 'forced_logout'));
        await waitFor(() =>
            rootPanel.messages.some(
                (x) => x.data?.localId === p.localId || x.data?.id === p.deviceId,
            ),
        );
        for (const map of [
            'frames',
            'recentImages',
            'tapFrames',
            'nodeFrames',
            'viewerLeases',
            'grants',
            'pendingCaptures',
            'autoCaptureAt',
            'debugSessions',
        ])
            assert.equal(f.app.ingress[map].has(p.localId), false, map);
        await assert.rejects(f.app.ingress.resolve(principal), { status: 401 });
        const reconnect = await f.req('/api/client/online', null, 'POST', p.profile);
        assert.equal(reconnect.status, 201);
        assert.equal(reconnect.body.owner.id, f.admin.user.id);
        const newPrincipal = await f.app.auth.verify(reconnect.body.deviceToken, 'device', null);
        const current = await f.app.ingress.resolve(newPrincipal);
        assert.equal(current.project_id, 1);
        await assert.rejects(f.app.ingress.status(p.row, { deviceId: p.deviceId }), {
            status: 401,
        });
        assert.equal(
            (
                await f.req('/api/sync/status', reconnect.body.deviceToken, 'POST', {
                    deviceId: p.deviceId,
                    batteryLevel: 50,
                })
            ).status,
            200,
        );
        const unregistered = await f.req('/api/client/online', null, 'POST', {
            ...p.profile,
            deviceId: 'NEW-EXPIRED-PHONE',
        });
        assert.equal(unregistered.status, 401);
        assert.equal(
            (await f.req('/api/client/online', null, 'POST', { ...p.profile, apkId: a.apkId }))
                .status,
            401,
        );
        await f.db('device_credentials').where('device_id', p.localId).update({ revoked: true });
        assert.equal((await f.req('/api/client/online', null, 'POST', p.profile)).status, 403);
    } finally {
        await f.close();
    }
});

test('startup catches offline expired studios, empty fleets are audited once and reboot is idempotent', async () => {
    const f = await fixture();
    try {
        const a = await f.studio(),
            p = await f.phone(a),
            empty = await f.studio('empty_studio');
        await f
            .db('accounts')
            .whereIn('id', [a.id, empty.id])
            .update({ valid_until: Date.now() - 1 });
        await f.restart();
        assert.equal(
            (await f.db('devices').where('id', p.localId).first()).owner_account_id,
            f.admin.user.id,
        );
        assert.deepEqual(
            (await f.db('studio_expiry_takeovers').orderBy('device_count')).map(
                (x) => x.device_count,
            ),
            [0, 1],
        );
        await f.restart();
        assert.equal((await f.db('studio_expiry_takeovers')).length, 2);
        assert.equal(
            (await f.db('account_audit').where('event', 'studio_expiry_devices_transferred'))
                .length,
            2,
        );
    } finally {
        await f.close();
    }
});

test('idle server timer transfers on expiry without browser or device requests', async () => {
    const f = await fixture();
    try {
        const a = await f.studio(),
            p = await f.phone(a);
        await f
            .db('accounts')
            .where('id', a.id)
            .update({ valid_until: Date.now() - 1 });
        await waitFor(
            async () =>
                (await f.db('devices').where('id', p.localId).first()).owner_account_id ===
                f.admin.user.id,
            6500,
        );
        assert.equal((await f.db('studio_expiry_takeovers')).length, 1);
    } finally {
        await f.close();
    }
});

test('unavailable canonical superadmin aborts the entire transaction and retries after recovery, without redirecting routes', async () => {
    const f = await fixture();
    try {
        const a = await f.studio(),
            p = await f.phone(a);
        await f
            .db('accounts')
            .where('id', a.id)
            .update({ valid_until: Date.now() - 1 });
        await f.db('accounts').where('id', f.admin.user.id).update({ enabled: false });
        await assert.rejects(f.app.studioExpiry.sweep(), { status: 503 });
        assert.equal((await f.db('devices').where('id', p.localId).first()).owner_account_id, a.id);
        assert.equal((await f.db('studio_expiry_takeovers')).length, 0);
        assert.equal(
            (await f.db('account_audit').where('event', 'studio_expiry_devices_transferred'))
                .length,
            0,
        );
        await f.db('accounts').where('id', f.admin.user.id).update({ enabled: true });
        await f.app.studioExpiry.sweep();
        assert.equal(
            (await f.db('devices').where('id', p.localId).first()).owner_account_id,
            f.admin.user.id,
        );
    } finally {
        await f.close();
    }
});
