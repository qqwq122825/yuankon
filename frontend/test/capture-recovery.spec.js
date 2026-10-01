import { test, expect } from '@playwright/test';
import sharp from 'sharp';
import { once } from 'node:events';
import { WebSocket } from '../../backend/node_modules/ws/wrapper.mjs';

test('authorization resumes an open viewer and uploads a synthetic JPEG without reopening it', async ({
    page,
}) => {
    await page.goto('/login');
    await page.getByRole('textbox', { name: '账号', exact: true }).fill('mtx');
    await page.getByLabel('密码', { exact: true }).fill('mtx123');
    await page.getByRole('button', { name: '登录', exact: true }).click();
    await expect(page).toHaveURL('/');
    const { user } = await (await page.request.get('/api/auth/me')).json();
    const apkId = user.apkId;
    const registered = await page.request.post('/api/client/online', {
        headers: { 'X-Boundary-Request': '1' },
        data: { deviceId: 'E2E_CAPTURE_RECOVERY', apkId, model: '授权恢复合成测试设备' },
    });
    const device = await registered.json();
    const headers = { 'X-Boundary-Request': '1', Authorization: `Bearer ${device.deviceToken}` };
    const socket = new WebSocket('ws://127.0.0.1:8081/ws/device', { headers });
    await once(socket, 'open');
    let commands = [],
        mode = 'projection',
        captureReady = false;
    const sendStatus = () =>
        socket.send(
            JSON.stringify({
                type: 'status',
                sessionId: device.deviceId,
                data: {
                    type: 'device_status',
                    accessibilityAlive: true,
                    captureReady,
                    captureMode: mode,
                    projectionActive: mode === 'projection' && captureReady,
                },
            }),
        );
    socket.on('message', (raw) => {
        const message = JSON.parse(String(raw));
        if (message.type !== 'command' || message.data.command !== 'SCREENSHOT_NOW') return;
        commands.push(message.data);
        socket.send(
            JSON.stringify({
                type: 'command_ack',
                sessionId: device.deviceId,
                data: {
                    command: 'SCREENSHOT_NOW',
                    commandId: message.data.commandId,
                    result: captureReady ? 'accepted' : 'rejected',
                    ...(!captureReady ? { reasonCode: 'projection_permission_required' } : {}),
                },
            }),
        );
    });
    try {
        sendStatus();
        await page.goto(`/devices/${device.localId}`);
        await page.getByRole('button', { name: '实时查看截图', exact: true }).click();
        await expect.poll(() => commands.length).toBe(1);
        captureReady = true;
        sendStatus();
        await expect.poll(() => commands.length).toBe(2);
        const { commandId, params } = commands.at(-1);
        const grant = await page.request.post('/api/device/screenshot-session', {
            headers,
            data: {
                deviceId: device.deviceId,
                reason: 'viewer_request',
                commandId,
                viewerId: params.viewerId,
            },
        });
        expect(grant.status()).toBe(201);
        const { uploadId } = await grant.json();
        const buffer = await sharp({
            create: { width: 360, height: 800, channels: 3, background: '#398f75' },
        })
            .jpeg()
            .toBuffer();
        const uploaded = await page.request.post('/api/device/screenshot', {
            headers: { ...headers, 'X-Capture-Upload': uploadId },
            multipart: {
                deviceId: device.deviceId,
                apkId,
                ts: String(Date.now()),
                file: { name: 'synthetic.jpg', mimeType: 'image/jpeg', buffer },
            },
        });
        expect(uploaded.status()).toBe(201);
        await expect(page.getByRole('img', { name: '设备实时上报的最新截图' })).toBeVisible();
        sendStatus();
        // A repeated heartbeat is processed before the next distinct mode transition.
        mode = 'accessibility';
        sendStatus();
        await expect.poll(() => commands.length).toBe(3);
        await page.goto('/');
        mode = 'projection';
        sendStatus();
        await page.request.get('/api/health');
        expect(commands.length).toBe(3);
    } finally {
        socket.close();
        const removed = await page.request.delete(`/api/devices/${device.localId}`, {
            headers: { 'X-Boundary-Request': '1' },
            data: {},
        });
        expect(removed.status()).toBe(200);
    }
});
