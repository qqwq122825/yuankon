import { test, expect } from '@playwright/test';

function fixtureRows(count, onlineCount = count) {
    return Array.from({ length: count }, (_, index) => ({
        id: index + 1,
        public_id: `FOOTER-${String(index + 1).padStart(3, '0')}`,
        name: `分页合成测试 ${index + 1}`,
        source: 'api',
        status: index < onlineCount ? 'online' : 'offline',
        accessibility_enabled: true,
        is_blacklisted: false,
        owner_username: 'mtx',
        memo_count: 0,
        note: '',
        battery: null,
        brand: 'Fixture',
        android_version: '14',
        app_name: 'Fixture',
        app_version: '1.0',
        installed_at: Date.UTC(2026, 9, 1, 0, 0),
    }));
}

function responseForRows(rows, url) {
    const query = new URL(url).searchParams;
    return {
        json: {
            data: rows,
            total: rows.length,
            page: 1,
            perPage: 500,
            filters: { sort: query.get('sort'), direction: query.get('direction') },
            stats: {
                devices: rows.length,
                online: rows.filter((row) => row.status === 'online').length,
                periods: [],
            },
        },
    };
}

async function loginWithRows(page, rows) {
    await page.route('**/api/devices?*perPage=500*', (route) =>
        route.fulfill(responseForRows(rows, route.request().url())),
    );
    await page.goto('/login');
    await page.getByRole('textbox', { name: '账号', exact: true }).fill('mtx');
    await page.getByLabel('密码', { exact: true }).fill('mtx123');
    await page.getByRole('button', { name: '登录', exact: true }).click();
    await expect(page.getByText('WS · 已连接')).toBeVisible();
    await expect(page.locator('.fleet-table-wrap')).toHaveAttribute('aria-busy', 'false');
    // The initial bot_list message refreshes the list once; finish it before local pagination.
    await page.waitForTimeout(400);
    await expect(page.locator('.fleet-table-wrap')).toHaveAttribute('aria-busy', 'false');
}

async function expectFooterGeometry(page, { short = false } = {}) {
    const viewport = page.viewportSize();
    const footer = await page.locator('.fleet-pagination').boundingBox();
    const rail = await page.locator('.console-rail').boundingBox();
    const center = await page.locator('.fleet-pagination-center').boundingBox();
    expect(footer.x).toBeCloseTo(rail.width, 0);
    expect(footer.width).toBeCloseTo(viewport.width - rail.width, 0);
    expect(footer.height).toBeCloseTo(45, 0);
    expect(footer.y + footer.height).toBeCloseTo(viewport.height, 0);
    expect(
        Math.abs(center.x + center.width / 2 - (footer.x + footer.width / 2)),
    ).toBeLessThanOrEqual(1);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeGreaterThanOrEqual(
        1280,
    );
    if (short) {
        const table = await page.locator('.fleet-table').boundingBox();
        expect(footer.y - (table.y + table.height)).toBeGreaterThan(100);
        await expect(page.locator('body.console-fleet')).toHaveCSS(
            'background-color',
            'rgb(255, 255, 255)',
        );
    }
    return footer;
}

async function expectCurrentPage(page, number) {
    const nav = page.getByRole('navigation', { name: '设备分页', exact: true });
    await expect(nav.getByRole('button', { name: `第 ${number} 页`, exact: true })).toHaveAttribute(
        'aria-current',
        'page',
    );
    await expect(nav.locator('[aria-current="page"]')).toHaveCount(1);
    return nav;
}

