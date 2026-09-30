import { test, expect } from '@playwright/test';

test('responsive toolbar and cached online/date filtering send zero requests or commands', async ({
    page,
}) => {
    const rows = Array.from({ length: 18 }, (_, i) => ({
        id: i + 1,
        public_id: `CACHE-${String(i + 1).padStart(3, '0')}`,
        name: `缓存测试 ${i + 1}`,
        source: 'api',
        status: i === 15 || i === 16 ? 'online' : 'offline',
        accessibility_enabled: i !== 16,
        is_blacklisted: false,
        owner_username: 'mtx',
        memo_count: 0,
        note: '',
        battery: null,
        brand: 'Fixture',
        android_version: '14',
        app_name: 'Fixture',
        app_version: '1.7.4',
        installed_at: i === 16 ? Date.UTC(2026, 8, 30, 15, 59, 59) : Date.UTC(2026, 8, 30, 16),
    }));
    await page.route('**/api/devices?*perPage=500*', (route) => {
        const query = new URL(route.request().url()).searchParams;
        return route.fulfill({
            json: {
                data: rows,
                total: rows.length,
                page: 1,
                perPage: 500,
                filters: { sort: query.get('sort'), direction: query.get('direction') },
                stats: { devices: 18, online: 2, periods: [] },
            },
        });
    });
    const sockets = [];
    page.on('websocket', (socket) =>
        socket.on('framesent', (event) => sockets.push(String(event.payload))),
    );
    await page.goto('/login');
    await page.getByRole('textbox', { name: '账号', exact: true }).fill('mtx');
    await page.getByLabel('密码', { exact: true }).fill('mtx123');
    await page.getByRole('button', { name: '登录', exact: true }).click();
    await expect(page.locator('.fleet-device-row')).toHaveCount(10);
    await expect(page.getByText('WS · 已连接')).toBeVisible();
    await expect(page.locator('.fleet-table-wrap')).toHaveAttribute('aria-busy', 'false');
    // Allow the initial bot_list-driven cache refresh to finish before the observation window.
    await page.waitForTimeout(400);
    await expect(page.locator('.fleet-table-wrap')).toHaveAttribute('aria-busy', 'false');
    const requests = [];
    page.on('request', (request) => {
        if (new URL(request.url()).pathname.startsWith('/api/')) requests.push(request.url());
    });
    sockets.length = 0;
    const filter = page.getByRole('button', { name: '在线', exact: true });
    await filter.click();
    await expect(page.locator('.fleet-device-row')).toHaveCount(2);
    await expect(page.locator('.fleet-pagination')).toContainText('共 2 条');
    await expect(page.locator('.fleet-device-row').first()).toHaveAttribute('data-device-id', '16');
    await page.getByRole('checkbox', { name: '选择当前页' }).check();
    await expect(page.getByText('已选择 2 台')).toBeVisible();
    await page.getByRole('button', { name: '无障碍', exact: true }).click();
    await expect(page.locator('.fleet-device-row')).toHaveCount(1);
    await expect(page.getByText('已选择 1 台')).toBeVisible();
    await page.goBack();
    await expect(page.locator('.fleet-device-row')).toHaveCount(2);
    await page.goForward();
    await expect(page.locator('.fleet-device-row')).toHaveCount(1);
    await page.getByRole('button', { name: '清除筛选', exact: true }).click();
    await page.getByRole('button', { name: '下一页', exact: true }).click();
    await expect(page.locator('.fleet-device-row')).toHaveCount(8);
    await filter.click();
    await expect(page.locator('.fleet-device-row')).toHaveCount(2);
    await page.waitForTimeout(350);
    expect(requests).toEqual([]);
    expect(sockets).toEqual([]);
    console.log('LOCAL_FILTER PASS: HTTP requests=0; WS frames=0; cross-page online rows=2');
    const date = page.getByLabel('按安装日期筛选', { exact: true });
    await date.fill('2026-10-01');
    await expect(page).toHaveURL(/installedDate=2026-10-01/);
    await expect(page.locator('.fleet-device-row')).toHaveCount(1);
    await expect(page.locator('.fleet-device-row').first()).toHaveAttribute('data-device-id', '16');
    expect(requests).toEqual([]);
    expect(sockets).toEqual([]);
    await page.getByRole('button', { name: '清除筛选', exact: true }).click();
    await expect(date).toHaveValue('');
    const row = page.locator('.fleet-device-row').first();
    await expect(row.locator('.pending-cell')).toHaveCount(6);
    expect(await row.locator('.pending-cell').allTextContents()).toEqual(['', '', '', '', '', '']);
    for (const viewport of [
        { width: 1920, height: 900 },
        { width: 1280, height: 800 },
        { width: 1181, height: 800 },
        { width: 1180, height: 800 },
        { width: 800, height: 800 },
    ]) {
        await page.setViewportSize(viewport);
        await page.evaluate(() => window.scrollTo(0, 0));
        const toolbar = page.locator('.fleet-toolbar');
        const primary = await page.locator('.fleet-toolbar-primary').boundingBox();
        const filters = await page.locator('.fleet-filter-strip').boundingBox();
        const dateBox = await page.locator('.fleet-date-filter').boundingBox();
        const toolbarBox = await toolbar.boundingBox();
        expect(Math.abs(dateBox.y - primary.y)).toBeLessThanOrEqual(1);
        expect(toolbarBox.x + toolbarBox.width).toBeLessThanOrEqual(viewport.width + 1);
        if (viewport.width <= 1180) {
            expect(filters.y).toBeGreaterThanOrEqual(primary.y + primary.height + 6);
            expect(dateBox.x + dateBox.width).toBeCloseTo(toolbarBox.x + toolbarBox.width - 12, 0);
            expect(toolbarBox.height).toBe(90);
        } else {
            expect(Math.abs(filters.y - primary.y)).toBeLessThanOrEqual(1);
            expect(toolbarBox.height).toBe(50);
        }
        await page.screenshot({
            path: `test-results/device-toolbar-${viewport.width}.png`,
            fullPage: true,
        });
        if (viewport.width === 800)
            await page.screenshot({
                path: 'test-results/device-toolbar-narrow-preview.png',
                clip: { x: 0, y: 0, width: 800, height: 160 },
            });
    }
    await filter.focus();
    await page.keyboard.press('Enter');
    await expect(filter).toHaveAttribute('aria-pressed', 'true');
    expect(requests).toEqual([]);
    expect(sockets).toEqual([]);
    // An explicit refresh is still real, unlike a quick filter.
    await page.getByRole('button', { name: '刷新状态', exact: true }).click();
    await expect.poll(() => requests.filter((url) => url.includes('perPage=500')).length).toBe(1);
    console.log(
        'RESPONSIVE PASS: wide=50px; narrow=90px/two rows; date top-right; date filter HTTP=0 WS=0',
    );
});
