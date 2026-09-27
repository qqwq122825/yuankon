import { test, expect } from '@playwright/test';
import sharp from 'sharp';

test('APK ownership, enrollment and an actual synthetic JPEG are visible in the existing console', async ({
    page,
}) => {
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.goto('/login');
    await page.getByRole('textbox', { name: '账号', exact: true }).fill('mtx');
    await page.getByLabel('密码', { exact: true }).fill('mtx123');
    await page.getByRole('button', { name: '登录', exact: true }).click();
    await expect(page).toHaveURL('/');
    await page.goto('/builds');
    await page.getByLabel('新 APK ID').fill('E2EAPK');
    await page.getByRole('button', { name: '保存 APK 归属' }).click();
    await expect(page.getByLabel('已配置 APK ID')).toHaveValue('E2EAPK');
    await page.getByRole('button', { name: '生成设备登记码' }).click();
    const tokenField = page.getByLabel('设备登记码（只在本页显示）');
    await expect(tokenField).toHaveValue(/^ey/);
    const enrollment = await tokenField.inputValue();
    const headers = { 'X-Boundary-Request': '1', Authorization: `Bearer ${enrollment}` };
    const register = await page.request.post('/api/client/register', {
        headers,
        data: { deviceId: 'E2E_SCREEN_DEVICE', apkId: 'E2EAPK', model: '合成截图测试设备' },
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
            apkId: 'E2EAPK',
            ts: String(Date.now()),
            batch: '',
            buildId: 'synthetic',
            file: { name: 'synthetic.jpg', mimeType: 'image/jpeg', buffer },
        },
    });
    expect(upload.status()).toBe(201);
    await page.goto(`/devices/${device.localId}`);
    await expect(page.getByText('E2EAPK / mtx')).toBeVisible();
    await page.getByRole('button', { name: '设备上报截图', exact: true }).click();
    const panel = page.getByRole('region', { name: '设备上报截图', exact: true });
    const image = panel.getByRole('img', { name: '设备主动上报的单张截图' });
    await expect(image).toBeVisible();
    await expect.poll(() => image.evaluate((el) => el.naturalWidth)).toBe(300);
    await expect(panel).toContainText('非实时画面');
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
