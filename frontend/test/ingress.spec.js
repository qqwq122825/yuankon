import { test, expect } from '@playwright/test';
import sharp from 'sharp';

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
    const grant = await page.request.post('/api/device/screenshot-session', {
        headers: deviceHeaders,
        data: { deviceId: device.deviceId, consent: true },
    });
    expect(grant.status()).toBe(201);
    const { uploadId } = await grant.json();
    const buffer = await sharp({
        create: { width: 300, height: 480, channels: 3, background: '#397b93' },
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
    await expect(page.getByRole('img', { name: '合成截图测试设备 临时首图缩略图' })).toBeVisible();
    await page.goto(`/devices/${device.localId}`);
    await expect(page.getByText(`${apkId} / mtx`)).toBeVisible();
    await page.getByRole('button', { name: '实时查看截图', exact: true }).click();
    const panel = page.getByRole('region', { name: '设备上报截图', exact: true });
    const image = panel.getByRole('img', { name: '设备实时上报的最新截图' });
    await expect(image).toBeVisible();
    await expect.poll(() => image.evaluate((el) => el.naturalWidth)).toBe(300);
    await expect(panel).toContainText('实时最新帧');
    await page.setViewportSize({ width: 800, height: 780 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeGreaterThanOrEqual(
        1280,
    );
    await page.screenshot({ path: 'test-results/synthetic-device-ingress.png', fullPage: true });
    await image.click();
    await page.keyboard.press('Escape');
    await expect(panel).toHaveCount(0);
    expect(errors).toEqual([]);
});
