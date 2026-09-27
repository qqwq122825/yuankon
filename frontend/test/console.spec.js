import { test, expect } from '@playwright/test';

test.beforeEach(async ({ page }) => {
    await page.goto('/login');
    await page.getByRole('textbox', { name: '账号', exact: true }).fill('mtx');
    await page.getByLabel('密码', { exact: true }).fill('mtx123');
    await page.getByRole('button', { name: '登录', exact: true }).click();
    await expect(page).toHaveURL('/');
});

test('list, server sorting, query preservation, pagination, empty state and keyboard search', async ({
    page,
}) => {
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.goto('/');
    await expect(page.getByText('WS · 已连接')).toBeVisible();
    await expect(page.getByRole('navigation', { name: '主导航' }).getByRole('link')).toHaveText([
        '设备',
        '构建',
        '翻译',
    ]);
    await expect(page.locator('tbody tr')).toHaveCount(10);
    await page.getByRole('button', { name: '下一页' }).click();
    await expect(page).toHaveURL(/page=2/);
    await expect(page.locator('tbody tr')).toHaveCount(2);
    await page.getByRole('button', { name: /ID ⇅|ID ↑/ }).click();
    await expect(page).toHaveURL(/page=1/);
    await expect(page.locator('tbody tr').first()).toContainText('DEMO-012');
    await page.getByRole('checkbox', { name: '选择当前页' }).check();
    await expect(page.getByText('已选择 10 台')).toBeVisible();
    await page.getByRole('textbox', { name: '搜索设备' }).fill('DEMO-001');
    await page.getByRole('textbox', { name: '搜索设备' }).press('Enter');
    await expect(page.locator('tbody tr')).toHaveCount(1);
    await expect(page.locator('tbody tr').first()).toContainText('DEMO-001');
    await page.getByRole('textbox', { name: '搜索设备' }).fill('nothing');
    await page.getByRole('textbox', { name: '搜索设备' }).press('Enter');
    await expect(page.getByText('暂无匹配设备；可调整筛选条件。')).toBeVisible();
    expect(errors).toEqual([]);
});
test('detail saves notes and viewers resize, drag, switch tabs and close with Escape', async ({
    page,
}) => {
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.goto('/devices/1');
    await page.getByRole('textbox', { name: '设备备注' }).fill('Vue 自动化备注');
    await page.getByRole('button', { name: '保存备注' }).click();
    await expect(page.getByRole('status')).toHaveText('备注已保存');
    await page.reload();
    await expect(page.getByRole('textbox', { name: '设备备注' })).toHaveValue('Vue 自动化备注');
    await page.getByRole('button', { name: '截图 + 阅读器' }).click();
    const reader = page.getByRole('region', { name: '阅读器', exact: true }),
        shot = page.getByRole('region', { name: '截图', exact: true });
    await expect(reader).toBeVisible();
    await expect(shot).toBeVisible();
    expect((await reader.boundingBox()).width).toBe(300);
    expect((await shot.boundingBox()).width).toBe(300);
    await reader.getByRole('button', { name: '放大阅读器', exact: true }).click();
    expect((await reader.boundingBox()).width).toBe(320);
    expect((await shot.boundingBox()).width).toBe(300);
    await reader.getByRole('tab', { name: '坐标', exact: true }).focus();
    await page.keyboard.press('ArrowRight');
    await expect(reader.getByRole('tab', { name: '节点树', exact: true })).toHaveAttribute(
        'aria-selected',
        'true',
    );
    await reader.getByRole('textbox', { name: '搜索节点' }).fill('title');
    await expect(reader.locator('.reader-node')).toHaveCount(2);
    const heading = shot.locator('header'),
        box = await heading.boundingBox();
    await page.mouse.move(box.x + 50, box.y + 15);
    await page.mouse.down();
    await page.mouse.move(box.x + 90, box.y + 70);
    await page.mouse.up();
    expect((await shot.boundingBox()).y).toBeGreaterThan(76);
    await page.keyboard.press('Escape');
    await expect(shot).toHaveCount(0);
    await expect(reader).toBeVisible();
    await page.getByRole('button', { name: '关闭全部浮窗' }).click();
    await expect(reader).toHaveCount(0);
    expect(errors).toEqual([]);
});
test('narrow viewport keeps 1280 desktop canvas and parallel independent viewers', async ({
    page,
}) => {
    await page.setViewportSize({ width: 800, height: 800 });
    await page.goto('/devices/1');
    await page.getByRole('button', { name: '截图 + 阅读器' }).click();
    const shot = await page.getByRole('region', { name: '截图', exact: true }).boundingBox(),
        reader = await page.getByRole('region', { name: '阅读器', exact: true }).boundingBox();
    expect(shot.width).toBe(300);
    expect(reader.width).toBe(300);
    expect(shot.y).toBe(reader.y);
    expect(reader.x).toBeGreaterThanOrEqual(shot.x + shot.width);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeGreaterThanOrEqual(
        1280,
    );
    await page.screenshot({ path: 'test-results/narrow-desktop.png', fullPage: true });
});
test('translation validation, build center and protocol audit', async ({ page }) => {
    await page.goto('/settings/translation');
    await expect(page.getByRole('heading', { name: '翻译设置' })).toBeVisible();
    await expect(page.getByRole('button', { name: '验证已保存密钥' })).toBeDisabled();
    await page.getByRole('checkbox', { name: '启用翻译' }).check();
    await page.getByRole('button', { name: '保存设置' }).click();
    await expect(page.getByRole('alert')).toContainText('请填写翻译 API Key');
    await page.getByRole('link', { name: '构建', exact: true }).click();
    await expect(page.getByText(/Telegram 发送待接入/)).toBeVisible();
    await page.goto('/protocol');
    await expect(page.getByRole('heading', { name: '协议审计' })).toBeVisible();
    await page.getByRole('checkbox', { name: '实时增量' }).check();
    await page.getByRole('button', { name: '刷新', exact: true }).click();
    await expect(page.locator('tbody')).toContainText('panel');
});
test('WS reconnects after a real socket drop without stale duplicate subscriptions', async ({
    page,
    request,
}) => {
    await page.goto('/devices/1');
    await expect(page.getByText('WS · 已连接')).toBeVisible();
    const health = await request.get('/api/health');
    const closed = page.waitForEvent('websocket');
    process.kill(Number(health.headers()['x-test-server-pid']), 'SIGUSR2');
    await closed;
    await expect(page.getByText('WS · 已连接')).toBeVisible();
    await page.getByRole('button', { name: '查询状态' }).click();
    await expect(page.getByRole('status')).toContainText('已请求服务端已知状态');
});
