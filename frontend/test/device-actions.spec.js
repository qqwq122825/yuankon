import { test, expect } from '@playwright/test';

test('row navigation, keyboard and checkboxes are independent of blacklist/delete actions', async ({
    page,
}) => {
    await page.goto('/login');
    await page.getByRole('textbox', { name: '账号', exact: true }).fill('mtx');
    await page.getByLabel('密码', { exact: true }).fill('mtx123');
    await page.getByRole('button', { name: '登录', exact: true }).click();
    await expect(page).toHaveURL('/');
    const headers = { 'X-Boundary-Request': '1' };
    expect(
        (
            await page.request.post('/api/apk-routes', { headers, data: { apkId: 'ROW_ACTIONS' } })
        ).status(),
    ).toBe(201);
    const enrollment = await page.request.post('/api/device-enrollments', {
        headers,
        data: { apkId: 'ROW_ACTIONS' },
    });
    const { enrollmentToken } = await enrollment.json();
    const response = await page.request.post('/api/client/register', {
        headers: { ...headers, Authorization: `Bearer ${enrollmentToken}` },
        data: { apkId: 'ROW_ACTIONS', deviceId: 'ROW_ACTIONS_DEVICE', model: '列表操作测试设备' },
    });
    const device = await response.json();
    expect(response.status()).toBe(201);
    const query = '/?q=ROW_ACTIONS_DEVICE&source=api&sort=id&direction=asc&page=1';
    await page.goto(query);
    const row = page.locator(`tr[data-device-id="${device.localId}"]`);
    await expect(row).toBeVisible();
    await expect(row.getByRole('button')).toHaveText(['拉黑', '删除']);
    await expect(page.getByRole('columnheader', { name: /^节点/ })).toHaveCount(0);
    await expect(row.getByRole('link', { name: '查看', exact: true })).toHaveCount(0);
    await row.getByRole('checkbox').check();
    await expect(page).toHaveURL(query);
    await expect(page.getByText('已选择 1 台')).toBeVisible();
    await row.locator('td').nth(1).click();
    await expect(page).toHaveURL(`/devices/${device.localId}`);
    await page.goto(query);
    await row.focus();
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(`/devices/${device.localId}`);
    await page.goto(query);
    page.once('dialog', (d) => d.dismiss());
    await row.getByRole('button', { name: '拉黑', exact: true }).click();
    await expect(row.getByRole('button', { name: '拉黑', exact: true })).toBeVisible();
    page.once('dialog', (d) => d.accept());
    await row.getByRole('button', { name: '拉黑', exact: true }).focus();
    await page.keyboard.press('Enter');
    await expect(row.getByText('已拉黑', { exact: true })).toBeVisible();
    await expect(page).toHaveURL(query);
    page.once('dialog', (d) => d.accept());
    await row.getByRole('button', { name: '取消拉黑', exact: true }).click();
    await expect(row.getByRole('button', { name: '拉黑', exact: true })).toBeVisible();
    await page.screenshot({ path: 'test-results/device-row-actions-desktop.png', fullPage: true });
    await page.setViewportSize({ width: 800, height: 800 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeGreaterThanOrEqual(
        1280,
    );
    await page.screenshot({ path: 'test-results/device-row-actions-narrow.png', fullPage: true });
    page.once('dialog', (d) => d.dismiss());
    await row.getByRole('button', { name: '删除', exact: true }).click();
    await expect(row).toBeVisible();
    page.once('dialog', (d) => d.accept());
    await row.getByRole('button', { name: '删除', exact: true }).click();
    await expect(row).toHaveCount(0);
    await expect(page).toHaveURL(query);
    await expect(page.getByText('暂无匹配设备；可调整筛选条件。')).toBeVisible();
});
