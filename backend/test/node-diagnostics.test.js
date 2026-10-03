import test from 'node:test';
import assert from 'node:assert/strict';
import { nodeDiagnosticEvents, nodeRejectionEvent } from '../src/node-diagnostics.js';
const node = (text, flags = {}) => ({
    id: 'n1',
    parent_id: null,
    class_name: 'android.widget.TextView',
    bounds: [0, 0, 80, 80],
    text_present: true,
    text,
    content_description: null,
    flags: { visible: true, ...flags },
});
const frame = (nodes, pkg = 'com.android.launcher3') => ({
    id: 'snap',
    captured_at: 'synthetic',
    payload: { windows: [{ id: 'active', package: pkg, nodes }] },
});
test('desktop target match is reported without logging any raw labels or field contents', () => {
    const events = nodeDiagnosticEvents(
        frame([
            node('Yono Lite SBI'),
            node('FAKE_PRIVATE_INPUT', { editable: true }),
            node('FAKE_PRIVATE_PASSWORD', { password: true }),
        ]),
    );
    assert.equal(events[0].details.targetIconMatches, 1);
    assert.equal(events[0].details.nodeRecords[0].targetIconMatch, true);
    const value = JSON.stringify(events);
    assert.ok(!value.includes('FAKE_PRIVATE'));
    assert.ok(!value.includes('Yono Lite'));
    assert.equal(
        nodeDiagnosticEvents(frame([node('Yono Lite SBI')], 'com.sbi.bank'))[0].details
            .targetIconMatches,
        0,
    );
});
test('node records chunk deterministically, cap at 200 and mark truncation explicitly', () => {
    const events = nodeDiagnosticEvents(
        frame(Array.from({ length: 201 }, (_, i) => ({ ...node('label'), id: `n${i}` }))),
    );
    assert.equal(events.length, 34);
    assert.equal(
        events.reduce((sum, e) => sum + e.details.nodeRecords.length, 0),
        200,
    );
    for (const e of events) {
        assert.equal(e.details.recordsTruncated, true);
        assert.equal(e.details.totalNodeCount, 201);
        assert.ok(Buffer.byteLength(JSON.stringify(e.details)) <= 4096);
    }
});

test('multibyte and JSON-escaped metadata still fit the per-event byte budget', () => {
    const huge = '\u0000'.repeat(100);
    const nodes = Array.from({ length: 20 }, () => ({
        ...node('label'),
        id: huge,
        parent_id: huge,
        class_name: '界'.repeat(200),
    }));
    for (const event of nodeDiagnosticEvents(frame(nodes)))
        assert.ok(Buffer.byteLength(JSON.stringify(event.details)) <= 4096);
});

test('rejected node diagnostics contain typed paths and counts, never rejected values', () => {
    const input = {
        captured_at: '2026-10-01T00:10:15.647Z',
        windows: [{ nodes: Array.from({ length: 153 }, () => ({ text: 'FAKE_PRIVATE' })) }],
    };
    const event = nodeRejectionEvent(input, {
        message: 'FAKE_PRIVATE',
        issues: [
            {
                code: 'too_big',
                path: ['windows', 0, 'nodes', 12, 'bounds', 0],
                message: 'FAKE_PRIVATE',
                input: 'FAKE_PRIVATE',
            },
        ],
    });
    assert.equal(event.details.nodeCount, 153);
    assert.equal(event.details.reasonCode, 'schema_validation');
    assert.equal(event.details.payloadBytes, Buffer.byteLength(JSON.stringify(input)));
    assert.match(event.details.validationIssues, /windows.0.nodes.12.bounds.0/);
    assert.ok(!JSON.stringify(event).includes('FAKE_PRIVATE'));
    assert.equal(
        nodeRejectionEvent(null, new Error('websocket_payload_limit')).details.reasonCode,
        'websocket_payload_limit',
    );
});

