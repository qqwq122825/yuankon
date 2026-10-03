import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { shouldResumeCapture } from '../../frontend/src/capture-state.js';
import { statusSchema, wireDevice } from '../src/protocol.js';
import { Store } from '../src/store.js';

const viewing = { viewing: true, viewerId: 'synthetic-viewer' };
const ready = { status: 'online', captureReady: true, captureMode: 'projection' };
test('existing viewer resumes on authorization, mode switch and reconnect, not repeated heartbeat', () => {
    assert.equal(shouldResumeCapture({ ...ready, captureReady: false }, ready, viewing), true);
    assert.equal(
        shouldResumeCapture({ ...ready, captureMode: 'accessibility' }, ready, viewing),
        true,
    );
    assert.equal(shouldResumeCapture({ ...ready, status: 'offline' }, ready, viewing), true);
    assert.equal(shouldResumeCapture(ready, ready, viewing), false);
    for (const context of [
        { viewing: false, viewerId: 'v' },
        { viewing: true, viewerId: null },
    ])
        assert.equal(shouldResumeCapture({}, ready, context), false);
    for (const state of [
        { ...ready, captureReady: false },
        { ...ready, status: 'offline' },
        { ...ready, is_blacklisted: true },
    ])
        assert.equal(shouldResumeCapture({}, state, viewing), false);
});
test('validated readiness metadata survives store DTO and panel wire format', () => {
    const status = statusSchema.parse({
        type: 'device_heartbeat',
        ...ready,
        projectionActive: true,
        unknown: 'drop',
    });
    assert.equal(status.captureReady, true);
    assert.equal(status.unknown, undefined);
    assert.throws(() => statusSchema.parse({ type: 'device_heartbeat', captureMode: 'arbitrary' }));
    const store = new Store(null);
    store.live.set('fixture', { ...status, seen: Date.now() });
    const row = { public_id: 'fixture', id: 1, accessibility_enabled: true };
    const wire = wireDevice(store.dto(row));
    assert.equal(wire.captureReady, true);
    assert.equal(wire.captureMode, 'projection');
    assert.equal(wire.projectionActive, true);
    assert.equal(store.dto({ ...row, is_blacklisted: true }).captureReady, null);
});
test('1.7.6 retains 1.7.5, guards old callbacks and keeps accessibility alive when projection stops', async () => {
    const root = new URL('../../android/apk-templates/', import.meta.url);
    const templates = JSON.parse(await readFile(new URL('templates.json', root)));
    assert.ok(templates.some((t) => t.id === 'screenagent-1.7.6'));
    assert.equal(templates[0].id, 'screenagent-1.8.4');
    assert.equal(templates[0].versionCode, 22);
    assert.ok(templates.some((t) => t.id === 'screenagent-1.7.5'));
    const service = await readFile(
        new URL(
            'b-packages/screenagent-1.7.6/app/src/main/java/com/zaka/screenagent/accessibility/BoundaryAccessibilityService.kt',
            root,
        ),
        'utf8',
    );
    assert.match(
        service,
        /if \(CaptureMode.get\(this\) == CaptureMode.PROJECTION\) \{\s*streamViewerId\?\.let/,
    );
    assert.match(service, /if \(generation != frameGeneration\) return@post/);
    assert.match(service, /if \(streamCommandId != null\) return/);
    assert.match(service, /initial_capture.failed/);
    assert.match(service, /60_000/);
});
