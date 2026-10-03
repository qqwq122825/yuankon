import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { screenshotPoint } from '../../frontend/src/screenshot-geometry.js';
import { panelSchema, normalizeLiveSnapshot } from '../src/protocol.js';
import { DeviceIngress } from '../src/device-ingress.js';

test('portrait and landscape mapping uses actual contain area and rejects letterbox', () => {
    assert.deepEqual(
        screenshotPoint(160, 170, { left: 10, top: 20, width: 300, height: 300 }, 800, 400),
        { x: 0.5, y: 0.5 },
    );
    assert.equal(
        screenshotPoint(160, 25, { left: 10, top: 20, width: 300, height: 300 }, 800, 400),
        null,
    );
    assert.deepEqual(
        screenshotPoint(85, 170, { left: 10, top: 20, width: 300, height: 600 }, 400, 800),
        { x: 0.25, y: 0.25 },
    );
    assert.deepEqual(
        screenshotPoint(310, 470, { left: 10, top: 20, width: 300, height: 450 }, 400, 600),
        { x: 1, y: 1 },
    );
    assert.equal(screenshotPoint(NaN, 2, { left: 0, top: 0, width: 300, height: 300 }, 1, 1), null);
    assert.equal(screenshotPoint(0, 0, { left: 0, top: 0, width: 0, height: 300 }, 1, 1), null);
});
test('single-tap command validates point, identity and rejects general gestures', () => {
    const command = {
        type: 'command',
        sessionId: 'FIXTURE',
        data: {
            command: 'SCREEN_TAP',
            commandId: randomUUID(),
            params: { viewerId: randomUUID(), frameId: randomUUID(), x: 0.25, y: 0.75 },
        },
    };
    assert.equal(panelSchema.parse(command).data.command, 'SCREEN_TAP');
    for (const point of [
        { x: -0.01 },
        { x: 1.01 },
        { y: NaN },
        { x: '0.5' },
        { frameId: 'invalid' },
        { duration: 1000 },
    ]) {
        assert.equal(
            panelSchema.safeParse({
                ...command,
                data: { ...command.data, params: { ...command.data.params, ...point } },
            }).success,
            false,
        );
    }
});
test('tap authorization ties fresh frame to owner, viewer and current orientation', () => {
    const frame = {
        frameId: randomUUID(),
        receivedAt: Date.now(),
        width: 540,
        height: 960,
        viewerId: randomUUID(),
        ownerId: 1,
        expiresAt: Date.now() + 5000,
    };
    const ingress = { tapFrames: new Map([[3, [frame]]]), frames: new Map([[3, frame]]) };
    const validate = (
        device = { id: 3, owner_account_id: 1 },
        viewer = frame.viewerId,
        id = frame.frameId,
    ) => DeviceIngress.prototype.validateTap.call(ingress, device, viewer, id);
    assert.equal(validate(), frame);
    assert.throws(() => validate({ id: 3, owner_account_id: 2 }));
    assert.throws(() => validate(undefined, randomUUID()));
    assert.throws(() => validate(undefined, undefined, randomUUID()));
    ingress.frames.set(3, { ...frame, width: 960, height: 540 });
    assert.throws(() => validate());
    ingress.frames.set(3, frame);
    frame.receivedAt -= 6000;
    assert.throws(() => validate());
});
test('1.7.8 requires local in-memory consent with visible stop and one-point completed ACK', async () => {
    const source = new URL(
        '../../android/apk-templates/b-packages/screenagent-1.7.8/app/src/main/',
        import.meta.url,
    );
    const controller = await readFile(
        new URL('java/com/zaka/screenagent/accessibility/ScreenTapController.kt', source),
        'utf8',
    );
    const activity = await readFile(
        new URL('java/com/zaka/screenagent/MainActivity.kt', source),
        'utf8',
    );
    const projection = await readFile(
        new URL('java/com/zaka/screenagent/capture/ProjectionController.kt', source),
        'utf8',
    );
    assert.match(activity, /text = "运行操作"/);
    const service = await readFile(
        new URL('java/com/zaka/screenagent/accessibility/BoundaryAccessibilityService.kt', source),
        'utf8',
    );
    assert.equal((service.match(/screenTaps.controlAllowed\(viewerId\)/g) || []).length, 2);
    assert.match(activity, /AlertDialog\.Builder/);
    assert.match(controller, /allowedUntil = 0L/);
    assert.match(controller, /TYPE_ACCESSIBILITY_OVERLAY/);
    assert.match(controller, /setOnClickListener \{ stop\(\) \}/);
    assert.match(controller, /frame.geometry != geometry\(\)/);
    assert.match(controller, /StrokeDescription\(path, 0, 50\)/);
    assert.match(controller, /onCompleted[\s\S]*tap_completed/);
    assert.match(projection, /onCapturedContentResize/);
    assert.match(projection, /virtual.resize\(width, height, density\)/);
    assert.equal((projection.match(/createVirtualDisplay\(/g) || []).length, 1);
});

test('1.7.8 live loop uploads directly without screenshot-session while thumbnails retain compatibility', async () => {
    const source = new URL(
        '../../android/apk-templates/b-packages/screenagent-1.7.8/app/src/main/java/com/zaka/screenagent/',
        import.meta.url,
    );
    const service = await readFile(
        new URL('accessibility/BoundaryAccessibilityService.kt', source),
        'utf8',
    );
    const loop = service.slice(
        service.indexOf('    private fun captureViewerFrame()'),
        service.indexOf('    private fun captureReady()'),
    );
    assert.doesNotMatch(loop, /singleFrameSession|uploadId/);
    assert.match(loop, /uploadViewerScreenshot\(bytes, commandId, viewerId\)/);
    assert.match(service, /singleFrameSession\("initial_accessibility"\)/);
    assert.match(service, /device_disconnected/);
    const uploader = await readFile(new URL('net/HttpUploader.kt', source), 'utf8');
    assert.match(uploader, /X-Capture-Mode", "viewer-stream/);
    assert.match(uploader, /header\("Authorization", "Bearer \$token"\)/);
});
