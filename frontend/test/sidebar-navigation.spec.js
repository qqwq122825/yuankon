import { test, expect } from '@playwright/test';
import { randomUUID } from 'node:crypto';

const adminLinks = ['设备', '用户', 'AI', '注入', '构建', '推送', '拉黑', '性能', '翻译', '日志'];
const pendingModules = [{ path: '/performance', label: '性能' }];
const moduleApi = (pathname) => /^\/api\/(?:ai|injection|push|performance)(?:\/|$)/.test(pathname);

async function login(page) {
    await page.goto('/login');
    await page.getByLabel('账号', { exact: true }).fill('mtx');
    await page.getByLabel('密码', { exact: true }).fill('mtx123');
    await page.getByRole('button', { name: '登录', exact: true }).click();
    await expect(page).toHaveURL('/');
    await expect(page.locator('.console-help')).toHaveAccessibleName('WS · 已连接');
}

async function expectOnlyActive(page, label) {
    const nav = page.getByRole('navigation', { name: '主导航', exact: true });
    const selected = nav.getByRole('link', { name: label, exact: true });
    await expect(selected).toHaveClass(/active/);
    await expect(selected).toHaveAttribute('aria-current', 'page');
    await expect(nav.locator('a.active')).toHaveCount(1);
    await expect(nav.locator('a[aria-current="page"]')).toHaveCount(1);
}