test('153-node receive path accepts empty bounds and records rejected frames without raw values', async () => {
    const { DeviceIngress } = await import('../src/device-ingress.js');
    const device = { id: 4, owner_account_id: 1, public_id: 'FIXTURE' };
    const reports = [];
    const receiver = {
        prune() {},
        viewerLeases: new Map([
            [4, { viewerId: 'viewer', ownerId: 1, expiresAt: Date.now() + 60000 }],
        ]),
        nodeFrames: new Map(),
        debugSessions: new Map([[4, { sessionId: 'synthetic' }]]),
        recordDebugReport: async (_device, report) => reports.push(...report.events),
        store: { audit: async () => {} },
        acceptAccessibilitySnapshot: DeviceIngress.prototype.acceptAccessibilitySnapshot,
        recordNodeFailure: DeviceIngress.prototype.recordNodeFailure,
    };
    const payload = {
        schema_version: 1,
        captured_at: new Date().toISOString(),
        display: { width: 900, height: 1600 },
        windows: [
            {
                id: 'active',
                type: 'application',
                package: 'com.android.launcher3',
                root_status: 'available',
                nodes: Array.from({ length: 153 }, (_, i) => ({
                    id: `n${i}`,
                    parent_id: i ? 'n0' : null,
                    class_name: 'android.view.View',
                    bounds: i < 92 ? [0, 0, 0, 0] : [0, 0, 900, 1600],
                })),
            },
        ],
    };
    const accepted = await DeviceIngress.prototype.receiveAccessibilitySnapshot.call(
        receiver,
        device,
        'viewer',
        payload,
    );
    assert.equal(accepted.node_count, 153);
    assert.equal(reports[0].stage, 'nodes_received');
    payload.windows[0].nodes[12].bounds = [0, 0, 32769, 10];
    await assert.rejects(
        DeviceIngress.prototype.receiveAccessibilitySnapshot.call(
            receiver,
            device,
            'viewer',
            payload,
        ),
    );
    assert.equal(reports.at(-1).stage, 'nodes_rejected');
    assert.equal(reports.at(-1).details.reasonCode, 'schema_validation');
    assert.equal(receiver.nodeFrames.get(4).id, accepted.id);
    receiver.debugSessions.clear();
    const count = reports.length;
    await assert.rejects(
        DeviceIngress.prototype.receiveAccessibilitySnapshot.call(
            receiver,
            device,
            'viewer',
            payload,
        ),
    );
    assert.equal(reports.length, count);
});

test('live inverted bounds preserve all 153 nodes, valid desktop icon and parent linkage', async () => {
    const { normalizeLiveSnapshot, normalizeSnapshot } = await import('../src/protocol.js');
    const payload = {
        schema_version: 1,
        captured_at: new Date().toISOString(),
        display: { width: 900, height: 1600 },
        windows: [
            {
                id: 'active',
                type: 'application',
                package: 'com.android.launcher3',
                root_status: 'available',
                nodes: Array.from({ length: 153 }, (_, i) => ({
                    id: `n${i}`,
                    parent_id: i ? 'n0' : null,
                    class_name: 'android.widget.TextView',
                    bounds: i < 92 ? [20, 20, 10, 10] : [600, 200, 850, 400],
                    flags: { visible: true, clickable: true },
                    text: i === 152 ? 'Yono Lite SBI' : null,
                    text_present: i === 152,
                })),
            },
        ],
    };
    const normalized = normalizeLiveSnapshot(payload);
    assert.equal(normalized.windows[0].nodes.length, 153);
    assert.equal(normalized.diagnostics.invalid_bounds_count, 92);
    assert.equal(normalized.diagnostics.empty_bounds_count, 92);
    assert.deepEqual(normalized.windows[0].nodes[0].bounds, [0, 0, 0, 0]);
    assert.equal(normalized.windows[0].nodes[0].flags.clickable, false);
    assert.equal(normalized.windows[0].nodes[0].flags.visible, false);
    assert.equal(normalized.windows[0].nodes[0].geometry_status, 'invalid');
    assert.equal(normalized.windows[0].nodes[152].parent_id, 'n0');
    assert.deepEqual(normalized.windows[0].nodes[152].bounds, [600, 200, 850, 400]);
    assert.equal(
        nodeDiagnosticEvents({ ...frame([]), payload: normalized })[0].details.targetIconMatches,
        1,
    );
    assert.deepEqual(payload.windows[0].nodes[0].bounds, [20, 20, 10, 10]);
    assert.throws(() => normalizeSnapshot(payload), /节点坐标无效/);
    payload.windows[0].nodes[1].parent_id = 'absent';
    assert.throws(() => normalizeLiveSnapshot(payload), /节点引用或深度无效/);
});
