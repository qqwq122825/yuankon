import test from 'node:test';
import assert from 'node:assert/strict';
import { nodeDiagnosticEvents } from '../src/node-diagnostics.js';
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