test('short and empty device lists fill the canvas and keep centered pagination at the visible bottom', async ({
    page,
}) => {
    await loginWithRows(page, fixtureRows(5));
    await expect(page.locator('.fleet-device-row')).toHaveCount(5);
    await expect(page.locator('.fleet-pagination-summary')).toHaveText('共 5 台');
    await expectCurrentPage(page, 1);
    await expect(page.getByRole('button', { name: '上一页', exact: true })).toHaveCount(0);
    await expect(page.getByRole('button', { name: '下一页', exact: true })).toHaveCount(0);
    await expect(page.locator('.fleet-pagination .visually-hidden')).toHaveText('本地数据');
    await expect(page.locator('.fleet-pagination .visually-hidden')).toHaveCSS('height', '1px');
    await expect(page.locator('.fleet-pagination')).not.toContainText('示例不代表真机在线');
    for (const theme of ['light', 'dark']) {
        if (theme === 'dark') {
            await page.getByRole('button', { name: '切换明暗主题', exact: true }).click();
            await expect(page.locator('html')).toHaveAttribute('data-bs-theme', 'dark');
        }
        for (const size of [
            { width: 1440, height: 900 },
            { width: 1280, height: 900 },
            { width: 800, height: 900 },
        ]) {
            await page.setViewportSize(size);
            await page.evaluate(() => window.scrollTo(0, 0));
            const before = await expectFooterGeometry(page, { short: theme === 'light' });
            const current = page
                .getByRole('navigation', { name: '设备分页', exact: true })
                .getByRole('button', { name: '第 1 页', exact: true });
            await expect(current).toBeVisible();
            await expect(current).not.toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
            await page.screenshot({ path: `test-results/footer-${theme}-${size.width}.png` });
            if (size.width === 800) {
                await page.evaluate(() => window.scrollTo(400, 0));
                await expect.poll(() => page.evaluate(() => window.scrollX)).toBeGreaterThan(0);
                const after = await expectFooterGeometry(page);
                expect(after.x).toBeCloseTo(before.x, 0);
                await expect(current).toBeVisible();
                expect(
                    await page.evaluate(
                        ({ x, y }) =>
                            Boolean(document.elementFromPoint(x, y)?.closest('.fleet-pagination')),
                        { x: size.width / 2, y: size.height - 20 },
                    ),
                ).toBe(true);
            }
        }
    }
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.evaluate(() => window.scrollTo(0, 0));
    let finishRefresh;
    const refreshGate = new Promise((resolve) => (finishRefresh = resolve));
    await page.route('**/api/devices?*perPage=500*', async (route) => {
        await refreshGate;
        await route.fulfill(responseForRows(fixtureRows(5), route.request().url()));
    });
    const refresh = page.getByRole('button', { name: '刷新状态', exact: true });
    await refresh.click();
    await expect(refresh).toBeDisabled();
    await expect(page.getByRole('button', { name: '第 1 页', exact: true })).toBeDisabled();
    await expect(page.locator('.fleet-pagination-summary')).toHaveText('共 5 台');
    await expectFooterGeometry(page);
    finishRefresh();
    await expect(refresh).toBeEnabled();
    await expect(page.getByRole('button', { name: '第 1 页', exact: true })).toBeEnabled();
    await page.getByRole('checkbox', { name: '选择当前页', exact: true }).check();
    await expect(page.getByText('已选择 5 台', { exact: true })).toBeVisible();
    await expectFooterGeometry(page);
    await page.getByRole('button', { name: '离线', exact: true }).click();
    await expect(page.locator('.fleet-device-row')).toHaveCount(0);
    await expect(page.locator('.fleet-pagination-summary')).toHaveText('共 0 台');
    await expect(page.getByText('暂无匹配设备；可调整筛选条件。', { exact: true })).toBeVisible();
    await expectCurrentPage(page, 1);
    await expect(page.getByRole('button', { name: '上一页', exact: true })).toHaveCount(0);
    await expect(page.getByRole('button', { name: '下一页', exact: true })).toHaveCount(0);
    await expect(page.getByText('已选择 5 台', { exact: true })).toHaveCount(0);
    await expectFooterGeometry(page);
    const current = page.getByRole('button', { name: '第 1 页', exact: true });
    await current.focus();
    await page.keyboard.press('Enter');
    await expectCurrentPage(page, 1);
    await expect(page).toHaveURL(/status=offline/);
    await page.screenshot({ path: 'test-results/footer-empty.png' });
    console.log(
        'FOOTER_GEOMETRY PASS: 45px bottom bar; visible-content centered; light/dark 1440/1280/800; horizontal scroll anchored; zero rows',
    );
});

