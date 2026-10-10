import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { WebSocket } from 'ws';
import { createApplication } from '../src/app.js';
import { config } from '../src/config.js';
import { openDatabase } from '../src/database.js';
import { DEVICE_UI_PREVIEW_SECTIONS, DEVICE_UI_PREVIEW_TOOLS } from '../src/device-ui-preview.js';

let directory, db, instance, base, root, studioA, studioB, memberA, siblingA, memberB;
let aToken, bToken, memberToken, siblingToken, bMemberToken;
let ownDevice, siblingDevice, otherDevice, studioDevice;
let externalCalls = 0;
const sockets = [];
const fixturePassword = 'PreviewFixture123!';
const marker = 'SYNTHETIC_PREVIEW_CONTENT_MUST_NOT_APPEAR';
const expectedSections = [
    'analysis',
    'tools',
    'sms',
    'apps',
    'gallery',
    'password',
    'payments',
    'templates',
    'input-events',
    'diagnostic',
];
const expectedActions = [
    'analyze-sample',
    'screen-preview',
    'camera-preview',
    'permissions-preview',
    'diagnostic-preview',
    'export-preview',
    'apps-preview',
    'gallery-preview',
    'refresh-preview',
];

async function request(url, token = root, method = 'GET', body, headers = {}) {
    const response = await fetch(base + url, {
        method,
        headers: {
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
            ...(body === undefined
                ? {}
                : { 'Content-Type': 'application/json', 'X-Boundary-Request': '1' }),
            ...headers,
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    return { status: response.status, body: await response.json(), headers: response.headers };
}
async function login(username, password = fixturePassword) {
    const response = await request('/api/auth/login', null, 'POST', { username, password });
    assert.equal(response.status, 200);
    return response.body.token;
}
async function createAccount(username, parent) {
    const response = await request(
        parent ? `/api/accounts/studios/${parent}/members` : '/api/accounts/studios',
        root,
        'POST',
        {
            requestId: randomUUID(),
            username,
            password: fixturePassword,
            confirmPassword: fixturePassword,
            validUntil: parent ? null : Date.now() + 30 * 86400000,
            note: '合成详情预览测试账号',
            ...(parent ? {} : { name: username }),
        },
    );
    assert.equal(response.status, 201);
    return response.body.account;
}
async function insertDevice(publicId, owner, projectId) {
    const [id] = await db('devices').insert({
        project_id: projectId,
        owner_account_id: owner,
        public_id: publicId,
        source: 'api',
        name: marker,
        note: marker,
        brand: 'Synthetic',
        android_version: '14',
    });
    return id;
}
async function businessSnapshot() {
    await instance.serverLogs.pending;
    const tables = await db('sqlite_master')
        .where('type', 'table')
        .whereNot('name', 'server_logs')
        .orderBy('name')
        .select('name');
    const snapshot = {};
    for (const { name } of tables)
        snapshot[name] = await (name === 'sqlite_sequence'
            ? db(name).whereNot('name', 'server_logs')
            : db(name));
    return snapshot;
}
const previewUrl = (id = ownDevice) => `/api/devices/${id}/ui-preview`;

before(async () => {
    directory = await mkdtemp(path.join(tmpdir(), 'boundary-ui-preview-'));
    const settings = config({
        privateDir: directory,
        database: path.join(directory, 'preview.sqlite'),
        port: 0,
        apiLimit: 10000,
        loginLimit: 200,
    });
    db = await openDatabase(settings.database);
    instance = await createApplication(settings, {
        db,
        bootstrapDefault: true,
        serveFrontend: false,
        fetcher: async () => {
            externalCalls++;
            throw new Error('Unexpected external call in UI preview');
        },
    });
    await new Promise((resolve) => instance.server.listen(0, '127.0.0.1', resolve));
    base = settings.origin = `http://127.0.0.1:${instance.server.address().port}`;
    root = await login('mtx', 'mtx123');
    studioA = await createAccount('preview_studio_a');
    studioB = await createAccount('preview_studio_b');
    memberA = await createAccount('preview_member_a', studioA.id);
    siblingA = await createAccount('preview_sibling_a', studioA.id);
    memberB = await createAccount('preview_member_b', studioB.id);
    aToken = await login(studioA.username);
    bToken = await login(studioB.username);
    memberToken = await login(memberA.username);
    siblingToken = await login(siblingA.username);
    bMemberToken = await login(memberB.username);
    ownDevice = await insertDevice('PREVIEW_OWN_A', memberA.id, studioA.projectId);
    siblingDevice = await insertDevice('PREVIEW_SIBLING_A', siblingA.id, studioA.projectId);
    otherDevice = await insertDevice('PREVIEW_OTHER_B', memberB.id, studioB.projectId);
    studioDevice = await insertDevice('PREVIEW_STUDIO_A', studioA.id, studioA.projectId);
    await db('snapshots').insert({
        device_id: ownDevice,
        project_id: studioA.projectId,
        source: 'sample',
        payload: JSON.stringify({ synthetic: marker }),
        captured_at: '2000-01-01T00:00:00Z',
        screenshot_path: marker,
    });
    await db('device_memos').insert({
        device_id: ownDevice,
        project_id: studioA.projectId,
        author_account_id: memberA.id,
        body: marker,
        label: 'none',
        created_at: Date.now(),
        updated_at: Date.now(),
    });
});
after(async () => {
    for (const socket of sockets) socket.terminate();
    await instance?.close();
    await db?.destroy();
    if (directory) await rm(directory, { recursive: true, force: true });
});

test('preview catalogue is fixed, labelled as unimplemented, and contains no device content', async () => {
    const response = await request(previewUrl());
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('cache-control'), 'no-store');
    assert.deepEqual(Object.keys(response.body).sort(), [
        'deviceId',
        'implemented',
        'message',
        'mode',
        'sections',
        'state',
        'tools',
    ]);
    assert.equal(response.body.deviceId, ownDevice);
    assert.equal(response.body.mode, 'preview');
    assert.equal(response.body.implemented, false);
    assert.equal(response.body.state, 'not_connected');
    assert.deepEqual(
        response.body.sections.map(({ id }) => id),
        expectedSections,
    );
    assert.deepEqual(
        response.body.sections
            .filter(({ id }) => ['payments', 'templates'].includes(id))
            .map(({ id, label }) => ({ id, label })),
        [
            { id: 'payments', label: '支付密码' },
            { id: 'templates', label: '注入记录' },
        ],
    );
    assert.deepEqual(
        response.body.tools.map(({ id }) => id),
        expectedActions,
    );
    for (const section of response.body.sections) {
        assert.deepEqual(Object.keys(section).sort(), ['id', 'label', 'state']);
        assert.equal(section.state, 'not_connected');
    }
    for (const tool of response.body.tools) {
        assert.deepEqual(Object.keys(tool).sort(), ['group', 'id', 'label']);
        assert.ok(['view', 'data', 'diagnostic'].includes(tool.group));
    }
    assert.equal(JSON.stringify(response.body).includes(marker), false);
    assert.ok(Object.isFrozen(DEVICE_UI_PREVIEW_SECTIONS));
    assert.ok(Object.isFrozen(DEVICE_UI_PREVIEW_TOOLS));
});

test('every preview section remains an empty not-connected list without fabricated history', async () => {
    for (const section of DEVICE_UI_PREVIEW_SECTIONS) {
        const response = await request(`${previewUrl()}/${section.id}`, memberToken);
        assert.equal(response.status, 200, section.id);
        assert.deepEqual(Object.keys(response.body).sort(), [
            'deviceId',
            'implemented',
            'items',
            'message',
            'mode',
            'section',
            'state',
            'total',
        ]);
        assert.equal(response.body.deviceId, ownDevice);
        assert.equal(response.body.mode, 'preview');
        assert.equal(response.body.implemented, false);
        assert.deepEqual(response.body.section, section);
        assert.deepEqual(response.body.items, []);
        assert.equal(response.body.total, 0);
        assert.equal(response.body.state, 'not_connected');
        assert.match(response.body.message, /暂未接入/);
        assert.equal(JSON.stringify(response.body).includes(marker), false);
        assert.equal(JSON.stringify(response.body).includes('2000-01-01'), false);
    }
});

test('all catalogue actions return 501 with explicit no-dispatch status for all three account roles', async () => {
    for (const token of [root, aToken, memberToken])
        for (const action of expectedActions) {
            const response = await request(`${previewUrl()}/actions`, token, 'POST', { action });
            assert.equal(response.status, 501, action);
            assert.deepEqual(Object.keys(response.body).sort(), [
                'action',
                'code',
                'dispatched',
                'error',
                'implemented',
                'message',
                'mode',
            ]);
            assert.equal(response.body.action, action);
            assert.equal(response.body.code, 'NOT_IMPLEMENTED');
            assert.equal(response.body.mode, 'preview');
            assert.equal(response.body.implemented, false);
            assert.equal(response.body.dispatched, false);
        }
});

test('preview APIs require login and preserve studio and member owner isolation before returning data or action status', async () => {
    const endpoints = [
        ['', 'GET', undefined],
        ['/sms', 'GET', undefined],
        ['/actions', 'POST', { action: 'refresh-preview' }],
    ];
    for (const [suffix, method, body] of endpoints) {
        assert.equal((await request(previewUrl() + suffix, null, method, body)).status, 401);
        for (const [token, devices] of [
            [root, [ownDevice, siblingDevice, studioDevice, otherDevice]],
            [aToken, [ownDevice, siblingDevice, studioDevice]],
            [memberToken, [ownDevice]],
            [siblingToken, [siblingDevice]],
            [bToken, [otherDevice]],
            [bMemberToken, [otherDevice]],
        ])
            for (const id of devices)
                assert.equal(
                    (await request(previewUrl(id) + suffix, token, method, body)).status,
                    method === 'POST' ? 501 : 200,
                );
        for (const [token, id] of [
            [bToken, ownDevice],
            [memberToken, siblingDevice],
            [memberToken, studioDevice],
            [memberToken, otherDevice],
            [siblingToken, ownDevice],
            [aToken, otherDevice],
        ])
            assert.equal((await request(previewUrl(id) + suffix, token, method, body)).status, 404);
    }
    assert.equal((await request(`${previewUrl(otherDevice)}/unknown`, memberToken)).status, 404);
    assert.equal((await request(previewUrl(999999))).status, 404);
});

test('only preview validation uses 400 and rejects unknown sections, query strings, actions and extra fields', async () => {
    for (const id of ['invalid', '0', '-1', '1.5', 'NaN'])
        assert.equal((await request(`/api/devices/${id}/ui-preview`)).status, 400);
    assert.equal((await request('/api/devices/invalid')).status, 422);
    for (const section of ['unknown', 'constructor', '__proto__'])
        assert.equal((await request(`${previewUrl()}/${section}`)).status, 400);
    for (const query of ['q=fixture', 'page=1', 'action=refresh-preview', 'text=fixture']) {
        assert.equal((await request(`${previewUrl()}?${query}`)).status, 400);
        assert.equal((await request(`${previewUrl()}/sms?${query}`)).status, 400);
    }
    for (const body of [
        {},
        { action: 'unknown' },
        { action: 'PASSWORD_CAPTURE' },
        { action: 'OTP' },
        { action: 'ADB' },
        { action: null },
        { action: ['refresh-preview'] },
        { action: 'refresh-preview', params: {} },
        { action: 'refresh-preview', deviceId: otherDevice },
        { action: 'refresh-preview', text: marker },
        { action: 'refresh-preview', token: marker },
        { action: 'refresh-preview', image: marker },
    ])
        assert.equal((await request(`${previewUrl()}/actions`, root, 'POST', body)).status, 400);
});

test('preview POST keeps existing same-origin request-header and JSON checks', async () => {
    assert.equal(
        (
            await request(
                `${previewUrl()}/actions`,
                root,
                'POST',
                {
                    action: 'refresh-preview',
                },
                { 'X-Boundary-Request': '' },
            )
        ).status,
        403,
    );
    assert.equal(
        (
            await request(
                `${previewUrl()}/actions`,
                root,
                'POST',
                {
                    action: 'refresh-preview',
                },
                { Origin: 'https://example.com' },
            )
        ).status,
        403,
    );
    assert.equal(
        (
            await request(
                `${previewUrl()}/actions`,
                root,
                'POST',
                {
                    action: 'refresh-preview',
                },
                { 'Content-Type': 'text/plain' },
            )
        ).status,
        415,
    );
});

test('preview reads and 501 actions leave business tables, device channels and external services unchanged while retaining HTTP metadata logs', async () => {
    const deviceToken = await instance.auth.issue('device', 'PREVIEW_OWN_A', '10m', {
        projectId: studioA.projectId,
    });
    const socket = new WebSocket(`${base.replace('http', 'ws')}/ws/device`, {
        headers: { Authorization: `Bearer ${deviceToken}` },
    });
    sockets.push(socket);
    const deviceMessages = [];
    socket.on('message', (message) => deviceMessages.push(String(message)));
    await once(socket, 'open');
    for (let attempt = 0; attempt < 100; attempt++) {
        if (
            await db('protocol_logs')
                .where({ device_id: 'PREVIEW_OWN_A', type: 'device_ws_connected' })
                .first()
        )
            break;
        await new Promise((resolve) => setTimeout(resolve, 10));
    }
    const beforeSnapshot = await businessSnapshot();
    const beforeMessages = [...deviceMessages];
    const beforeExternal = externalCalls;
    const maps = [
        instance.store.live,
        instance.ingress.frames,
        instance.ingress.nodeFrames,
        instance.ingress.viewerLeases,
        instance.ingress.grants,
        instance.ingress.pendingCaptures,
    ];
    const beforeMaps = maps.map((map) => [...map]);
    const businessWrites = [];
    const observeQuery = ({ sql }) => {
        if (
            /\b(?:insert into|update|delete from|create table|alter table|drop table)\b/i.test(
                sql,
            ) &&
            !sql.includes('server_logs')
        )
            businessWrites.push(sql);
    };
    db.on('query', observeQuery);
    try {
        assert.equal((await request(previewUrl())).status, 200);
        for (const section of expectedSections)
            assert.equal((await request(`${previewUrl()}/${section}`, memberToken)).status, 200);
        for (const action of expectedActions)
            assert.equal(
                (await request(`${previewUrl()}/actions`, memberToken, 'POST', { action })).status,
                501,
            );
        assert.equal(
            (
                await request(`${previewUrl()}/actions`, root, 'POST', {
                    action: 'refresh-preview',
                    text: marker,
                })
            ).status,
            400,
        );
        await instance.serverLogs.pending;
    } finally {
        db.off('query', observeQuery);
    }
    assert.deepEqual(await businessSnapshot(), beforeSnapshot);
    assert.deepEqual(businessWrites, []);
    assert.deepEqual(deviceMessages, beforeMessages);
    assert.deepEqual(
        maps.map((map) => [...map]),
        beforeMaps,
    );
    assert.equal(externalCalls, beforeExternal);
    const logs = await db('server_logs');
    const previewLogs = logs.filter(({ request_path }) =>
        request_path?.startsWith('/api/devices/:id/ui-preview'),
    );
    assert.ok(previewLogs.some(({ response_status }) => response_status === 501));
    assert.ok(previewLogs.some(({ response_status }) => response_status === 200));
    assert.equal(JSON.stringify(logs).includes(marker), false);
    assert.equal(JSON.stringify(logs).includes(deviceToken), false);
    console.log(
        'DEVICE_UI_PREVIEW PASS: fixed catalogue; 10 empty sections; 9 actions=501/no dispatch; 3-role/project/owner guards; business writes/device messages/external calls=0; existing HTTP metadata logs retained',
    );
});
