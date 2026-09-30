import { test, expect } from '@playwright/test';

test('single-line toolbar and cached online filtering across pages send zero requests or commands', async ({
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
        installed_at: null,
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
    await page.getByRole('button', { name: '清除筛选', exact: true }).click();
    const row = page.locator('.fleet-device-row').first();
    await expect(row.locator('.pending-cell')).toHaveCount(6);
    expect(await row.locator('.pending-cell').allTextContents()).toEqual(['', '', '', '', '', '']);
    for (const viewport of [
        { width: 1920, height: 900 },
        { width: 1280, height: 800 },
        { width: 800, height: 800 },
    ]) {
        await page.setViewportSize(viewport);
        await page.evaluate(() => window.scrollTo(0, 0));
        const toolbar = page.locator('.fleet-toolbar');
        const boxes = await toolbar
            .locator(':scope > div, :scope > button, .fleet-filter-chip')
            .evaluateAll((elements) =>
                elements.map((element) => {
                    const rect = element.getBoundingClientRect();
                    return { center: rect.top + rect.height / 2 };
                }),
            );
        const centers = boxes.map((box) => box.center);
        expect(Math.max(...centers) - Math.min(...centers)).toBeLessThanOrEqual(1);
        expect((await toolbar.boundingBox()).height).toBe(50);
        await page.screenshot({
            path: `test-results/device-toolbar-${viewport.width}.png`,
            fullPage: true,
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
});
