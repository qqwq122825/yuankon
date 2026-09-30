import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile, writeFile, mkdir, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { once } from 'node:events';
import { request as httpRequest } from 'node:http';
import { WebSocket } from 'ws';
import sharp from 'sharp';
import { config, ROOT } from '../src/config.js';
import { openDatabase } from '../src/database.js';
import { createApplication } from '../src/app.js';
import { normalizeSnapshot, labelsFor } from '../src/protocol.js';
import { Translation } from '../src/translation.js';
import { privateFile, checkPng } from '../src/files.js';
import { allowedRequest, isLoopback } from '../src/security.js';

let dir, db, app, settings, base, fixture, accessToken;
const sockets = [];
before(async () => {
    dir = await mkdtemp(path.join(tmpdir(), 'boundary-node-test-'));
    settings = config({
        privateDir: path.join(dir, '.node-private'),
        database: path.join(dir, 'test.sqlite'),
        port: 0,
    });
    db = await openDatabase(settings.database);
    fixture = JSON.parse(
        await readFile(path.join(ROOT, 'backend/fixtures/example-snapshot.json'), 'utf8'),
    );
    for (let id = 1; id <= 15; id++)
        await db('devices').insert({
            id,
            project_id: 1,
            public_id: `TEST-${String(id).padStart(3, '0')}`,
            name: `Fixture ${id}`,
            source: 'sample',
            brand: 'Fixture',
            android_version: id === 1 ? '9' : id === 2 ? '15' : '14',
            battery: id === 15 ? null : id,
            note: '',
            accessibility_enabled: id % 2 === 0,
        });
    await db('devices').insert([
        { id: 100, project_id: 1, public_id: 'DEVICE-100', name: 'Socket fixture', source: 'api' },
        { id: 200, project_id: 2, public_id: 'OTHER-200', name: 'Other project', source: 'api' },
    ]);
    await db('snapshots').insert([
        {
            id: 1,
            project_id: 1,
            device_id: 1,
            source: 'sample',
            captured_at: new Date().toISOString(),
            payload: JSON.stringify(fixture),
            node_count: 100,
            window_count: 5,
            screenshot_path: 'demo:settings',
        },
        {
            id: 2,
            project_id: 1,
            device_id: 1,
            source: 'sample',
            captured_at: new Date().toISOString(),
            payload: JSON.stringify(fixture),
            node_count: 1,
            window_count: 1,
        },
        {
            id: 3,
            project_id: 2,
            device_id: 200,
            source: 'sample',
            payload: JSON.stringify(fixture),
            node_count: 900,
            window_count: 9,
        },
    ]);
    app = await createApplication(settings, { db, serveFrontend: false, bootstrapDefault: true });
    await new Promise((resolve) => app.server.listen(0, '127.0.0.1', resolve));
    base = settings.origin = `http://127.0.0.1:${app.server.address().port}`;
    const login = await fetch(base + '/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Boundary-Request': '1' },
        body: JSON.stringify({ username: 'mtx', password: 'mtx123' }),
    });
    accessToken = (await login.json()).token;
    assert.equal(login.status, 200);
});
after(async () => {
    for (const ws of sockets) ws.terminate();
    await app?.close();
    await db?.destroy();
    await rm(dir, { recursive: true, force: true });
});
async function request(url, options = {}) {
    const r = await fetch(base + url, {
        ...options,
        headers: { Authorization: `Bearer ${accessToken}`, ...options.headers },
    });
    const contentType = r.headers.get('content-type');
    return {
        status: r.status,
        body: contentType?.includes('json') ? await r.json() : await r.text(),
        headers: r.headers,
    };
}
const json = (method, body) => ({
    method,
    headers: { 'Content-Type': 'application/json', 'X-Boundary-Request': '1' },
    body: JSON.stringify(body),
});
function listen(ws) {
    const queue = [],
        waiters = [];
    ws.on('message', (raw) => {
        const value = JSON.parse(raw.toString());
        const i = waiters.findIndex((w) => w.type === value.type);
        if (i >= 0) {
            const waiter = waiters.splice(i, 1)[0];
            clearTimeout(waiter.timer);
            waiter.resolve(value);
        } else queue.push(value);
    });
    return (type) => {
        const i = queue.findIndex((m) => m.type === type);
        if (i >= 0) return Promise.resolve(queue.splice(i, 1)[0]);
        return new Promise((resolve, reject) => {
            const waiter = {
                type,
                resolve,
                timer: setTimeout(() => reject(new Error(`Timed out: ${type}`)), 2000),
            };
            waiters.push(waiter);
        });
    };
}
async function panel() {
    const token = (await request('/api/session')).body.token;
    const ws = new WebSocket(`${base.replace('http', 'ws')}/ws/panel?token=${token}`, {
        origin: base,
    });
    sockets.push(ws);
    const next = listen(ws);
    await once(ws, 'open');
    await next('connected');
    return { ws, next };
}

