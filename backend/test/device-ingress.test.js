import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { once } from 'node:events';
import { WebSocket } from 'ws';
import sharp from 'sharp';
import { config } from '../src/config.js';
import { openDatabase } from '../src/database.js';
import { createApplication } from '../src/app.js';
import { Store } from '../src/store.js';
import { DeviceManagement } from '../src/device-management.js';

let dir,
    db,
    app,
    settings,
    base,
    account,
    owner,
    jpeg,
    count = 0;
async function call(url, token = account, body, method = 'POST') {
    const response = await fetch(base + url, {
        method,
        headers: {
            Authorization: `Bearer ${token}`,
            'X-Boundary-Request': '1',
            'Content-Type': 'application/json',
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    return { status: response.status, body: await response.json() };
}
async function enrollment(apkId = 'TESTAPK') {
    const r = await call('/api/device-enrollments', account, { apkId });
    assert.equal(r.status, 201);
    return r.body;
}
async function register(extra = {}) {
    const ticket = await enrollment();
    const profile = {
        deviceId: `INGRESS_${++count}`,
        apkId: 'TESTAPK',
        brand: 'Synthetic',
        model: 'Fixture',
        ...extra,
    };
    const result = await call('/api/client/register', ticket.enrollmentToken, profile);
    assert.equal(result.status, 201, JSON.stringify(result.body));
    return { ...result.body, ticket, profile };
}
async function grant(device, input = { consent: true }) {
    const r = await call('/api/device/screenshot-session', device.deviceToken, {
        deviceId: device.deviceId,
        ...input,
    });
    assert.equal(r.status, 201);
    return r.body;
}
function listen(ws) {
    const queue = [],
        waiters = [];
    ws.on('message', (raw) => {
        const value = JSON.parse(raw.toString());
        const index = waiters.findIndex((waiter) => waiter.type === value.type);
        if (index >= 0) waiters.splice(index, 1)[0].resolve(value);
        else queue.push(value);
    });
    return (type) => {
        const index = queue.findIndex((value) => value.type === type);
        if (index >= 0) return Promise.resolve(queue.splice(index, 1)[0]);
        return new Promise((resolve, reject) => {
            const waiter = { type, resolve };
            waiters.push(waiter);
            setTimeout(() => {
                const position = waiters.indexOf(waiter);
                if (position >= 0) waiters.splice(position, 1);
                reject(new Error(`Timed out: ${type}`));
            }, 2000).unref();
        });
    };
}
async function upload(
    device,
    ticket,
    { bytes = jpeg, fields = {}, mime = 'image/jpeg', token = device.deviceToken } = {},
) {
    const data = new FormData();
    const body = {
        deviceId: device.deviceId,
        apkId: device.apkId,
        batch: '',
        buildId: 'fixture',
        ts: String(Date.now()),
        ...fields,
    };
    for (const [k, v] of Object.entries(body)) data.append(k, v);
    data.append('file', new Blob([bytes], { type: mime }), '../../ignored.jpg');
    const r = await fetch(base + '/api/device/screenshot', {
        method: 'POST',
        headers: {
            Authorization: `Bearer ${token}`,
            'X-Boundary-Request': '1',
            'X-Capture-Upload': ticket.uploadId,
        },
        body: data,
    });
    return { status: r.status, body: await r.json() };
}
before(async () => {
    dir = await mkdtemp(path.join(tmpdir(), 'boundary-ingress-'));
    settings = config({
        privateDir: path.join(dir, '.node-private'),
        database: path.join(dir, 'test.sqlite'),
        port: 0,
    });
    db = await openDatabase(settings.database);
    app = await createApplication(settings, { db, serveFrontend: false, bootstrapDefault: true });
    await new Promise((r) => app.server.listen(0, '127.0.0.1', r));
    base = settings.origin = `http://127.0.0.1:${app.server.address().port}`;
    const login = await call('/api/auth/login', '', { username: 'mtx', password: 'mtx123' });
    account = login.body.token;
    owner = login.body.user;
    // Legacy aliases remain valid for existing APKs, but are not created through the UI/API.
    await db('apk_routes').insert({
        apk_id: 'TESTAPK',
        project_id: 1,
        owner_account_id: owner.id,
        enabled: true,
        created_at: Date.now(),
    });
    jpeg = await sharp({ create: { width: 32, height: 48, channels: 3, background: '#3388aa' } })
        .jpeg()
        .toBuffer();
});
after(async () => {
    await app?.close();
    await db?.destroy();
    await rm(dir, { recursive: true, force: true });
});

test('APK routes are read-only; enrollment requires an existing route', async () => {
    assert.equal((await call('/api/apk-routes', 'bad', { apkId: 'X' })).status, 401);
    assert.equal(
        (await call('/api/apk-routes', account, { apkId: 'X', ownerAccountId: 99999 })).status,
        404,
    );
    assert.equal((await call('/api/apk-routes', account, { apkId: 'TESTAPK' })).status, 404);
    assert.equal(
        (await call('/api/device-enrollments', account, { apkId: 'missing' })).status,
        404,
    );
    const routes = await call('/api/apk-routes', account, undefined, 'GET');
    assert.equal(routes.body.data[0].username, 'mtx');
});
test('B package comes online by APK ID, is assigned to its account and renews the same device silently', async () => {
    const profile = {
        deviceId: 'AUTO_ONLINE_1',
        apkId: 'TESTAPK',
        brand: 'Synthetic',
        model: 'Auto fixture',
        osVersion: '11',
        appVersion: '1.3.0',
        packageName: 'org.boundary.auto.fixture',
    };
    const first = await call('/api/client/online', '', profile);
    assert.equal(first.status, 201, JSON.stringify(first.body));
    assert.equal(first.body.apkId, 'TESTAPK');
    assert.equal(first.body.owner.id, owner.id);
    assert.equal(first.body.heartbeatSeconds, 20);
    const firstCredential = await db('device_credentials')
        .where('device_id', first.body.localId)
        .first();
    const retry = await call('/api/client/online', '', profile);
    assert.equal(retry.status, 201, JSON.stringify(retry.body));
    assert.equal(retry.body.localId, first.body.localId);
    assert.equal((await db('devices').where('public_id', profile.deviceId)).length, 1);
    assert.equal(
        (await db('devices').where('id', first.body.localId).first()).owner_account_id,
        owner.id,
    );
    assert.equal((await db('device_credentials').where('device_id', first.body.localId)).length, 1);
    const renewedCredential = await db('device_credentials')
        .where('device_id', first.body.localId)
        .first();
    assert.equal(renewedCredential.registered_at, firstCredential.registered_at);
    const savedProfile = await db('devices').where('id', first.body.localId).first();
    assert.equal(savedProfile.app_name, '');
    assert.equal(savedProfile.app_version, '1.3.0');
    assert.equal(savedProfile.package_name, 'org.boundary.auto.fixture');
    const listed = await call(`/api/devices?q=${profile.deviceId}`, account, undefined, 'GET');
    assert.equal(listed.body.data[0].owner_username, 'mtx');
    assert.equal(listed.body.data[0].installed_at, firstCredential.registered_at);
    assert.equal(listed.body.data[0].app_version, '1.3.0');
    assert.ok(listed.body.stats.periods[0].installed >= 1);
    assert.equal(
        (
            await call('/api/sync/status', retry.body.deviceToken, {
                deviceId: profile.deviceId,
                apkId: profile.apkId,
                accessibilityAlive: true,
            })
        ).status,
        200,
    );
    let requestLogs = [];
    for (let attempt = 0; attempt < 20; attempt++) {
        requestLogs = await db('protocol_logs')
            .where({ channel: 'client', device_id: profile.deviceId })
            .orderBy('id');
        if (requestLogs.length >= 3) break;
        await new Promise((resolve) => setTimeout(resolve, 10));
    }
    assert.ok(requestLogs.length >= 3);
    assert.ok(
        requestLogs.some(
            (row) =>
                row.request_method === 'POST' &&
                row.request_path === '/api/client/online' &&
                row.response_status === 201,
        ),
    );
    assert.ok(
        requestLogs.some(
            (row) => row.request_path === '/api/sync/status' && row.response_status === 200,
        ),
    );
    assert.ok(requestLogs.every((row) => Number.isInteger(row.duration_ms)));
    const visible = await call('/api/logs/protocol?scope=client', account, undefined, 'GET');
    assert.equal(visible.status, 200);
    assert.ok(visible.body.data.every((row) => ['client', 'device'].includes(row.channel)));
    assert.ok(!JSON.stringify(visible.body).includes(retry.body.deviceToken));
});
test('automatic online rejects unknown routes, changed ownership, revoked devices and deleted devices', async () => {
    const profile = { deviceId: 'AUTO_ONLINE_GUARDS', apkId: 'TESTAPK' };
    assert.equal(
        (await call('/api/client/online', '', { ...profile, apkId: 'MISSING' })).status,
        404,
    );
    const first = await call('/api/client/online', '', profile);
    assert.equal(first.status, 201);
    await db('device_credentials').where('device_id', first.body.localId).update({ revoked: true });
    assert.equal((await call('/api/client/online', '', profile)).status, 403);
    await db('device_credentials')
        .where('device_id', first.body.localId)
        .update({ revoked: false });
    await db('devices')
        .where('id', first.body.localId)
        .update({ apk_id: '1', owner_account_id: owner.id });
    assert.equal((await call('/api/client/online', '', profile)).status, 409);
    await db('devices').where('id', first.body.localId).update({ apk_id: 'TESTAPK' });
    assert.equal(
        (await call(`/api/devices/${first.body.localId}`, account, {}, 'DELETE')).status,
        200,
    );
    assert.equal((await call('/api/client/online', '', profile)).status, 403);
});
test('first registration derives ownership only from enrollment, is retryable and never enrolls another device with the same ticket', async () => {
    const d = await register({ ownerAccountId: 999, projectId: 99 });
    assert.equal(d.owner.id, owner.id);
    const row = await db('devices').where('id', d.localId).first();
    assert.equal(row.project_id, 1);
    assert.equal(row.owner_account_id, owner.id);
    const retry = await call('/api/client/register', d.ticket.enrollmentToken, d.profile);
    assert.equal(retry.status, 201);
    assert.equal(retry.body.deviceToken, d.deviceToken);
    assert.equal(
        (
            await call('/api/client/register', d.ticket.enrollmentToken, {
                ...d.profile,
                deviceId: 'DIFFERENT',
            })
        ).status,
        409,
    );
    const another = await enrollment();
    assert.equal(
        (await call('/api/client/register', another.enrollmentToken, d.profile)).status,
        409,
    );
    const own = await call(`/api/devices/${d.localId}/ownership`, account, undefined, 'GET');
    assert.equal(own.body.owner.username, 'mtx');
});
test('concurrent first registration cannot redeem one enrollment twice', async () => {
    const ticket = await enrollment();
    const responses = await Promise.all(
        ['RACE_A', 'RACE_B'].map((deviceId) =>
            call('/api/client/register', ticket.enrollmentToken, { deviceId, apkId: 'TESTAPK' }),
        ),
    );
    assert.deepEqual(responses.map((r) => r.status).sort(), [201, 409]);
});
test('expired or mismatched enrollments, account/device token confusion and forged device identities are rejected', async () => {
    const ticket = await enrollment();
    const p = { deviceId: 'INVALID_TICKET', apkId: 'OTHER' };
    assert.equal((await call('/api/client/register', ticket.enrollmentToken, p)).status, 401);
    await db('device_enrollments').where('id', ticket.enrollmentId).update({ expires_at: 0 });
    assert.equal(
        (await call('/api/client/register', ticket.enrollmentToken, { ...p, apkId: 'TESTAPK' }))
            .status,
        401,
    );
    assert.equal((await call('/api/client/register', account, p)).status, 401);
    const d = await register();
    assert.equal((await call('/api/sync/status', account, { deviceId: d.deviceId })).status, 401);
    assert.equal(
        (await call('/api/sync/status', d.deviceToken, { deviceId: 'SPOOFED' })).status,
        403,
    );
    assert.equal((await call('/api/apk-routes', d.deviceToken, { apkId: 'X' })).status, 401);
});
test('ScreenAgent HTTP/WS heartbeat aliases work after bearer authentication without altering ownership', async () => {
    const d = await register();
    assert.equal(
        (
            await call('/api/sync/status', d.deviceToken, {
                deviceId: d.deviceId,
                apkId: d.apkId,
                ownerAccountId: 999,
                batteryLevel: 75,
            })
        ).status,
        200,
    );
    assert.equal((await app.store.device(d.localId)).status, 'online');
    const socket = new WebSocket(base.replace('http', 'ws') + '/ws/device', {
        headers: { Authorization: `Bearer ${d.deviceToken}` },
    });
    await once(socket, 'open');
    const response = once(socket, 'message');
    socket.send(
        JSON.stringify({ type: 'device_ping', sessionId: d.deviceId, apkId: d.apkId, data: {} }),
    );
    assert.equal(JSON.parse(String((await response)[0])).type, 'status_ack');
    socket.close();
    await once(socket, 'close');
    assert.equal((await db('devices').where('id', d.localId).first()).owner_account_id, owner.id);
});
test('single JPEG upload is decoded, acknowledged after receipt, viewable with login, and never creates historical snapshots', async () => {
    const d = await register(),
        ticket = await grant(d);
    const result = await upload(d, ticket);
    assert.equal(result.status, 201, JSON.stringify(result.body));
    assert.equal(result.body.width, 32);
    assert.equal(result.body.height, 48);
    assert.equal((await upload(d, ticket)).status, 410);
    const response = await fetch(base + result.body.imageUrl, {
        headers: { Authorization: `Bearer ${account}` },
    });
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('cache-control'), 'no-store');
    assert.equal(
        (await sharp(Buffer.from(await response.arrayBuffer())).metadata()).format,
        'jpeg',
    );
    assert.equal((await fetch(base + result.body.imageUrl)).status, 401);
    assert.equal((await db('snapshots').count('* as n').first()).n, 0);
    assert.equal(
        (await call(`/api/devices/${d.localId}/screenshot`, account, undefined, 'GET')).body.frame
            .frameId,
        result.body.frameId,
    );
    const replacement = await upload(d, await grant(d));
    assert.equal(replacement.status, 201);
    assert.equal(
        (
            await fetch(base + result.body.imageUrl, {
                headers: { Authorization: `Bearer ${account}` },
            })
        ).status,
        410,
    );
});
test('accessibility first thumbnail and leased panel screenshot use the same bounded upload path', async () => {
    const d = await register();
    assert.equal(
        (
            await call('/api/sync/status', d.deviceToken, {
                deviceId: d.deviceId,
                accessibilityAlive: true,
            })
        ).status,
        200,
    );
    const initial = await grant(d, { reason: 'initial_accessibility' });
    const first = await upload(d, initial);
    assert.equal(first.status, 201);
    assert.equal(first.body.reason, 'initial_accessibility');
    const list = await call(`/api/devices?q=${d.deviceId}`, account, undefined, 'GET');
    assert.equal(
        list.body.data.find((row) => row.id === d.localId).thumbnail.frameId,
        first.body.frameId,
    );
    assert.equal(
        (
            await call('/api/device/screenshot-session', d.deviceToken, {
                deviceId: d.deviceId,
                reason: 'initial_accessibility',
            })
        ).status,
        429,
    );

    const ticket = await call('/api/session', account, undefined, 'GET');
    const panel = new WebSocket(
        `${base.replace('http', 'ws')}/ws/panel?token=${ticket.body.token}`,
        { origin: base },
    );
    const device = new WebSocket(base.replace('http', 'ws') + '/ws/device', {
        headers: { Authorization: `Bearer ${d.deviceToken}` },
    });
    const panelNext = listen(panel),
        deviceNext = listen(device);
    await Promise.all([once(panel, 'open'), once(device, 'open')]);
    await panelNext('connected');
    panel.send(JSON.stringify({ type: 'subscribe', sessionId: d.deviceId }));
    await panelNext('subscribed');
    await panelNext('get_device_state_response');
    const viewerId = '00000000-0000-4000-8000-000000000111';
    const commandId = '00000000-0000-4000-8000-000000000222';
    panel.send(
        JSON.stringify({
            type: 'capture_viewer_heartbeat',
            sessionId: d.deviceId,
            data: { viewerId },
        }),
    );
    assert.equal((await panelNext('capture_viewer_lease')).data.deviceOnline, true);
    assert.equal((await deviceNext('command')).data.command, 'SCREENSHOT_VIEWER_LEASE');
    device.send(
        JSON.stringify({
            protocol: 'boundary-node-v2',
            type: 'accessibility_snapshot',
            sessionId: d.deviceId,
            apkId: d.apkId,
            timestamp: Date.now(),
            data: {
                viewerId,
                payload: {
                    schema_version: 1,
                    captured_at: new Date().toISOString(),
                    display: { width: 360, height: 800 },
                    windows: [
                        {
                            id: 'active',
                            type: 'application',
                            package: 'dev.boundary.fixture',
                            active: true,
                            focused: true,
                            root_status: 'available',
                            nodes: [
                                {
                                    id: 'n0',
                                    parent_id: null,
                                    class_name: 'android.widget.TextView',
                                    view_id: 'dev.boundary.fixture:id/title',
                                    bounds: [12, 24, 240, 72],
                                    flags: { visible: true, enabled: true },
                                    text_present: true,
                                    text: 'THIS_VALUE_MUST_BE_STRIPPED',
                                },
                            ],
                        },
                    ],
                    observations: [],
                    diagnostics: { elapsed_ms: 4, truncated: false },
                },
            },
        }),
    );
    const nodeReady = await panelNext('accessibility_snapshot_ready');
    assert.equal(nodeReady.data.nodeCount, 1);
    assert.equal(nodeReady.data.viewerId, viewerId);
    const nodeAck = await deviceNext('accessibility_snapshot_ack');
    assert.equal(nodeAck.data.snapshotId, nodeReady.data.snapshotId);
    const nodeView = await call(
        `/api/devices/${d.localId}/accessibility-snapshot?viewerId=${viewerId}`,
        account,
        undefined,
        'GET',
    );
    assert.equal(nodeView.status, 200);
    assert.equal(nodeView.body.textPolicy, 'omitted');
    assert.equal(nodeView.body.snapshot.source, 'live');
    assert.equal(nodeView.body.snapshot.labels['active:n0'], '文本区域');
    assert.equal(nodeView.body.snapshot.payload.windows[0].nodes[0].text, undefined);
    assert.equal(nodeView.body.snapshot.payload.windows[0].nodes[0].text_policy, 'omitted');
    panel.send(
        JSON.stringify({
            type: 'command',
            sessionId: d.deviceId,
            data: { command: 'SCREENSHOT_NOW', commandId, params: { viewerId } },
        }),
    );
    assert.equal((await deviceNext('command')).data.command, 'SCREENSHOT_NOW');
    assert.equal((await panelNext('command_dispatched')).data.commandId, commandId);
    device.send(
        JSON.stringify({
            protocol: 'boundary-screenshot-v2',
            type: 'command_ack',
            sessionId: d.deviceId,
            data: { command: 'SCREENSHOT_NOW', commandId, result: 'accepted' },
        }),
    );
    assert.equal((await panelNext('command_ack')).data.result, 'accepted');
    const actionCommandId = '00000000-0000-4000-8000-000000000333';
    panel.send(
        JSON.stringify({
            type: 'command',
            sessionId: d.deviceId,
            data: {
                command: 'DEVICE_ACTION',
                commandId: actionCommandId,
                params: { viewerId, action: 'DND_TOGGLE' },
            },
        }),
    );
    const action = await deviceNext('command');
    assert.equal(action.data.command, 'DEVICE_ACTION');
    assert.deepEqual(action.data.params, { viewerId, action: 'DND_TOGGLE' });
    assert.equal((await panelNext('command_dispatched')).data.action, 'DND_TOGGLE');
    device.send(
        JSON.stringify({
            protocol: 'boundary-screenshot-v2',
            type: 'command_ack',
            sessionId: d.deviceId,
            data: {
                command: 'DEVICE_ACTION',
                commandId: actionCommandId,
                action: 'DND_TOGGLE',
                result: 'accepted',
                reasonCode: 'dnd_enabled',
            },
        }),
    );
    assert.equal((await panelNext('command_ack')).data.reasonCode, 'dnd_enabled');
    const textCommandId = '00000000-0000-4000-8000-000000000444';
    panel.send(
        JSON.stringify({
            type: 'command',
            sessionId: d.deviceId,
            data: {
                command: 'TEXT_INPUT',
                commandId: textCommandId,
                params: { viewerId, text: '合成输入 123' },
            },
        }),
    );
    const textCommand = await deviceNext('command');
    assert.equal(textCommand.data.command, 'TEXT_INPUT');
    assert.deepEqual(textCommand.data.params, { viewerId, text: '合成输入 123' });
    const textDispatched = await panelNext('command_dispatched');
    assert.equal(textDispatched.data.command, 'TEXT_INPUT');
    assert.equal(textDispatched.data.commandId, textCommandId);
    assert.equal(Object.hasOwn(textDispatched.data, 'text'), false);
    device.send(
        JSON.stringify({
            protocol: 'boundary-screenshot-v2',
            type: 'command_ack',
            sessionId: d.deviceId,
            data: {
                command: 'TEXT_INPUT',
                commandId: textCommandId,
                result: 'accepted',
                reasonCode: 'text_set',
            },
        }),
    );
    assert.equal((await panelNext('command_ack')).data.reasonCode, 'text_set');
    panel.send(
        JSON.stringify({
            type: 'command',
            sessionId: d.deviceId,
            data: {
                command: 'DEVICE_ACTION',
                commandId: '00000000-0000-4000-8000-000000000555',
                params: { viewerId, action: 'TEXT_INPUT' },
            },
        }),
    );
    assert.equal((await panelNext('error')).code, 'invalid_message');
    const requested = await grant(d, { reason: 'viewer_request', commandId, viewerId });
    const ready = panelNext('screenshot_ready');
    const second = await upload(d, requested);
    assert.equal(second.status, 201);
    assert.equal(second.body.reason, 'viewer_request');
    assert.equal(second.body.commandId, commandId);
    assert.equal((await ready).data.frameId, second.body.frameId);

    panel.send(
        JSON.stringify({
            type: 'capture_viewer_heartbeat',
            sessionId: d.deviceId,
            data: { viewerId },
        }),
    );
    assert.equal((await panelNext('capture_viewer_lease')).data.deviceOnline, true);
    assert.equal((await deviceNext('command')).data.command, 'SCREENSHOT_VIEWER_LEASE');
    const nextRequested = await grant(d, { reason: 'viewer_request', commandId, viewerId });
    const nextReady = panelNext('screenshot_ready');
    const third = await upload(d, nextRequested);
    assert.equal(third.status, 201);
    assert.equal(third.body.commandId, commandId);
    assert.notEqual(third.body.frameId, second.body.frameId);
    assert.equal((await nextReady).data.frameId, third.body.frameId);

    panel.send(
        JSON.stringify({
            type: 'capture_viewer_close',
            sessionId: d.deviceId,
            data: { viewerId },
        }),
    );
    assert.equal((await panelNext('capture_viewer_closed')).data.viewerId, viewerId);
    assert.equal((await deviceNext('command')).data.command, 'SCREENSHOT_VIEWER_CLOSE');
    assert.equal(
        (
            await call(
                `/api/devices/${d.localId}/accessibility-snapshot?viewerId=${viewerId}`,
                account,
                undefined,
                'GET',
            )
        ).body.snapshot,
        null,
    );
    assert.equal(
        (
            await call('/api/device/screenshot-session', d.deviceToken, {
                deviceId: d.deviceId,
                reason: 'viewer_request',
                commandId,
                viewerId,
            })
        ).status,
        410,
    );
    panel.close();
    device.close();
    await Promise.all([once(panel, 'close'), once(device, 'close')]);
});
test('invalid images, extra fields, oversize files and cross-device upload grants fail without publishing', async () => {
    const a = await register(),
        b = await register(),
        ticket = await grant(a);
    assert.equal((await upload(b, ticket)).status, 410);
    assert.equal((await upload(a, ticket, { fields: { deviceId: b.deviceId } })).status, 403);
    assert.equal((await upload(a, ticket, { bytes: Buffer.from('fake jpeg') })).status, 422);
    assert.equal((await upload(a, ticket, { mime: 'image/png' })).status, 415);
    assert.equal((await upload(a, ticket, { fields: { ownerAccountId: '99' } })).status, 422);
    assert.equal(
        (await upload(a, ticket, { bytes: Buffer.alloc(2 * 1024 * 1024 + 1) })).status,
        413,
    );
    const huge = await sharp({
        create: { width: 2100, height: 2100, channels: 3, background: 'white' },
    })
        .jpeg()
        .toBuffer();
    assert.equal((await upload(a, ticket, { bytes: huge })).status, 422);
    assert.equal(
        (await call(`/api/devices/${a.localId}/screenshot`, account, undefined, 'GET')).body.frame,
        null,
    );
});
test('expired, superseded and revoked upload grants stop collection; cache expires and audits exclude bodies/tokens', async () => {
    const d = await register(),
        old = await grant(d),
        current = await grant(d);
    assert.equal((await upload(d, old)).status, 410);
    app.ingress.grants.get(d.localId).expiresAt = 0;
    assert.equal((await upload(d, current)).status, 410);
    const success = await upload(d, await grant(d));
    assert.equal(success.status, 201);
    app.ingress.frames.get(d.localId).expiresAt = 0;
    assert.equal(
        (await call(`/api/devices/${d.localId}/screenshot`, account, undefined, 'GET')).body.frame,
        null,
    );
    const ticket = await grant(d);
    assert.equal((await call(`/api/devices/${d.localId}/revoke`, account, {})).status, 200);
    assert.equal((await upload(d, ticket)).status, 401);
    assert.equal(
        (await call('/api/sync/status', d.deviceToken, { deviceId: d.deviceId })).status,
        401,
    );
    const logs = JSON.stringify(await db('protocol_logs'));
    assert.equal(logs.includes(d.deviceToken), false);
    assert.equal(logs.includes('image/jpeg'), false);
});

test('blacklist disconnects the device, clears its frame and upload grant, denies registration/status, and can be undone', async () => {
    const d = await register();
    const frame = await upload(d, await grant(d));
    const pending = await grant(d);
    const ws = new WebSocket(base.replace('http', 'ws') + '/ws/device', {
        headers: { Authorization: `Bearer ${d.deviceToken}` },
    });
    await once(ws, 'open');
    const closed = once(ws, 'close');
    const blocked = await call(
        `/api/devices/${d.localId}/blacklist`,
        account,
        { blacklisted: true },
        'PATCH',
    );
    assert.equal(blocked.status, 200);
    assert.equal(blocked.body.device.is_blacklisted, true);
    assert.equal((await closed)[0], 4001);
    assert.equal(
        (await call('/api/sync/status', d.deviceToken, { deviceId: d.deviceId })).status,
        401,
    );
    assert.equal(
        (await call('/api/client/register', d.ticket.enrollmentToken, d.profile)).status,
        403,
    );
    assert.equal((await upload(d, pending)).status, 401);
    assert.equal(
        (
            await fetch(base + frame.body.imageUrl, {
                headers: { Authorization: `Bearer ${account}` },
            })
        ).status,
        410,
    );
    const count = (
        await db('protocol_logs').where({ device_id: d.deviceId, type: 'device_blacklisted' })
    ).length;
    await call(`/api/devices/${d.localId}/blacklist`, account, { blacklisted: true }, 'PATCH');
    assert.equal(
        (await db('protocol_logs').where({ device_id: d.deviceId, type: 'device_blacklisted' }))
            .length,
        count,
    );
    const unblocked = await call(
        `/api/devices/${d.localId}/blacklist`,
        account,
        { blacklisted: false },
        'PATCH',
    );
    assert.equal(unblocked.status, 200);
    assert.equal(unblocked.body.device.is_blacklisted, false);
    assert.equal(
        (await call('/api/sync/status', d.deviceToken, { deviceId: d.deviceId })).status,
        200,
    );
    assert.equal((await upload(d, pending)).status, 410);
});

test('soft deletion hides device and linked data from all read paths, keeps audit evidence, and remains project-scoped', async () => {
    const [id] = await db('devices').insert({
        public_id: 'DELETE_FIXTURE',
        name: 'Deletion fixture',
        project_id: 2,
        source: 'sample',
    });
    const [snapshotId] = await db('snapshots').insert({
        device_id: id,
        project_id: 2,
        source: 'sample',
        payload: '{}',
    });
    const scoped = new DeviceManagement(db, new Store(db, 1), app.ingress);
    await assert.rejects(scoped.change(id, { remove: true }, owner.id), (e) => e.status === 404);
    assert.equal((await db('devices').where({ id }).first()).deleted_at, null);
    const deleted = await call(`/api/devices/${id}`, account, {}, 'DELETE');
    assert.equal(deleted.status, 200);
    assert.equal(deleted.body.mode, 'soft-delete');
    assert.equal((await call(`/api/devices/${id}`, account, undefined, 'GET')).status, 404);
    assert.equal(
        (await call(`/api/snapshots/${snapshotId}/export`, account, undefined, 'GET')).status,
        404,
    );
    assert.equal(
        (await call(`/api/snapshots/${snapshotId}/image`, account, undefined, 'GET')).status,
        404,
    );
    assert.equal(
        (await call('/api/devices?q=DELETE_FIXTURE', account, undefined, 'GET')).body.total,
        0,
    );
    assert.equal((await db('snapshots').where('id', snapshotId)).length, 1);
    assert.equal(
        (
            await db('protocol_logs')
                .where({ device_id: 'DELETE_FIXTURE', type: 'device_deleted' })
                .first()
        ).project_id,
        2,
    );
    assert.equal((await call(`/api/devices/${id}`, account, {}, 'DELETE')).status, 200);
    assert.deepEqual(await db.raw('PRAGMA foreign_key_check'), []);
});

test('management endpoints validate input and reject device credentials; deleted enrollment never resurrects', async () => {
    const d = await register();
    assert.equal(
        (await call(`/api/devices/${d.localId}`, d.deviceToken, {}, 'DELETE')).status,
        401,
    );
    assert.equal(
        (
            await call(
                `/api/devices/${d.localId}/blacklist`,
                account,
                { blacklisted: 'true' },
                'PATCH',
            )
        ).status,
        422,
    );
    assert.equal(
        (await call(`/api/devices/${d.localId}`, account, { force: true }, 'DELETE')).status,
        422,
    );
    assert.equal((await call(`/api/devices/${d.localId}`, account, {}, 'DELETE')).status, 200);
    assert.equal(
        (await call('/api/client/register', d.ticket.enrollmentToken, d.profile)).status,
        403,
    );
    assert.equal(
        (await call('/api/sync/status', d.deviceToken, { deviceId: d.deviceId })).status,
        401,
    );
    assert.equal((await db('device_credentials').where('device_id', d.localId).first()).revoked, 1);
});
