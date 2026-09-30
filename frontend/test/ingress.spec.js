import { test, expect } from '@playwright/test';
import sharp from 'sharp';
import { once } from 'node:events';
import { WebSocket } from '../../backend/node_modules/ws/wrapper.mjs';

test('APK ownership, automatic online and an actual synthetic JPEG are visible in the existing console', async ({
    page,
}) => {
    const errors = [];
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
                                            },
                                            text_present: true,
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
    await expect(reader.locator('.reader-map-node').first()).toContainText('Fixture title');
    await expect(reader.getByRole('button', { name: '翻译', exact: true })).toBeVisible();
    await reader.getByRole('button', { name: '缩小阅读器字号' }).click();
    await expect(reader.locator('.reader-actions output')).toHaveText('50%');
    await expect(reader.locator('.reader-record-summary')).toHaveCount(0);
    await expect(reader).not.toContainText('1 个窗口');
    await expect(reader).not.toContainText('2 个节点');
    await expect(reader.getByRole('tab')).toHaveCount(0);
    await expect(reader.getByRole('textbox', { name: '发送到设备的文本' })).toHaveCount(1);
    await reader.locator('.reader-map-node').first().click();
    await expect(reader.locator('.reader-properties')).toContainText(
        '"view_id": "dev.boundary.fixture:id/title"',
    );
    await expect(reader.locator('.reader-properties')).toContainText('"text_present": true');
    await expect(reader.locator('.reader-properties')).toContainText('"text": "Fixture title"');
    await expect(reader.locator('.reader-record-note')).toHaveText(
        '完整显示本帧节点字段 · 正文与输入内容随节点上报',
    );
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