test('health is real Node / Vue and unknown routes are not placeholder successes', async () => {
    assert.equal((await request('/api/health')).body.runtime, 'node');
    assert.equal((await request('/api/auth/login', json('POST', {}))).status, 422);
    assert.equal((await request('/api/sync/credentials', json('POST', {}))).status, 404);
});
test('Host / Origin / remote-address guards and same-origin writes', async () => {
    assert.equal(isLoopback('192.0.2.1'), false);
    assert.equal(
        await new Promise((resolve) => {
            const req = httpRequest(
                base + '/api/devices',
                { headers: { Host: 'untrusted.test' } },
                (res) => {
                    res.resume();
                    resolve(res.statusCode);
                },
            );
            req.end();
        }),
        403,
    );
    assert.equal(
        (await request('/api/devices', { headers: { Origin: 'https://untrusted.test' } })).status,
        403,
    );
    assert.equal(
        (await request('/api/devices', { headers: { 'Sec-Fetch-Site': 'cross-site' } })).status,
        403,
    );
    assert.equal(
        (
            await request('/api/devices/1/note', {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: '{"note":"x"}',
            })
        ).status,
        403,
    );
});
test('trusted reverse proxy accepts only the configured HTTPS origin and proxy headers', () => {
    const proxyConfig = { origin: 'https://yk.jk92.cc', trustProxy: true };
    const request = (headers = {}, remoteAddress = '127.0.0.1') => ({
        socket: { remoteAddress },
        headers: {
            host: 'yk.jk92.cc',
            origin: 'https://yk.jk92.cc',
            'sec-fetch-site': 'same-origin',
            'x-real-ip': '192.0.2.10',
            'x-forwarded-for': '192.0.2.10',
            'x-forwarded-proto': 'https',
            ...headers,
        },
    });
    assert.equal(allowedRequest(request(), proxyConfig, true), true);
    assert.equal(allowedRequest(request({ host: 'yk.jk92.cc:80' }), proxyConfig, true), true);
    assert.equal(allowedRequest(request({ host: 'yk.jk92.cc:443' }), proxyConfig, true), true);
    assert.equal(
        allowedRequest(request({ 'x-forwarded-host': 'yk.jk92.cc:80' }), proxyConfig, true),
        true,
    );
    assert.equal(allowedRequest(request({ host: 'untrusted.test' }), proxyConfig), false);
    assert.equal(allowedRequest(request({ host: 'untrusted.test:80' }), proxyConfig), false);
    assert.equal(allowedRequest(request({ host: 'yk.jk92.cc:8081' }), proxyConfig), false);
    assert.equal(
        allowedRequest(request({ 'x-forwarded-host': 'untrusted.test:80' }), proxyConfig),
        false,
    );
    assert.equal(
        allowedRequest(request({ origin: 'https://untrusted.test' }), proxyConfig, true),
        false,
    );
    assert.equal(allowedRequest(request({ 'x-forwarded-proto': 'http' }), proxyConfig), false);
    assert.equal(allowedRequest(request({ 'x-forwarded-for': undefined }), proxyConfig), false);
    assert.equal(allowedRequest(request({}, '192.0.2.20'), proxyConfig), false);
});
test('list filters, pagination and total stats are independent', async () => {
    const r = await request('/api/devices?q=Fixture&source=sample&page=2');
    assert.equal(r.status, 200);
    assert.equal(r.body.data.length, 5);
    assert.equal(r.body.total, 15);
    assert.equal(r.body.stats.devices, 17);
    assert.equal(r.body.stats.online, 0);
    assert.equal(r.body.stats.periods[0].installed, null);
});
test('empty result and malformed filters', async () => {
    assert.equal((await request('/api/devices?q=missing')).body.total, 0);
    for (const q of [
        'sort=bad',
        'direction=DROP',
        'page=-1',
        'source=other',
        'a11y=yes',
        'q=' + 'a'.repeat(101),
    ])
        assert.equal((await request('/api/devices?' + q)).status, 422);
});
test('numeric sort, latest snapshot metrics, stable ties, null last', async () => {
    const numeric = (await request('/api/devices?sort=android&direction=asc')).body.data;
    assert.equal(numeric[0].id, 1);
    const metrics = (await request('/api/devices?sort=nodes&direction=desc')).body.data;
    assert.equal(metrics.find((d) => d.id === 1).node_count, 1);
    assert.equal(metrics[0].id, 200);
    const batteries = (await request('/api/devices?sort=battery&direction=desc')).body.data;
    assert.equal(batteries[0].battery, 14);
    const rows = (await request('/api/devices?sort=brand')).body.data;
    assert.deepEqual(
        rows.slice(2).map((r) => r.id),
        [1, 2, 3, 4, 5, 6, 7, 8],
    );
});
test('superadmin sees every project while snapshot association stays checked', async () => {
    assert.equal((await request('/api/devices/200')).status, 200);
    assert.equal((await request('/api/snapshots/3/export')).status, 200);
    assert.equal((await request('/api/snapshots/3/image')).status, 404);
    assert.equal((await request('/api/devices/2?snapshot=1')).status, 404);
    assert.equal((await request('/api/snapshots')).body.total, 3);
});
test('notes are validated and persisted with fixed project', async () => {
    assert.equal(
        (await request('/api/devices/1/note', json('PATCH', { note: 'Node test note' }))).status,
        200,
    );
    assert.equal((await app.store.device(1)).note, 'Node test note');
    assert.equal(
        (await request('/api/devices/1/note', json('PATCH', { note: 'x'.repeat(201) }))).status,
        422,
    );
    assert.equal(
        (await request('/api/devices/1/note', json('PATCH', { note: 'x', project_id: 2 }))).status,
        422,
    );
});
test('installation time is immutable registration time and daily totals use the Beijing cohort', async () => {
    const registeredAt = Date.now();
    await db('device_credentials').insert({
        device_id: 100,
        credential_id: 'CORE-INSTALL-TIME',
        registered_at: registeredAt,
    });
    const response = await request('/api/devices?q=DEVICE-100');
    assert.equal(response.status, 200);
    assert.equal(response.body.data[0].installed_at, registeredAt);
    assert.equal(response.body.stats.periods[0].installed, 1);
    assert.equal(response.body.stats.periods[0].offline, 1);
    assert.equal(response.body.stats.periods[0].accessibility, 0);
    await db('device_credentials').where('device_id', 100).delete();
});
test('device memos support scoped create, edit, list and delete without replacing remarks', async () => {
    const created = await request(
        '/api/devices/1/memos',
        json('POST', { body: '需要后续核对', label: 'follow_up' }),
    );
    assert.equal(created.status, 201);
    assert.equal(created.body.body, '需要后续核对');
    assert.equal(created.body.label, 'follow_up');
    assert.equal(created.body.author, 'mtx');
    const list = await request('/api/devices/1/memos');
    assert.equal(list.body.total, 1);
    assert.equal(list.body.data[0].id, created.body.id);
    const deviceList = await request('/api/devices?sort=memo&direction=desc');
    assert.equal(deviceList.body.data[0].id, 1);
    assert.equal(deviceList.body.data[0].memo_count, 1);
    const updated = await request(
        `/api/devices/1/memos/${created.body.id}`,
        json('PATCH', { body: '已经处理', label: 'handled' }),
    );
    assert.equal(updated.body.body, '已经处理');
    assert.equal(updated.body.label, 'handled');
    assert.equal(
        (
            await request(
                `/api/devices/2/memos/${created.body.id}`,
                json('PATCH', { body: '越设备', label: 'none' }),
            )
        ).status,
        404,
    );
    assert.equal(
        (await request('/api/devices/1/memos', json('POST', { body: '', label: 'none' }))).status,
        422,
    );
    assert.equal(
        (await request(`/api/devices/1/memos/${created.body.id}`, json('DELETE', {}))).status,
        200,
    );
    assert.equal((await request('/api/devices/1/memos')).body.total, 0);
    assert.equal((await app.store.device(1)).note, 'Node test note');
});
test('no upload or manual import routes were reintroduced', async () => {
    for (const url of [
        '/api/import',
        '/api/file/upload-from-device',
        '/api/v1/diagnostics/sessions',
    ])
        assert.equal((await request(url, json('POST', {}))).status, 404);
    assert.equal((await request('/import')).status, 404);
});
test('detail keeps uploaded node fields and exports the same body', async () => {
    const polluted = structuredClone(fixture);
    polluted.secret = 'secret body';
    polluted.windows[0].nodes[0].text = 'secret body';
    polluted.windows[0].nodes[0].flags.payload = 'secret body';
    await db('snapshots')
        .where('id', 1)
        .update({ payload: JSON.stringify(polluted) });
    const detail = await request('/api/devices/1?snapshot=1');
    assert.equal(detail.status, 200);
    assert.ok(JSON.stringify(detail.body).includes('secret body'));
    assert.equal(detail.body.snapshot.payload.windows[0].nodes[0].text_policy, 'uploaded');
    assert.equal(detail.body.snapshot.payload.windows[0].nodes[0].flags.payload, undefined);
    assert.ok(
        JSON.stringify((await request('/api/snapshots/1/export')).body).includes('secret body'),
    );
});
test('synthetic screenshot and file path containment', async () => {
    const response = await request('/api/snapshots/1/image');
    assert.equal(response.status, 200);
    assert.ok(response.headers.get('content-type').includes('svg'));
    await assert.rejects(() => privateFile(dir, 'screenshots/../../etc/passwd', 'screenshots/'));
    await assert.rejects(() => privateFile(dir, '/etc/passwd', 'screenshots/'));
    await writeFile(path.join(dir, 'bad.png'), 'not png');
    await assert.rejects(() => checkPng(path.join(dir, 'bad.png')));
    await mkdir(path.join(dir, 'screenshots'));
    await mkdir(path.join(dir, 'other'));
    await writeFile(path.join(dir, 'other', 'private.png'), 'private');
    await assert.rejects(() =>
        privateFile(dir, 'screenshots/../other/private.png', 'screenshots/'),
    );
    await symlink(
        path.join(dir, 'other', 'private.png'),
        path.join(dir, 'screenshots', 'link.png'),
    );
    await assert.rejects(() => privateFile(dir, 'screenshots/link.png', 'screenshots/'));
    const fake = Buffer.alloc(24);
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]).copy(fake);
    fake.write('IHDR', 12);
    fake.writeUInt32BE(1, 16);
    fake.writeUInt32BE(1, 20);
    await writeFile(path.join(dir, 'fake.png'), fake);
    await assert.rejects(() => checkPng(path.join(dir, 'fake.png')));
});
test('snapshot graph validation: duplicate ids, missing parents, cycles, bounds, limits', () => {
    for (const mutate of [
        (f) => f.windows.push(f.windows[0]),
        (f) => f.windows[0].nodes.push(f.windows[0].nodes[0]),
        (f) => (f.windows[0].nodes[0].parent_id = 'missing'),
        (f) => (f.windows[0].nodes[0].parent_id = 'n2'),
        (f) => (f.windows[0].nodes[0].bounds = [10, 10, 0, 0]),
        (f) => (f.windows[0].root_status = 'null_root'),
        (f) => (f.display.width = 10001),
    ]) {
        const f = structuredClone(fixture);
        mutate(f);
        assert.throws(() => normalizeSnapshot(f));
    }
    const f = structuredClone(fixture);
    f.windows[0].nodes = Array.from({ length: 34 }, (_, i) => ({
        id: `n${i}`,
        parent_id: i ? `n${i - 1}` : null,
        class_name: 'View',
        bounds: [0, 0, 1, 1],
    }));
    assert.throws(() => normalizeSnapshot(f));
});
test('observation bodies are excluded and scenario/channel consistency enforced', () => {
    const f = structuredClone(fixture);
    f.observations = [
        {
            scenario: 'sms_permission',
            case_id: 'test',
            channel: 'sms_permission',
            event_type: 'manual_probe',
            fixture: 'synthetic',
            password_flag: null,
            sensitive_flag: true,
            text_returned: true,
            synthetic_match: 'match',
            body: 'private',
        },
    ];
    assert.ok(!JSON.stringify(normalizeSnapshot(f)).includes('private'));
    f.observations[0].channel = 'accessibility_node';
    assert.throws(() => normalizeSnapshot(f));
});
test('labels are fixed and exclude editable/password fields', () => {
    const payload = normalizeSnapshot(fixture);
    const labels = labelsFor({ source: 'sample', payload });
    assert.ok(Object.values(labels).includes('Research test page'));
    assert.deepEqual(labelsFor({ source: 'api', payload }), {});
});
test('translation encryption, secret-free responses, fixed provider input and cache', async () => {
    let calls = 0;
    const translator = new Translation(db, settings, randomBytes(32), async (url, options) => {
        calls++;
        assert.equal(url, 'https://translation.googleapis.com/language/translate/v2');
        assert.equal(options.headers['X-Goog-Api-Key'], 'test-secret');
        assert.deepEqual(JSON.parse(options.body).q, ['Synthetic fixture']);
        return new Response(
            JSON.stringify({ data: { translations: [{ translatedText: '合成 &amp; 样例' }] } }),
        );
    });
    const state = await translator.save({
        enabled: true,
        language: 'zh-CN',
        apiKey: 'test-secret',
    });
    assert.equal(state.hasKey, true);
    assert.ok(!JSON.stringify(state).includes('test-secret'));
    assert.ok(!(await db('node_settings').first()).translation.includes('test-secret'));
    assert.deepEqual(await translator.translate({ test: 'Synthetic fixture' }), {
        test: '合成 & 样例',
    });
    await translator.translate({ test: 'Synthetic fixture' });
    assert.equal(calls, 1);
    await translator.translate({ test: 'Synthetic fixture' }, true);
    assert.equal(calls, 2);
    assert.ok((await translator.publicState()).verifiedAt);
    await translator.clear();
});
test('translation errors do not leak provider bodies, no key gives real error', async () => {
    assert.equal((await request('/api/settings/translation/verify', json('POST', {}))).status, 422);
    const translator = new Translation(
        db,
        settings,
        randomBytes(32),
        async () => new Response('secret provider error', { status: 403 }),
    );
    await translator.save({ enabled: true, language: 'en', apiKey: 'another-secret' });
    await assert.rejects(
        () => translator.translate({ test: 'Synthetic fixture' }),
        (e) => e.status === 502 && !e.message.includes('secret'),
    );
    await translator.clear();
});
test('WS origin and role authentication reject wrong credentials', async () => {
    for (const [token, origin] of [
        ['invalid', base],
        [await app.auth.issue('panel', 'local-panel', '-1s'), base],
        [await app.auth.issue('device', 'DEVICE-100'), base],
        [await app.auth.issue('panel'), 'https://untrusted.test'],
    ]) {
        const ws = new WebSocket(`${base.replace('http', 'ws')}/ws/panel?token=${token}`, {
            origin,
        });
        sockets.push(ws);
        const [error] = await once(ws, 'error');
        assert.match(error.message, /Unexpected server response/);
    }
});
test('WS ping, bot_list, read-only subscribe, unsubscribe, command whitelist', async () => {
    const { ws, next } = await panel();
    ws.send(JSON.stringify({ type: 'ping' }));
    assert.equal((await next('pong')).type, 'pong');
    ws.send(JSON.stringify({ type: 'get_bot_list' }));
    assert.deepEqual((await next('bot_list')).data, []);
    ws.send(JSON.stringify({ type: 'subscribe', sessionId: 'TEST-001' }));
    assert.equal((await next('subscribed')).data.readOnly, true);
    assert.equal((await next('get_device_state_response')).cached, true);
    ws.send(
        JSON.stringify({
            type: 'command',
            sessionId: 'TEST-001',
            data: { command: 'GET_DEVICE_STATE', params: {} },
        }),
    );
    assert.equal((await next('get_device_state_response')).data.id, 'TEST-001');
    ws.send(
        JSON.stringify({
            type: 'command',
            sessionId: 'TEST-001',
            data: { command: 'UNSUPPORTED_OPERATION', params: { secret: 'body' } },
        }),
    );
    assert.equal((await next('error')).code, 'invalid_message');
    ws.send(JSON.stringify({ type: 'subscribe', sessionId: 'OTHER-200' }));
    await next('subscribed');
    assert.equal((await next('get_device_state_response')).data.id, 'OTHER-200');
    ws.send(JSON.stringify({ type: 'subscribe', sessionId: 'MISSING-DEVICE' }));
    assert.equal((await next('error')).code, 'not_found');
    ws.send(Buffer.from('binary'));
    assert.equal((await next('error')).code, 'unsupported_binary');
    ws.send('{');
    assert.equal((await next('error')).code, 'invalid_message');
    ws.send(JSON.stringify({ type: 'unsubscribe', sessionId: 'TEST-001' }));
    await next('unsubscribed');
    ws.close();
});
test('authenticated device status is normalized, broadcasts online/offline and blocks impersonation', async () => {
    const p = await panel();
    const token = await app.auth.issue('device', 'DEVICE-100');
    const ws = new WebSocket(`${base.replace('http', 'ws')}/ws/device`, {
        headers: { Authorization: `Bearer ${token}` },
    });
    sockets.push(ws);
    const next = listen(ws);
    await once(ws, 'open');
    ws.send(
        JSON.stringify({
            type: 'status',
            sessionId: 'OTHER-200',
            data: { type: 'device_heartbeat' },
        }),
    );
    assert.equal((await next('error')).code, 'invalid_message');
    ws.send(
        JSON.stringify({
            type: 'status',
            sessionId: 'DEVICE-100',
            data: {
                type: 'device_heartbeat',
                batteryLevel: 75,
                accessibilityAlive: true,
                password: 'secret-to-strip',
            },
            timestamp: 9999999999999,
        }),
    );
    await next('status_ack');
    const online = await p.next('device_online');
    assert.equal(online.data.status, 'online');
    assert.equal(online.data.batteryLevel, 75);
    assert.equal((await request('/api/devices?status=online')).body.total, 1);
    ws.send(
        JSON.stringify({
            type: 'status',
            data: { type: 'screen_lock_status', isLocked: true, isScreenOn: false },
        }),
    );
    await next('status_ack');
    const updated = await p.next('device_status_update');
    assert.equal(updated.data.isLocked, true);
    assert.equal(updated.data.isScreenOn, false);
    ws.close();
    await p.next('device_offline');
    assert.equal((await request('/api/devices?status=online')).body.total, 0);
    assert.ok(!JSON.stringify(await db('protocol_logs')).includes('secret-to-strip'));
    p.ws.close();
});
test('superadmin audit spans projects and still excludes payload columns', async () => {
    await db('protocol_logs').insert({
        project_id: 2,
        ts: Date.now(),
        type: 'foreign',
        channel: 'http',
        dir: 'up',
        size: 1,
    });
    const logs = (await request('/api/logs/protocol')).body;
    assert.equal(logs.payloadPolicy, 'metadata-only');
    assert.ok(logs.data.length > 0);
    assert.ok(logs.data.every((l) => !Object.hasOwn(l, 'payload')));
    assert.equal((await request('/api/logs/protocol?channel=bad')).status, 422);
});
test('settings and build history report the local queue truthfully', async () => {
    assert.equal((await request('/api/builds')).body.worker.status, 'idle');
    assert.equal((await request('/api/builds/bad/artifact')).status, 422);
    assert.equal((await request('/api/settings/translation')).body.hasKey, false);
    assert.ok(!JSON.stringify((await request('/.env')).body).includes('APP_KEY'));
});
test('screenshots use Node private files with authentication and path containment', async () => {
    const folder = path.join(settings.privateDir, 'files/screenshots');
    await mkdir(folder, { recursive: true });
    await sharp({ create: { width: 2, height: 2, channels: 3, background: '#ffffff' } })
        .png()
        .toFile(path.join(folder, 'fixture.png'));
    await db('snapshots').insert({
        id: 99,
        project_id: 1,
        device_id: 1,
        source: 'import',
        payload: JSON.stringify(fixture),
        screenshot_path: 'screenshots/fixture.png',
    });
    const image = await fetch(base + '/api/snapshots/99/image', {
        headers: { Authorization: `Bearer ${accessToken}` },
    });
    assert.equal(image.status, 200);
    assert.match(image.headers.get('content-type'), /image\/png/);
    assert.equal((await sharp(Buffer.from(await image.arrayBuffer())).metadata()).width, 2);
    assert.equal((await fetch(base + '/api/snapshots/99/image')).status, 401);
    for (const url of [
        '/.node-private/files/screenshots/fixture.png',
        '/storage/fixture.png',
        '/index.php',
        '/legacy-assets/lab.js',
    ])
        assert.equal((await request(url)).status, 404);
    await db('snapshots').where('id', 99).update({ screenshot_path: 'screenshots/../master.key' });
    assert.equal((await request('/api/snapshots/99/image')).status, 404);
});
test('unguessable artifact URLs are shareable while files stay private and missing files stay unavailable', async () => {
    const id = '00000000-0000-4000-8000-000000000099';
    const folder = path.join(settings.privateDir, 'files/apk-builds', id);
    await mkdir(folder, { recursive: true });
    // Route fixture only, never reported as an actual APK build.
    const data = 'synthetic download fixture';
    await writeFile(path.join(folder, 'browser.apk'), data);
    await db('apk_builds').insert({
        id,
        project_id: 2,
        app_name: 'Download fixture',
        status: 'succeeded',
        artifact_path: `apk-builds/${id}/browser.apk`,
    });
    assert.equal(
        (await request('/api/builds')).body.data.find((b) => b.id === id).artifactAvailable,
        true,
    );
    const shared = await fetch(`${base}/api/builds/${id}/artifact`, {
        headers: { Origin: 'https://share.example', 'Sec-Fetch-Site': 'cross-site' },
    });
    assert.equal(shared.status, 200);
    assert.equal(await shared.text(), data);
    assert.equal(
        (
            await fetch(`${base}/api/builds/${id}/log`, {
                headers: { Origin: 'https://share.example', 'Sec-Fetch-Site': 'cross-site' },
            })
        ).status,
        403,
    );
    const download = await request(`/api/builds/${id}/artifact`);
    assert.equal(download.status, 200);
    assert.equal(download.body, data);
    await rm(path.join(folder, 'browser.apk'));
    assert.equal((await request(`/api/builds/${id}/artifact`)).status, 404);
    assert.equal(
        (await request('/api/builds')).body.data.find((b) => b.id === id).artifactAvailable,
        false,
    );
});
