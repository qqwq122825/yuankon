import { test, expect } from '@playwright/test';
import sharp from 'sharp';
import { once } from 'node:events';
import { WebSocket } from '../../backend/node_modules/ws/wrapper.mjs';

test('APK ownership, automatic online and an actual synthetic JPEG are visible in the existing console', async ({
    page,
}) => {
    const errors = [];
    const imageRequests = [],
        metadataRequests = [];
    page.on('request', (request) => {
        const path = new URL(request.url()).pathname;
        if (/^\/api\/devices\/\d+\/screenshot\//.test(path)) imageRequests.push(path);
        else if (/^\/api\/devices\/\d+\/screenshot$/.test(path)) metadataRequests.push(path);
    });
    page.on('pageerror', (e) => errors.push(e.message));
    await page.goto('/login');
    await page.getByRole('textbox', { name: '账号', exact: true }).fill('mtx');
    await page.getByLabel('密码', { exact: true }).fill('mtx123');
    await page.getByRole('button', { name: '登录', exact: true }).click();
    await expect(page).toHaveURL('/');
    const { user } = await (await page.request.get('/api/auth/me')).json();
    const apkId = user.apkId;
    const headers = { 'X-Boundary-Request': '1' };
    const register = await page.request.post('/api/client/online', {
        headers,
        data: { deviceId: 'E2E_SCREEN_DEVICE', apkId, model: '合成截图测试设备' },
    });
    expect(register.status()).toBe(201);
    const device = await register.json();
    const deviceHeaders = { ...headers, Authorization: `Bearer ${device.deviceToken}` };
    const deviceSocket = new WebSocket('ws://127.0.0.1:8081/ws/device', {
        headers: { Authorization: `Bearer ${device.deviceToken}` },
    });
    await once(deviceSocket, 'open');
    const statusAck = once(deviceSocket, 'message');
    deviceSocket.send(
        JSON.stringify({
            type: 'status',
            sessionId: device.deviceId,
            data: { type: 'device_status', accessibilityAlive: true, batteryLevel: 76 },
        }),
    );
    expect(JSON.parse(String((await statusAck)[0])).type).toBe('status_ack');
    let dndEnabled = false;
    let receivedText = '';
    let activeCapture;
    const receivedTaps = [],
        receivedDrags = [];
    let tapConsent = false;
    deviceSocket.on('message', (raw) => {
        const message = JSON.parse(String(raw));
        if (message.type !== 'command') return;
        const { commandId, params } = message.data;
        if (message.data.command === 'SCREENSHOT_VIEWER_LEASE') {
            deviceSocket.send(
                JSON.stringify({
                    protocol: 'boundary-node-v2',
                    type: 'accessibility_snapshot',
                    sessionId: device.deviceId,
                    apkId,
                    timestamp: Date.now(),
                    data: {
                        viewerId: params.viewerId,
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
                                            bounds: [20, 40, 260, 92],
                                            flags: { visible: true, enabled: true },
                                            text_present: true,
                                            text: 'Fixture title',
                                            content_description: null,
                                        },
                                        {
                                            id: 'n1',
                                            parent_id: 'n0',
                                            class_name: 'android.widget.Button',
                                            view_id: 'dev.boundary.fixture:id/action',
                                            bounds: [80, 620, 280, 700],
                                            flags: {
                                                visible: true,
                                                enabled: true,
                                                clickable: true,
                                                editable: true,
                                                sensitive: true,
                                                password: true,
                                            },
                                            text_present: true,
                                            text: 'Synthetic uploaded input',
                                        },
                                        {
                                            id: 'n2',
                                            parent_id: 'n0',
                                            class_name: 'android.view.View',
                                            bounds: [300, 700, 200, 600],
                                            flags: { visible: true, clickable: true },
                                            text: 'Invalid geometry fixture',
                                        },
                                    ],
                                },
                            ],
                            observations: [],
                            diagnostics: { elapsed_ms: 3, truncated: false },
                        },
                    },
                }),
            );
            return;
        }
        if (message.data.command === 'SCREENSHOT_NOW') {
            activeCapture = { commandId, viewerId: params.viewerId };
            return;
        }
        if (message.data.command === 'SCREEN_TAP') {
            receivedTaps.push(params);
            deviceSocket.send(
                JSON.stringify({
                    protocol: 'boundary-screenshot-v2',
                    type: 'command_ack',
                    sessionId: device.deviceId,
                    data: {
                        command: 'SCREEN_TAP',
                        commandId,
                        result: tapConsent ? 'accepted' : 'rejected',
                        reasonCode: tapConsent ? 'tap_completed' : 'local_consent_required',
                    },
                }),
            );
            return;
        }
        if (message.data.command === 'SCREEN_DRAG') {
            receivedDrags.push(params);
            deviceSocket.send(
                JSON.stringify({
                    protocol: 'boundary-screenshot-v2',
                    type: 'command_ack',
                    sessionId: device.deviceId,
                    data: {
                        command: 'SCREEN_DRAG',
                        commandId,
                        result: tapConsent ? 'accepted' : 'rejected',
                        reasonCode: tapConsent ? 'drag_completed' : 'local_consent_required',
                    },
                }),
            );
            return;
        }
        if (message.data.command === 'TEXT_INPUT') {
            receivedText = params.text;
            deviceSocket.send(
                JSON.stringify({
                    protocol: 'boundary-screenshot-v2',
                    type: 'command_ack',
                    sessionId: device.deviceId,
                    data: {
                        command: 'TEXT_INPUT',
                        commandId,
                        result: 'accepted',
                        reasonCode: 'text_set',
                    },
                }),
            );
            return;
        }
        if (message.data.command !== 'DEVICE_ACTION') return;
        let reasonCode = 'action_completed';
        if (params.action === 'DND_TOGGLE') {
            dndEnabled = !dndEnabled;
            reasonCode = dndEnabled ? 'dnd_enabled' : 'dnd_disabled';
        }
        deviceSocket.send(
            JSON.stringify({
                protocol: 'boundary-screenshot-v2',
                type: 'command_ack',
                sessionId: device.deviceId,
                data: {
                    command: 'DEVICE_ACTION',
                    commandId,
                    action: params.action,
                    result: 'accepted',
                    reasonCode,
                },
            }),
        );
    });
    const grant = await page.request.post('/api/device/screenshot-session', {
        headers: deviceHeaders,
        data: { deviceId: device.deviceId, consent: true },
    });
    expect(grant.status()).toBe(201);
    const { uploadId } = await grant.json();
    const buffer = await sharp({
        create: { width: 360, height: 800, channels: 3, background: '#397b93' },
    })
        .jpeg()
        .toBuffer();
    const upload = await page.request.post('/api/device/screenshot', {
        headers: { ...deviceHeaders, 'X-Capture-Upload': uploadId },
        multipart: {
            deviceId: device.deviceId,
            apkId,
            ts: String(Date.now()),
            batch: '',
            buildId: 'synthetic',
            file: { name: 'synthetic.jpg', mimeType: 'image/jpeg', buffer },
        },
    });
    expect(upload.status()).toBe(201);
    await page.goto('/?q=E2E_SCREEN_DEVICE');
    await expect(page.locator('.header-stat').filter({ hasText: '设备总数' })).toContainText('13');
    await expect(page.getByRole('img', { name: '合成截图测试设备 临时首图缩略图' })).toBeVisible();
    await page.goto(`/devices/${device.localId}`);
    await expect(page.getByText(`${apkId} / mtx`)).toBeVisible();
    await page.getByRole('button', { name: '实时查看截图', exact: true }).click();
    const panel = page.getByRole('region', { name: 'BM截图', exact: true });
    const reader = page.getByRole('region', { name: '阅读器', exact: true });
    const image = panel.getByRole('img', { name: '设备实时上报的最新截图' });
    await expect(image).toBeVisible();
    await expect(reader).toBeVisible();
    expect((await reader.boundingBox()).width).toBe(300);
    await expect(reader.locator('.reader-map-node')).toHaveCount(2);
    await expect(reader.locator('.reader-map-stage')).not.toContainText('Invalid geometry fixture');
    await expect(reader.locator('.reader-map-stage')).not.toContainText('Button');
    await expect(reader.locator('.reader-map-stage')).not.toContainText('FrameLayout');
    await expect(reader.locator('.reader-map-node').first()).toContainText('Fixture title');
    await expect(reader.locator('.reader-map-node').nth(1)).toContainText(
        'Synthetic uploaded input',
    );
    await expect(reader.getByRole('button', { name: '翻译', exact: true })).toBeVisible();
    await expect(reader.locator('.floating-heading .reader-actions')).toHaveCount(1);
    const labelNode = reader.locator('.reader-map-node').filter({ hasText: 'Fixture title' });
    await expect(labelNode).toHaveAttribute('title', 'Fixture title');
    expect(
        await labelNode.locator('span').evaluate((el) => getComputedStyle(el).textOverflow),
    ).toBe('clip');
    expect(await labelNode.evaluate((el) => getComputedStyle(el).whiteSpace)).toBe('normal');

    await expect(reader.locator('.node-reader > .reader-actions')).toHaveCount(0);
    expect((await reader.locator('.width-control').boundingBox()).height).toBeLessThanOrEqual(28);
    await reader.getByRole('button', { name: '缩小屏幕', exact: true }).click();
    await reader.getByRole('button', { name: '缩小屏幕', exact: true }).click();
    await reader.getByRole('button', { name: '缩小屏幕', exact: true }).click();
    await reader.getByRole('button', { name: '缩小屏幕', exact: true }).click();
    expect((await reader.boundingBox()).width).toBe(220);
    expect(
        await reader
            .locator('.floating-heading')
            .evaluate((el) => el.scrollWidth <= el.clientWidth),
    ).toBe(true);
    for (let i = 0; i < 4; i++)
        await reader.getByRole('button', { name: '放大屏幕', exact: true }).click();
    await reader.getByRole('button', { name: '缩小阅读器字号' }).click();
    await expect(reader.locator('.reader-actions output')).toHaveText('50%');
    await expect(reader.locator('.reader-record-summary')).toHaveCount(0);
    await expect(reader).not.toContainText('1 个窗口');
    await expect(reader).not.toContainText('2 个节点');
    await expect(reader.getByRole('tab')).toHaveCount(0);
    await expect(reader.getByRole('textbox', { name: '发送到设备的文本' })).toHaveCount(1);
    await reader.locator('.reader-map-node').first().click();
    await expect(reader.locator('.reader-properties')).toHaveCount(0);
    await expect(reader).not.toContainText('原始节点记录');
    await reader.locator('.reader-map-node').first().press('Enter');
    await expect(reader.locator('.reader-properties')).toHaveCount(0);
    await expect(reader.locator('.reader-record-note')).toHaveCount(0);
    expect(
        await reader
            .locator('.reader-body')
            .evaluate((el) => el.scrollHeight <= el.clientHeight + 1),
    ).toBe(true);
    await expect(reader.locator('.width-control')).toContainText('屏幕宽度');
    await expect(panel.locator('.floating-heading-meta')).toHaveText('截图 #1');
    await expect(panel.locator('.viewer-live-dot')).toBeVisible();
    await expect(panel.locator('.width-control')).toHaveCount(0);
    await expect(panel.locator('.floating-heading-title strong')).toHaveCSS(
        'color',
        'rgb(255, 61, 67)',
    );
    await expect.poll(() => image.evaluate((el) => el.naturalWidth)).toBe(360);
    expect((await panel.boundingBox()).width).toBe(300);
    const stage = panel.locator('.live-screenshot-stage');
    await expect(stage).toHaveCSS('background-color', 'rgb(48, 48, 48)');
    const initialHeight = (await stage.boundingBox()).height;
    expect(initialHeight).toBeGreaterThan(600);
    await expect(panel.getByRole('button', { name: '刷新上报截图' })).toHaveCount(0);
    await expect(panel.locator('.viewer-capture-status')).toHaveCount(0);
    await expect(panel.locator('.reader-foot')).toHaveCount(0);
    expect((await stage.boundingBox()).height).toBe(initialHeight);
    for (const name of ['上一页', 'Home', '多任务', '锁屏', '点亮', '切换勿扰'])
        await expect(panel.getByRole('button', { name, exact: true })).toBeEnabled();
    await panel.getByRole('button', { name: '切换勿扰', exact: true }).click();
    await expect(page.locator('.device-browser-toast')).toHaveText('勿扰已开启');
    await expect(panel.locator('.device-browser-toast')).toHaveCount(0);
    await panel.getByRole('button', { name: '切换勿扰', exact: true }).click();
    await expect(page.locator('.device-browser-toast')).toHaveText('勿扰已关闭');
    const textInput = panel.getByRole('textbox', { name: '发送到设备的文本' });
    await expect(textInput).toHaveAttribute('placeholder', '输入文本…');
    await expect(reader.getByRole('textbox', { name: '发送到设备的文本' })).toHaveAttribute(
        'placeholder',
        '输入或粘贴文本…',
    );
    await textInput.fill('焦点输入测试 123');
    await panel.getByRole('button', { name: '发送文本' }).click();
    await expect.poll(() => receivedText).toBe('焦点输入测试 123');
    await expect(page.locator('.device-browser-toast')).toHaveText('文本已发送');
    await expect(textInput).toHaveValue('');
    await page.setViewportSize({ width: 1440, height: 706 });
    const compactStage = await stage.boundingBox();
    expect(compactStage.width).toBe(298);
    expect(compactStage.height).toBeGreaterThan(640);
    expect(compactStage.width / compactStage.height).toBeCloseTo(360 / 800, 2);
    for (const viewer of [panel, reader]) {
        const viewerBox = await viewer.boundingBox();
        const actionBox = await viewer.locator('.capture-action-bar').boundingBox();
        const textBox = await viewer.locator('.capture-text-bar').boundingBox();
        expect(actionBox.y).toBeGreaterThan(viewerBox.y);
        expect(textBox.y).toBeGreaterThanOrEqual(actionBox.y + actionBox.height - 1);
        expect(textBox.y + textBox.height).toBeLessThanOrEqual(viewerBox.y + viewerBox.height + 1);
    }
    // Real HTTP JPEG ingestion + WS single-tap routing (synthetic phone, not Android execution).
    await expect.poll(() => Boolean(activeCapture)).toBe(true);
    async function sendFrame(width, height) {
        const buffer = await sharp({
            create: { width, height, channels: 3, background: '#397b93' },
        })
            .jpeg()
            .toBuffer();
        const response = await page.request.post('/api/device/screenshot', {
            headers: { ...deviceHeaders, 'X-Capture-Mode': 'viewer-stream' },
            multipart: {
                deviceId: device.deviceId,
                apkId,
                ts: String(Date.now()),
                ...activeCapture,
                file: { name: 'fixture.jpg', mimeType: 'image/jpeg', buffer },
            },
        });
        expect(response.status()).toBe(201);
        return response.json();
    }
    async function publishFrame(width, height) {
        const frame = await sendFrame(width, height);
        await expect.poll(() => image.evaluate((el) => el.dataset.frameId)).toBe(frame.frameId);
        await expect.poll(() => image.evaluate((el) => el.complete && el.naturalWidth)).toBe(width);
        return frame;
    }
    const portrait = await publishFrame(360, 800);
    await expect(image).toHaveCSS('cursor', 'crosshair');
    await image.click({ position: { x: 74.5, y: (await image.boundingBox()).height * 0.75 } });
    await expect(page.locator('.device-browser-toast')).toHaveText('请先在手机点击运行操作');
    expect(receivedTaps.at(-1).frameId).toBe(portrait.frameId);
    expect(receivedTaps.at(-1).x).toBeCloseTo(0.25, 2);
    expect(receivedTaps.at(-1).y).toBeCloseTo(0.75, 2);
    tapConsent = true;
    await image.click();
    await expect(page.locator('.device-browser-toast')).toHaveText('手机已完成单击');
    // The reader map routes coordinates directly without waiting for a matching screenshot frame.
    const liveReport = await page.request.get(
        `/api/devices/${new URL(page.url()).pathname.split('/').pop()}/accessibility-snapshot?viewerId=${activeCapture.viewerId}`,
    );
    const readerPayload = (await liveReport.json()).snapshot.payload;
    readerPayload.captured_at = new Date().toISOString();
    readerPayload.windows[0].nodes[0].text = 'Fixture reader tap';
    deviceSocket.send(
        JSON.stringify({
            protocol: 'boundary-node-v2',
            type: 'accessibility_snapshot',
            sessionId: device.deviceId,
            apkId,
            timestamp: Date.now(),
            data: { viewerId: activeCapture.viewerId, payload: readerPayload },
        }),
    );
    const map = reader.locator('.reader-map-stage');
    await expect(map).toContainText('Fixture reader tap');
    await expect(map).toHaveClass(/reader-tap-enabled/);
    await expect(map).toHaveCSS('cursor', 'crosshair');
    const beforeReaderTap = receivedTaps.length;
    await map.click({
        position: {
            x: (await map.boundingBox()).width * 0.5,
            y: (await map.boundingBox()).height * 0.5,
        },
    });
    await expect(page.locator('.device-browser-toast')).toHaveText('手机已完成单击');
    await expect.poll(() => receivedTaps.length).toBe(beforeReaderTap + 1);
    expect([portrait.frameId, undefined]).toContain(receivedTaps.at(-1).frameId);
    expect(receivedTaps.at(-1).x).toBeCloseTo(0.5, 2);
    expect(receivedTaps.at(-1).y).toBeCloseTo(0.5, 2);
    await expect(map).toHaveClass(/reader-tap-enabled/);
    await page.waitForTimeout(2600);
    await expect(map).toHaveClass(/reader-tap-enabled/);
    const readerTapCount = receivedTaps.length;
    await map.click({ position: { x: 150, y: 160 } });
    await expect.poll(() => receivedTaps.length).toBe(readerTapCount + 1);
    expect([portrait.frameId, undefined]).toContain(receivedTaps.at(-1).frameId);
    const beforeReaderDrag = receivedDrags.length;
    const box = await map.boundingBox();
    await page.mouse.move(box.x + box.width * 0.25, box.y + box.height * 0.25);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width * 0.75, box.y + box.height * 0.75, { steps: 4 });
    await page.mouse.up();
    await expect(page.locator('.device-browser-toast')).toHaveText('手机已完成滑动');
    await expect.poll(() => receivedDrags.length).toBe(beforeReaderDrag + 1);
    expect(receivedDrags.at(-1).x1).toBeCloseTo(0.25, 1);
    expect(receivedDrags.at(-1).y1).toBeCloseTo(0.25, 1);
    expect(receivedDrags.at(-1).x2).toBeCloseTo(0.75, 1);
    expect(receivedDrags.at(-1).y2).toBeCloseTo(0.75, 1);
    const landscape = await publishFrame(800, 360);
    expect((await panel.boundingBox()).width).toBe(300);
    expect((await stage.boundingBox()).height).toBeCloseTo((298 * 360) / 800, 0);
    await image.click({ position: { x: 223.5, y: (await image.boundingBox()).height * 0.25 } });
    await expect(page.locator('.device-browser-toast')).toHaveText('手机已完成单击');
    expect(receivedTaps.at(-1).frameId).toBe(landscape.frameId);
    expect(receivedTaps.at(-1).x).toBeCloseTo(0.75, 2);
    expect(receivedTaps.at(-1).y).toBeCloseTo(0.25, 2);
    // Hold image downloads while ten direct JPEG frames arrive; renderer coalesces to newest.
    const metadataBefore = metadataRequests.length,
        imagesBefore = imageRequests.length;
    await page.route('**/api/devices/*/screenshot/*', async (route) => {
        await new Promise((resolve) => setTimeout(resolve, 180));
        await route.continue();
    });
    await image.evaluate((el) => {
        el.dataset.stableElement = 'retained';
    });
    let newest;
    for (let i = 0; i < 10; i++) newest = await sendFrame(800, 360);
    await expect.poll(() => image.evaluate((el) => el.dataset.frameId)).toBe(newest.frameId);
    await expect.poll(() => image.evaluate((el) => el.complete && el.naturalWidth)).toBe(800);
    await expect(image).toHaveAttribute('data-stable-element', 'retained');
    expect(imageRequests.length - imagesBefore).toBeLessThan(10);
    expect(metadataRequests.length).toBe(metadataBefore);
    console.log(
        `DIRECT_STREAM PASS: 10 frames, image HTTP=${imageRequests.length - imagesBefore}, per-frame metadata HTTP=0, screenshot-session HTTP=0`,
    );
    await page.unroute('**/api/devices/*/screenshot/*');
    await page.setViewportSize({ width: 1920, height: 1080 });
    expect((await panel.boundingBox()).width).toBe(300);
    await page.screenshot({
        path: 'test-results/synthetic-landscape-tap-1920.png',
        fullPage: true,
    });
    await page.setViewportSize({ width: 800, height: 1000 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeGreaterThanOrEqual(
        1280,
    );
    await page.screenshot({ path: 'test-results/synthetic-device-ingress.png', fullPage: true });
    await image.click();
    await page.keyboard.press('Escape');
    await expect(panel).toHaveCount(0);
    deviceSocket.close();
    await once(deviceSocket, 'close');
    expect(errors).toEqual([]);
});