function blacklistRows() {
    const flags = [...Array(25).fill(true), false, null, 'true', 1];
    return flags.map((is_blacklisted, index) => ({
        id: index + 1,
        public_id: `BLACKLIST-${String(index + 1).padStart(3, '0')}`,
        name: `拉黑合成测试 ${index + 1}`,
        source: 'api',
        status: 'offline',
        accessibility_enabled: (index + 1) % 2 === 0,
        is_blacklisted,
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

test('all sidebar entries have real routes and pending modules never send execution requests', async ({
    page,
}) => {
    await login(page);
    const nav = page.getByRole('navigation', { name: '主导航', exact: true });
    await expect(nav.getByRole('link')).toHaveText(adminLinks);
    await expectOnlyActive(page, '设备');
    const requests = [];
    page.on('request', (request) => {
        const pathname = new URL(request.url()).pathname;
        if (moduleApi(pathname) || ['POST', 'PATCH', 'PUT', 'DELETE'].includes(request.method()))
            requests.push({ method: request.method(), pathname });
    });
    for (const module of pendingModules) {
        await nav.getByRole('link', { name: module.label, exact: true }).focus();
        await page.keyboard.press('Enter');
        await expect(page).toHaveURL(module.path);
        await expect(page.getByRole('heading', { name: module.label, exact: true })).toBeVisible();
        await expect(page.getByText('待接入', { exact: true })).toBeVisible();
        await expectOnlyActive(page, module.label);
        const document = await page.reload();
        expect(document.status()).toBeLessThan(400);
        await expect(page).toHaveURL(module.path);
        await expect(page.getByRole('heading', { name: module.label, exact: true })).toBeVisible();
        await expect(page.getByText('待接入', { exact: true })).toBeVisible();
        await expectOnlyActive(page, module.label);
    }
    await nav.getByRole('link', { name: 'AI', exact: true }).focus();
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL('/ai');
    await expect(page.getByRole('heading', { name: 'AI 配置', exact: true })).toBeVisible();
    await expect(page.locator('.settings-page--centered')).toContainText('UI预览');
    await expect(page.locator('.settings-page--centered')).toContainText('未验证');
    await expectOnlyActive(page, 'AI');
    const aiDocument = await page.reload();
    expect(aiDocument.status()).toBeLessThan(400);
    await expect(page).toHaveURL('/ai');
    await expect(page.getByRole('heading', { name: 'AI 配置', exact: true })).toBeVisible();
    await expect(page.locator('.settings-page--centered')).toContainText('UI预览');
    await expect(page.locator('.settings-page--centered')).toContainText('未验证');
    await expectOnlyActive(page, 'AI');
    await nav.getByRole('link', { name: '注入', exact: true }).focus();
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL('/injection');
    await expect(page.getByRole('heading', { name: '注入管理', exact: true })).toBeVisible();
    await expect(page.locator('.injection-settings-page')).toContainText('UI预览');
    await expectOnlyActive(page, '注入');
    const injectionDocument = await page.reload();
    expect(injectionDocument.status()).toBeLessThan(400);
    await expect(page).toHaveURL('/injection');
    await expect(page.getByRole('heading', { name: '注入管理', exact: true })).toBeVisible();
    await expect(page.locator('.injection-settings-page')).toContainText('UI预览');
    await expectOnlyActive(page, '注入');
    await nav.getByRole('link', { name: '推送', exact: true }).focus();
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL('/push');
    await expect(page.getByRole('heading', { name: '推送面板', exact: true })).toBeVisible();
    await expect(page.locator('.push-settings-page')).toContainText('UI 预览');
    await expectOnlyActive(page, '推送');
    const pushDocument = await page.reload();
    expect(pushDocument.status()).toBeLessThan(400);
    await expect(page).toHaveURL('/push');
    await expect(page.getByRole('heading', { name: '推送面板', exact: true })).toBeVisible();
    await expect(page.locator('.push-settings-page')).toContainText('UI 预览');
    await expectOnlyActive(page, '推送');
    const blacklistEntry = await page.goto('/blacklist');
    expect(blacklistEntry.status()).toBeLessThan(400);
    await expect(page).toHaveURL('/blacklist');
    await expect(page.getByRole('heading', { name: '拉黑设备', exact: true })).toBeVisible();
    await expect(page.locator('.blacklist-count strong')).toHaveText('0');
    await expectOnlyActive(page, '拉黑');
    const blacklistDocument = await page.reload();
    expect(blacklistDocument.status()).toBeLessThan(400);
    await expect(page).toHaveURL('/blacklist');
    await expect(page.getByRole('heading', { name: '拉黑设备', exact: true })).toBeVisible();
    await expect(page.locator('.blacklist-count strong')).toHaveText('0');
    await expect(page.locator('.blacklist-table-wrap')).toHaveAttribute('aria-busy', 'false');
    await expectOnlyActive(page, '拉黑');
    expect(requests).toEqual([]);
    console.log(
        'SIDEBAR_MODULES PASS: admin links=10; performance pending click+reload; AI/injection/push UI preview click+reload; blacklist direct+reload; pending status; mutations=0; module APIs=0',
    );
});

test('blacklist cache is strict and keeps its own route while paging, sorting and searching', async ({
    page,
}) => {
    const rows = blacklistRows();
    await page.route('**/api/devices?*perPage=500*', (route) => {
        const query = new URL(route.request().url()).searchParams;
        const q = query.get('q') || '';
        const data = rows.filter((row) => !q || `${row.public_id} ${row.name}`.includes(q));
        return route.fulfill({
            json: {
                data,
                total: data.length,
                page: 1,
                perPage: 500,
                filters: { sort: query.get('sort'), direction: query.get('direction') },
                stats: { devices: rows.length, online: 0, periods: [] },
            },
        });
    });
    await login(page);
    const nav = page.getByRole('navigation', { name: '主导航', exact: true });
    await nav.getByRole('link', { name: '拉黑', exact: true }).click();
    await expect(page).toHaveURL('/blacklist');
    await expect(page.getByRole('heading', { name: '拉黑设备', exact: true })).toBeVisible();
    await expect(page.locator('.blacklist-count strong')).toHaveText('25');
    await expect(page.locator('.fleet-pagination-summary')).toHaveText('共 25 台');
    await expect(page.locator('.blacklist-row')).toHaveCount(10);
    await expectOnlyActive(page, '拉黑');
    await expect(nav.getByRole('link', { name: '设备', exact: true })).not.toHaveClass(/active/);
    await page.getByRole('button', { name: '第 2 页', exact: true }).click();
    expect(new URL(page.url()).pathname).toBe('/blacklist');
    await expect(page).toHaveURL(/page=2/);
    await expect(page.locator('.blacklist-row').first()).toHaveAttribute('data-device-id', '11');
    await page.getByRole('button', { name: /^设备 ID\s*[⇅↑↓]/ }).click();
    expect(new URL(page.url()).pathname).toBe('/blacklist');
    await expect(page).toHaveURL(/direction=desc/);
    await expect(page).toHaveURL(/page=1/);
    await expect(page.locator('.blacklist-row').first()).toHaveAttribute('data-device-id', '25');
    await expect(page.getByRole('button', { name: '无障碍', exact: true })).toHaveCount(0);
    await expect(page.getByRole('button', { name: '清除筛选', exact: true })).toHaveCount(0);
    const search = page.getByRole('textbox', { name: '搜索拉黑设备', exact: true });
    await search.fill('BLACKLIST-025');
    await search.press('Enter');
    expect(new URL(page.url()).pathname).toBe('/blacklist');
    await expect(page.locator('.blacklist-count strong')).toHaveText('1');
    await expect(page.locator('.blacklist-row')).toHaveCount(1);
    await expect(page.locator('.blacklist-row').first()).toHaveAttribute('data-device-id', '25');
    await search.fill('');
    await search.press('Enter');
    await expect(page.locator('.blacklist-count strong')).toHaveText('25');
    await page.screenshot({ path: 'test-results/blacklist-sidebar-cache.png' });
    await nav.getByRole('link', { name: '设备', exact: true }).click();
    await expect(page).toHaveURL('/');
    await expectOnlyActive(page, '设备');
    await expect(nav.getByRole('link', { name: '拉黑', exact: true })).not.toHaveClass(/active/);
    await expect(page.locator('.fleet-count strong')).toHaveText('29');
    await page.goto('/?blacklisted=1');
    await expect(page.locator('.fleet-count strong')).toHaveText('25');
    await expectOnlyActive(page, '设备');
    await page.getByRole('button', { name: '清除筛选', exact: true }).click();
    await expect(page.locator('.fleet-count strong')).toHaveText('29');
    expect(new URL(page.url()).pathname).toBe('/');
    expect(new URL(page.url()).searchParams.has('blacklisted')).toBe(false);
    await expectOnlyActive(page, '设备');
    console.log(
        'BLACKLIST_CACHE PASS: strict true rows=25/29; page/sort/search path=/blacklist; root query filtering+clear preserved; active link exclusive',
    );
});

test('blacklist cancellation uses a real PATCH, respects confirmation and removes the row', async ({
    page,
}) => {
    await login(page);
    const headers = { 'X-Boundary-Request': '1' };
    const { user } = await (await page.request.get('/api/auth/me')).json();
    const enrollment = await page.request.post('/api/device-enrollments', {
        headers,
        data: { apkId: user.apkId },
    });
    expect(enrollment.status()).toBe(201);
    const { enrollmentToken } = await enrollment.json();
    const publicId = `SIDEBAR_BLACKLIST_${randomUUID()}`;
    const registration = await page.request.post('/api/client/register', {
        headers: { ...headers, Authorization: `Bearer ${enrollmentToken}` },
        data: { apkId: user.apkId, deviceId: publicId, model: '侧栏拉黑合成测试' },
    });
    expect(registration.status()).toBe(201);
    const device = await registration.json();
    const endpoint = `/api/devices/${device.localId}/blacklist`;
    try {
        const blocked = await page.request.patch(endpoint, {
            headers,
            data: { blacklisted: true },
        });
        expect(blocked.status()).toBe(200);
        await page.goto(`/blacklist?q=${publicId}&sort=id&direction=asc&page=1`);
        const row = page.locator(`.blacklist-row[data-device-id="${device.localId}"]`);
        await expect(row).toBeVisible();
        await expect(page.locator('.blacklist-count strong')).toHaveText('1');
        const mutations = [];
        page.on('request', (request) => {
            if (new URL(request.url()).pathname === endpoint && request.method() === 'PATCH')
                mutations.push(request);
        });
        page.once('dialog', (dialog) => dialog.dismiss());
        await row.getByRole('button', { name: '释放', exact: true }).click();
        await expect(row).toBeVisible();
        expect(mutations).toEqual([]);
        const stillBlocked = await (
            await page.request.get(`/api/devices/${device.localId}`)
        ).json();
        expect(stillBlocked.device.is_blacklisted).toBe(true);
        const changed = page.waitForResponse(
            (response) =>
                new URL(response.url()).pathname === endpoint &&
                response.request().method() === 'PATCH',
        );
        page.once('dialog', (dialog) => {
            expect(dialog.message()).toContain('释放');
            return dialog.accept();
        });
        await row.getByRole('button', { name: '释放', exact: true }).focus();
        await page.keyboard.press('Enter');
        const response = await changed;
        expect(response.status()).toBe(200);
        expect(response.request().postDataJSON()).toEqual({ blacklisted: false });
        await expect(row).toHaveCount(0);
        await expect(page.getByText('暂无拉黑设备', { exact: true })).toBeVisible();
        await expect(page.locator('.blacklist-count strong')).toHaveText('0');
        expect(new URL(page.url()).pathname).toBe('/blacklist');
        expect(new URL(page.url()).searchParams.get('q')).toBe(publicId);
        const restored = await (await page.request.get(`/api/devices/${device.localId}`)).json();
        expect(restored.device.is_blacklisted).toBe(false);
        expect(mutations).toHaveLength(1);
        await page.screenshot({ path: 'test-results/blacklist-sidebar-empty.png' });
        console.log(
            'BLACKLIST_ACTION PASS: dismiss PATCH=0; accept PATCH=200/false; strict flag=false; row removed; empty state; route preserved',
        );
    } finally {
        const cleanup = await page.request.delete(`/api/devices/${device.localId}`, {
            headers,
            data: {},
        });
        expect(cleanup.status()).toBe(200);
    }
});

test('short desktop sidebar scrolls independently and member deep links stay guarded', async ({
    page,
}) => {
    await login(page);
    await page.setViewportSize({ width: 800, height: 320 });
    const rail = page.locator('.console-rail');
    const nav = page.getByRole('navigation', { name: '主导航', exact: true });
    const initial = await rail.boundingBox();
    expect(initial).toEqual({ x: 0, y: 58, width: 56, height: 262 });
    const scrollState = await rail.evaluate((element) => {
        const nav = element.querySelector('nav');
        const scroller =
            nav.scrollHeight > nav.clientHeight &&
            ['auto', 'scroll'].includes(getComputedStyle(nav).overflowY)
                ? nav
                : element;
        scroller.scrollTop = scroller.scrollHeight;
        return {
            scrollTop: scroller.scrollTop,
            scrollHeight: scroller.scrollHeight,
            clientHeight: scroller.clientHeight,
        };
    });
    expect(scrollState.scrollHeight).toBeGreaterThan(scrollState.clientHeight);
    expect(scrollState.scrollTop).toBeGreaterThan(0);
    await nav.getByRole('link', { name: '日志', exact: true }).focus();
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL('/logs');
    await expectOnlyActive(page, '日志');
    await page.evaluate(() => window.scrollTo(400, 180));
    expect(await rail.boundingBox()).toEqual(initial);
    await nav.getByRole('link', { name: 'AI', exact: true }).focus();
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL('/ai');
    await expectOnlyActive(page, 'AI');
    await page.screenshot({ path: 'test-results/sidebar-short-desktop.png' });
    await page.route('**/api/auth/me', async (route) => {
        const response = await route.fetch();
        const json = await response.json();
        json.user.role = 'member';
        await route.fulfill({ response, json });
    });
    await page.goto('/');
    await expect(nav.getByRole('link')).toHaveText(['设备', '注入', '构建', '推送']);
    const requests = [];
    page.on('request', (request) => {
        const pathname = new URL(request.url()).pathname;
        if (moduleApi(pathname) || ['POST', 'PATCH', 'PUT', 'DELETE'].includes(request.method()))
            requests.push({ method: request.method(), pathname });
    });
    await nav.getByRole('link', { name: '注入', exact: true }).focus();
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL('/injection');
    await expect(page.getByRole('heading', { name: '注入管理', exact: true })).toBeVisible();
    await expect(page.locator('.injection-settings-page')).toContainText('只读模式');
    await expectOnlyActive(page, '注入');
    const memberInjectionDocument = await page.reload();
    expect(memberInjectionDocument.status()).toBeLessThan(400);
    await expect(page).toHaveURL('/injection');
    await expect(page.locator('.injection-settings-page')).toContainText('只读模式');
    await expectOnlyActive(page, '注入');
    await nav.getByRole('link', { name: '推送', exact: true }).focus();
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL('/push');
    await expect(page.getByRole('heading', { name: '推送面板', exact: true })).toBeVisible();
    await expectOnlyActive(page, '推送');
    const memberPushDocument = await page.reload();
    expect(memberPushDocument.status()).toBeLessThan(400);
    await expect(page).toHaveURL('/push');
    await expect(page.getByRole('heading', { name: '推送面板', exact: true })).toBeVisible();
    await expectOnlyActive(page, '推送');
    for (const path of ['/ai', ...pendingModules.map((module) => module.path), '/blacklist']) {
        await page.goto(path);
        await expect(page).toHaveURL('/');
        await expectOnlyActive(page, '设备');
    }
    expect(requests).toEqual([]);
    console.log(
        'SIDEBAR_SCROLL_GUARD PASS: 800x320 independent rail scroll; fixed x/y; keyboard active/current; member injection readonly/push preview click+reload; other manager routes redirected; mutations/module APIs=0',
    );
});
