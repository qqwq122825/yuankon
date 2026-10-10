import { test, expect } from '@playwright/test';

async function openMoreViewing(page) {
    const extra = page.locator('details.device-viewer-extra');
    await expect(extra).toBeAttached();
    if ((await extra.getAttribute('open')) === null)
        await extra.locator(':scope > summary').click();
    await expect(extra).toHaveAttribute('open');
}

test('one-shot diagnostic report copies/exports only this session; details collapsed', async ({
    page,
    context,
}) => {
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);
    await page.goto('/login');
    await page.getByRole('textbox', { name: '账号', exact: true }).fill('mtx');
    await page.getByLabel('密码', { exact: true }).fill('mtx123');
    await page.getByRole('button', { name: '登录', exact: true }).click();
    await expect(page).toHaveURL('/');
    const { user } = await (await page.request.get('/api/auth/me')).json();
    const headers = { 'X-Boundary-Request': '1' };
    const device = await (
        await page.request.post('/api/client/online', {
            headers,
            data: { deviceId: 'E2E_DIAGNOSTIC', apkId: user.apkId, model: '合成诊断设备' },
        })
    ).json();
    await page.goto(`/devices/${device.localId}`);
    await openMoreViewing(page);
    await page.getByRole('button', { name: '实时查看截图', exact: true }).click();
    const shot = page.getByRole('region', { name: 'BM截图', exact: true });
    expect((await shot.locator('.live-screenshot-stage').boundingBox()).height).toBe(96);
    await expect(shot.locator('.live-screenshot-stage')).toHaveClass(/live-screenshot-waiting/);
    await openMoreViewing(page);
    await page.getByRole('button', { name: '关闭全部浮窗', exact: true }).click();
    await page.getByRole('button', { name: 'API调试', exact: true }).click();
    await expect(page.locator('.debug-card details')).not.toHaveAttribute('open');
    await page.getByRole('button', { name: '开始诊断', exact: true }).click();
    await expect(page.getByRole('button', { name: '停止诊断', exact: true })).toBeEnabled();
    const session = await (
        await page.request.get(`/api/devices/${device.localId}/debug-session`)
    ).json();
    const report = await page.request.post('/api/device/debug-report', {
        headers: { ...headers, Authorization: `Bearer ${device.deviceToken}` },
        data: {
            sessionId: session.sessionId,
            events: [
                {
                    source: 'service',
                    stage: 'window_event',
                    message: 'synthetic Home',
                    details: { package: 'com.android.launcher3' },
                },
            ],
        },
    });
    expect(report.status()).toBe(200);
    await page.getByRole('button', { name: '停止诊断', exact: true }).click();
    await expect(page.getByRole('button', { name: '开始诊断', exact: true })).toBeEnabled();
    await page.getByRole('button', { name: '复制诊断报告', exact: true }).click();
    await expect(page.locator('.device-browser-toast')).toContainText('诊断报告已复制');
    const copied = JSON.parse(await page.evaluate(() => navigator.clipboard.readText()));
    expect(copied.sessionId).toBe(session.sessionId);
    expect(copied.events).toHaveLength(1);
    expect(copied.browserEvents[0].stage).toBe('diagnostic_started');
    expect(JSON.stringify(copied)).not.toContain('screenshot_path');
    const download = page.waitForEvent('download');
    await page.getByRole('button', { name: '导出 JSON', exact: true }).click();
    expect((await download).suggestedFilename()).toBe(`diagnostic-${session.sessionId}.json`);
    await page.screenshot({ path: 'test-results/diagnostic-180.png', fullPage: true });
    const removed = await page.request.delete(`/api/devices/${device.localId}`, {
        headers,
        data: {},
    });
    expect(removed.status()).toBe(200);
});