test('numbered, previous and next pages preserve filters and support keyboard without new device requests', async ({
    page,
}) => {
    await loginWithRows(page, fixtureRows(30, 23));
    const requests = [];
    page.on('request', (request) => {
        if (new URL(request.url()).pathname === '/api/devices') requests.push(request.url());
    });
    await page.getByRole('button', { name: '在线', exact: true }).click();
    await expect(page.locator('.fleet-pagination-summary')).toHaveText('共 23 台');
    await expectCurrentPage(page, 1);
    await expect(page.getByRole('button', { name: '上一页', exact: true })).toBeDisabled();
    const last = page.getByRole('button', { name: '第 3 页', exact: true });
    await last.focus();
    await page.keyboard.press('Enter');
    await expectCurrentPage(page, 3);
    await expect(page).toHaveURL(/status=online/);
    await expect(page).toHaveURL(/page=3/);
    await expect(page.locator('.fleet-device-row')).toHaveCount(3);
    await expect(page.locator('.fleet-device-row').first()).toHaveAttribute('data-device-id', '21');
    await expect(page.getByRole('button', { name: '下一页', exact: true })).toBeDisabled();
    await page.getByRole('checkbox', { name: '选择当前页', exact: true }).check();
    await expect(page.getByText('已选择 3 台', { exact: true })).toBeVisible();
    await expectFooterGeometry(page);
    const previous = page.getByRole('button', { name: '上一页', exact: true });
    await previous.focus();
    await page.keyboard.press('Enter');
    await expectCurrentPage(page, 2);
    await expect(page).toHaveURL(/status=online/);
    await expect(page.locator('.fleet-device-row')).toHaveCount(10);
    await expect(page.locator('.fleet-device-row').first()).toHaveAttribute('data-device-id', '11');
    await expect(page.getByText('已选择 3 台', { exact: true })).toHaveCount(0);
    await page.getByRole('button', { name: '第 1 页', exact: true }).click();
    await expectCurrentPage(page, 1);
    await page.getByRole('button', { name: '下一页', exact: true }).click();
    await expectCurrentPage(page, 2);
    await expect(page).toHaveURL(/status=online/);
    expect(requests).toEqual([]);
    await expectFooterGeometry(page);
    await page.screenshot({ path: 'test-results/footer-multipage.png' });
    console.log(
        'FOOTER_PAGINATION PASS: keyboard page3/previous; numbered and next page2; status filter retained; requests=0',
    );
});

test('large page ranges keep first, last and current pages in a bounded window', async ({
    page,
}) => {
    await loginWithRows(page, fixtureRows(180));
    const nav = page.getByRole('navigation', { name: '设备分页', exact: true });
    const assertWindow = async () => {
        const numbers = nav.getByRole('button', { name: /^第 \d+ 页$/ });
        expect(await numbers.count()).toBeLessThanOrEqual(7);
        await expect(nav.getByRole('button', { name: '第 1 页', exact: true })).toBeVisible();
        await expect(nav.getByRole('button', { name: '第 18 页', exact: true })).toBeVisible();
        await expect(nav).toContainText('…');
    };
    await assertWindow();
    await nav.getByRole('button', { name: '第 18 页', exact: true }).click();
    await expectCurrentPage(page, 18);
    await expect(page.locator('.fleet-device-row').first()).toHaveAttribute(
        'data-device-id',
        '171',
    );
    await expect(page.getByRole('button', { name: '下一页', exact: true })).toBeDisabled();
    await assertWindow();
    await page.goto('/?page=9');
    await expectCurrentPage(page, 9);
    await expect(page.locator('.fleet-device-row').first()).toHaveAttribute('data-device-id', '81');
    await assertWindow();
    await page.setViewportSize({ width: 800, height: 500 });
    await page.evaluate(() => window.scrollTo(400, 350));
    await expectFooterGeometry(page);
    await page.screenshot({ path: 'test-results/footer-page-window.png' });
    console.log(
        'FOOTER_WINDOW PASS: 18 pages; first/last/current reachable; at most 7 numbered buttons; narrow 800px anchored',
    );
});
