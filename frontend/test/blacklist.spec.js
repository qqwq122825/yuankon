import { test, expect } from '@playwright/test';
import { randomUUID } from 'node:crypto';

const boundaryHeaders = { 'X-Boundary-Request': '1' };
const releaseSelected = (page) => page.getByRole('button', { name: /^释放选中\s*\(/ });
const selectAll = (page) => page.getByRole('checkbox', { name: '选择全部拉黑设备', exact: true });
const rows = (page) => page.locator('.blacklist-row');

function fixtureRows(count, flags = []) {
    return Array.from({ length: count }, (_, index) => ({
        id: index + 1,
        public_id: `BLACKLIST-UI-${String(index + 1).padStart(3, '0')}`,
        name: `拉黑界面合成设备 ${index + 1}`,
        source: 'api',
        status: 'offline',
        accessibility_enabled: index % 2 === 0,
        is_blacklisted: index < flags.length ? flags[index] : true,
        owner_username: 'mtx',
        memo_count: 0,
        note: `合成备注 ${index + 1}`,
        brand: 'Fixture',
        android_version: '14',
    }));
}

function listResponse(data, url) {
    const query = new URL(url).searchParams;
    const q = query.get('q') || '';
    const filtered = data.filter((row) =>
        `${row.public_id} ${row.name} ${row.brand} ${row.owner_username} ${row.note}`.includes(q),
    );
    return {
        data: filtered,
        total: filtered.length,
        page: 1,
        perPage: 500,
        filters: { sort: query.get('sort'), direction: query.get('direction') },
        stats: { devices: data.length, online: 0, periods: [] },
    };
}

async function login(page) {
    await page.goto('/login');
    await page.getByLabel('账号', { exact: true }).fill('mtx');
    await page.getByLabel('密码', { exact: true }).fill('mtx123');
    await page.getByRole('button', { name: '登录', exact: true }).click();
    await expect(page).toHaveURL('/');
    await expect(page.locator('.console-help')).toHaveAccessibleName('WS · 已连接');
}

async function openFixture(page, data) {
    await page.route('**/api/devices?*perPage=500*', (route) =>
        route.fulfill({ json: listResponse(data, route.request().url()) }),
    );
    await login(page);
    await page.goto('/blacklist');
    await expect(page.locator('.blacklist-table-wrap')).toHaveAttribute('aria-busy', 'false');
    // The initial WS bot_list can schedule one refresh. Finish it before counting requests.
    await page.waitForTimeout(400);
    await expect(page.locator('.blacklist-table-wrap')).toHaveAttribute('aria-busy', 'false');
}

test('blacklist table uses only strict true flags, real account metadata and explicit unknown dashes', async ({
    page,
}) => {
    await openFixture(page, fixtureRows(8, [true, true, false, null, 1, 'true', 0, undefined]));
    await expect(page.getByRole('heading', { name: '拉黑设备', exact: true })).toBeVisible();
    await expect(page.locator('.blacklist-count strong')).toHaveText('2');
    await expect(rows(page)).toHaveCount(2);
    await expect(page.locator('.blacklist-table thead th')).toHaveCount(10);
    const headings = await page.locator('.blacklist-table thead th').allTextContents();
    expect(headings.map((text) => text.replace(/[⇅↑↓]/g, '').trim())).toEqual([
        '',
        '设备 ID',
        '品牌 / 型号',
        '最后 IP',
        '账号',
        '备注',
        '原因',
        '操作人',
        '拉黑时间',
        '操作',
    ]);
    const first = rows(page).first();
    await expect(first.locator('td').nth(1)).toContainText('BLACKLIST-UI-001');
    await expect(first.locator('td').nth(2)).toContainText('Fixture');
    await expect(first.locator('td').nth(4)).toHaveText('mtx');
    await expect(first.locator('td').nth(5)).toHaveText('合成备注 1');
    await expect(first.locator('.blacklist-pending')).toHaveCount(4);
    await expect(first.locator('.blacklist-pending')).toHaveText(['—', '—', '—', '—']);
    await expect(first.getByRole('button')).toHaveText(['释放']);
    await expect(page.getByRole('button', { name: '删除', exact: true })).toHaveCount(0);
    await expect(releaseSelected(page)).toBeDisabled();
    await expect(selectAll(page)).not.toBeChecked();
    const search = page.getByRole('textbox', { name: '搜索拉黑设备', exact: true });
    await search.fill('NO_SYNTHETIC_MATCH');
    await search.press('Enter');
    await expect(rows(page)).toHaveCount(0);
    await expect(page.getByText('暂无拉黑设备', { exact: true })).toBeVisible();
    await expect(page.locator('.blacklist-count strong')).toHaveText('0');
    await expect(selectAll(page)).toBeDisabled();
    await expect(releaseSelected(page)).toBeDisabled();
    await expect(releaseSelected(page)).toContainText('(0)');
    await expect(page.locator('.blacklist-table')).not.toContainText('已验证');
    console.log(
        'BLACKLIST_METADATA PASS: strict true=2/8; columns=10; unavailable IP/reason/operator/time=4 dashes; no fabricated metadata; empty/selection=0',
    );
});

test('blacklist selection is page-scoped, local pages do not fetch and server search/sort preserve the route', async ({
    page,
}) => {
    const data = fixtureRows(25);
    await openFixture(page, data);
    const requests = [];
    page.on('request', (request) => {
        if (new URL(request.url()).pathname === '/api/devices') requests.push(request.url());
    });
    const checkbox = selectAll(page);
    await checkbox.check();
    await expect(releaseSelected(page)).toContainText('(10)');
    await rows(page).first().getByRole('checkbox').uncheck();
    await expect(releaseSelected(page)).toContainText('(9)');
    expect(await checkbox.evaluate((element) => element.indeterminate)).toBe(true);
    await page.getByRole('button', { name: '第 2 页', exact: true }).click();
    await expect(page).toHaveURL(/\/blacklist\?.*page=2/);
    await expect(rows(page).first()).toHaveAttribute('data-device-id', '11');
    await expect(releaseSelected(page)).toContainText('(0)');
    expect(await checkbox.evaluate((element) => element.indeterminate)).toBe(false);
    await rows(page).first().getByRole('checkbox').focus();
    await page.keyboard.press('Space');
    await expect(releaseSelected(page)).toContainText('(1)');
    await page.waitForTimeout(100);
    expect(requests).toHaveLength(0);
    await page.getByRole('button', { name: /^设备 ID\s*[⇅↑↓]/ }).click();
    await expect(page).toHaveURL(/direction=desc/);
    await expect(page).toHaveURL(/page=1/);
    await expect(rows(page).first()).toHaveAttribute('data-device-id', '25');
    await expect(releaseSelected(page)).toContainText('(0)');
    await expect.poll(() => requests.length).toBe(1);
    expect(new URL(requests[0]).searchParams.get('sort')).toBe('id');
    expect(new URL(requests[0]).searchParams.get('direction')).toBe('desc');
    const search = page.getByRole('textbox', { name: '搜索拉黑设备', exact: true });
    await search.fill('BLACKLIST-UI-025');
    await search.press('Enter');
    await expect(page.locator('.blacklist-count strong')).toHaveText('1');
    await expect(rows(page)).toHaveCount(1);
    await expect.poll(() => requests.length).toBe(2);
    expect(new URL(requests[1]).searchParams.get('q')).toBe('BLACKLIST-UI-025');
    expect(new URL(page.url()).pathname).toBe('/blacklist');
    await search.fill('');
    await search.press('Enter');
    await expect(page.locator('.blacklist-count strong')).toHaveText('25');
    await page.goto('/blacklist?sort=id&direction=desc&page=999');
    await expect(page).toHaveURL(/page=3/);
    await expect(rows(page)).toHaveCount(5);
    await checkbox.check();
    await expect(releaseSelected(page)).toContainText('(5)');
    data.splice(3);
    await page.getByRole('button', { name: '刷新', exact: true }).click();
    await expect(page).toHaveURL(/page=1/);
    await expect(rows(page)).toHaveCount(3);
    await expect(releaseSelected(page)).toContainText('(0)');
    await page.screenshot({ path: 'test-results/blacklist-selection-page-clamp.png' });
    console.log(
        'BLACKLIST_SELECTION PASS: header indeterminate=9/10; page change resets selection; local page HTTP=0; sort/search server=2; page999→3; refreshed3rows→page1 selected0',
    );
});

test('batch release confirms, blocks duplicate clicks, retains failed selections and stops on forbidden responses', async ({
    page,
}) => {
    const data = fixtureRows(3);
    await openFixture(page, data);
    const requests = [];
    let failOnce = true;
    let forbidden = false;
    let finishFirst;
    let firstGate = new Promise((resolve) => (finishFirst = resolve));
    await page.route('**/api/devices/*/blacklist', async (route) => {
        const request = route.request();
        const id = Number(new URL(request.url()).pathname.split('/')[3]);
        requests.push({ id, method: request.method(), body: request.postDataJSON() });
        if (id === 1 && firstGate) await firstGate;
        if (id === 2 && (failOnce || forbidden)) {
            failOnce = false;
            return route.fulfill({
                status: forbidden ? 403 : 500,
                json: { error: forbidden ? '无权释放合成设备' : '合成释放失败，请重试' },
            });
        }
        const row = data.find((row) => row.id === id);
        row.is_blacklisted = false;
        await route.fulfill({ json: { device: row } });
    });
    await selectAll(page).check();
    page.once('dialog', (dialog) => dialog.dismiss());
    await releaseSelected(page).click();
    expect(requests).toEqual([]);
    await expect(releaseSelected(page)).toContainText('(3)');
    page.once('dialog', (dialog) => {
        expect(dialog.message()).toContain('释放');
        return dialog.accept();
    });
    await releaseSelected(page).click();
    await expect.poll(() => requests.length).toBe(1);
    await expect(releaseSelected(page)).toBeDisabled();
    await expect(
        rows(page).first().getByRole('button', { name: '释放', exact: true }),
    ).toBeDisabled();
    finishFirst();
    firstGate = null;
    await expect(rows(page)).toHaveCount(1);
    await expect(rows(page).first()).toHaveAttribute('data-device-id', '2');
    await expect(releaseSelected(page)).toContainText('(1)');
    await expect(page.getByRole('alert')).toContainText('合成释放失败');
    expect(requests).toEqual([
        { id: 1, method: 'PATCH', body: { blacklisted: false } },
        { id: 2, method: 'PATCH', body: { blacklisted: false } },
        { id: 3, method: 'PATCH', body: { blacklisted: false } },
    ]);
    page.once('dialog', (dialog) => dialog.accept());
    await releaseSelected(page).click();
    await expect(rows(page)).toHaveCount(0);
    await expect(page.getByText('暂无拉黑设备', { exact: true })).toBeVisible();
    expect(requests.filter((request) => request.id === 2)).toHaveLength(2);
    expect(requests.every((request) => request.method === 'PATCH')).toBe(true);
    await expect(releaseSelected(page)).toBeDisabled();
    for (const row of data) row.is_blacklisted = true;
    forbidden = true;
    requests.length = 0;
    await page.getByRole('button', { name: '刷新', exact: true }).click();
    await expect(rows(page)).toHaveCount(3);
    await selectAll(page).check();
    page.once('dialog', (dialog) => dialog.accept());
    await releaseSelected(page).click();
    await expect(rows(page)).toHaveCount(2);
    await expect(page.getByRole('alert')).toContainText('无权释放');
    expect(requests.map((request) => request.id)).toEqual([1, 2]);
    await expect(releaseSelected(page)).toContainText('(2)');
    await page.screenshot({ path: 'test-results/blacklist-partial-forbidden-release.png' });
    console.log(
        'BLACKLIST_BATCH PASS: dismiss requests=0; busy disables duplicate; success1+3 removed; failure2 selected/retry; PATCH false only; 403 stops id3',
    );
});

test('real three-device release preserves notes and memos, restores admission and never deletes devices', async ({
    page,
}) => {
    await login(page);
    const { user } = await (await page.request.get('/api/auth/me')).json();
    const prefix = `BLACKLIST_BATCH_${randomUUID()}`;
    const registered = [];
    try {
        for (let index = 1; index <= 3; index++) {
            const publicId = `${prefix}_${index}`;
            const online = await page.request.post('/api/client/online', {
                headers: boundaryHeaders,
                data: { apkId: user.apkId, deviceId: publicId, model: `合成批量释放 ${index}` },
            });
            expect(online.status()).toBe(201);
            const device = await online.json();
            registered.push({ ...device, publicId });
            const note = await page.request.patch(`/api/devices/${device.localId}/note`, {
                headers: boundaryHeaders,
                data: { note: `保留合成备注 ${index}` },
            });
            expect(note.status()).toBe(200);
            const memo = await page.request.post(`/api/devices/${device.localId}/memos`, {
                headers: boundaryHeaders,
                data: { body: `保留合成历史 ${index}`, label: 'follow_up' },
            });
            expect(memo.status()).toBe(201);
            const blocked = await page.request.patch(`/api/devices/${device.localId}/blacklist`, {
                headers: boundaryHeaders,
                data: { blacklisted: true },
            });
            expect(blocked.status()).toBe(200);
            const denied = await page.request.post('/api/client/online', {
                headers: boundaryHeaders,
                data: { apkId: user.apkId, deviceId: publicId, model: `合成批量释放 ${index}` },
            });
            expect(denied.status()).toBe(403);
        }
        await page.goto(`/blacklist?q=${prefix}`);
        await expect(rows(page)).toHaveCount(3);
        const mutations = [];
        page.on('request', (request) => {
            if (/^\/api\/devices\/\d+(?:\/blacklist)?$/.test(new URL(request.url()).pathname))
                mutations.push({ method: request.method(), path: new URL(request.url()).pathname });
        });
        await selectAll(page).focus();
        await page.keyboard.press('Space');
        await expect(releaseSelected(page)).toContainText('(3)');
        page.once('dialog', (dialog) => dialog.accept());
        await releaseSelected(page).focus();
        await page.keyboard.press('Enter');
        await expect(rows(page)).toHaveCount(0);
        await expect(page.getByText('暂无拉黑设备', { exact: true })).toBeVisible();
        expect(mutations).toHaveLength(3);
        expect(mutations.every((request) => request.method === 'PATCH')).toBe(true);
        for (const [index, device] of registered.entries()) {
            const detail = await (await page.request.get(`/api/devices/${device.localId}`)).json();
            expect(detail.device.is_blacklisted).toBe(false);
            expect(detail.device.note).toBe(`保留合成备注 ${index + 1}`);
            expect(detail.device.deleted_at).toBeNull();
            const memo = await (
                await page.request.get(`/api/devices/${device.localId}/memos`)
            ).json();
            expect(memo.data.map((entry) => entry.body)).toEqual([`保留合成历史 ${index + 1}`]);
            const readmitted = await page.request.post('/api/client/online', {
                headers: boundaryHeaders,
                data: {
                    apkId: user.apkId,
                    deviceId: device.publicId,
                    model: `合成批量释放 ${index + 1}`,
                },
            });
            expect(readmitted.status()).toBe(201);
            expect((await readmitted.json()).localId).toBe(device.localId);
        }
        await page.screenshot({ path: 'test-results/blacklist-real-batch-empty.png' });
        console.log(
            'BLACKLIST_REAL PASS: devices=3; blocked admission=403; release PATCH=3/200; flags=false; notes/memos retained; deleted_at=null; same-id readmission=201; DELETE=0',
        );
    } finally {
        for (const device of registered) {
            const cleanup = await page.request.delete(`/api/devices/${device.localId}`, {
                headers: boundaryHeaders,
                data: {},
            });
            expect(cleanup.status()).toBe(200);
        }
    }
});

test('blacklist empty canvas keeps compact toolbar, desktop table and fixed rail in both themes', async ({
    page,
}) => {
    await openFixture(page, []);
    for (const theme of ['light', 'dark']) {
        if (theme === 'dark') {
            await page.getByRole('button', { name: '切换明暗主题', exact: true }).click();
            await expect(page.locator('html')).toHaveAttribute('data-bs-theme', 'dark');
        }
        for (const width of [1920, 1440, 1280, 800]) {
            await page.setViewportSize({ width, height: 900 });
            await page.evaluate(() => window.scrollTo(0, 0));
            const metrics = await page.locator('.blacklist-page').evaluate((element) => {
                const height = (selector) =>
                    element.querySelector(selector).getBoundingClientRect().height;
                const background = getComputedStyle(element).backgroundColor;
                const headerBackground = getComputedStyle(
                    element.querySelector('.blacklist-table th'),
                ).backgroundColor;
                return {
                    toolbar: height('.blacklist-toolbar'),
                    header: height('.blacklist-table thead tr'),
                    empty: height('.blacklist-table tbody tr'),
                    minWidth: document.documentElement.scrollWidth,
                    background,
                    headerBackground,
                };
            });
            expect(metrics.toolbar).toBe(50);
            expect(metrics.header).toBe(36);
            expect(metrics.empty).toBe(64);
            expect(metrics.minWidth).toBeGreaterThanOrEqual(1280);
            if (theme === 'light') expect(metrics.background).toBe('rgb(255, 255, 255)');
            expect(metrics.headerBackground).toBe(
                theme === 'dark' ? 'rgb(30, 39, 55)' : 'rgb(242, 243, 248)',
            );
            const rail = await page.locator('.console-rail').boundingBox();
            expect(rail.x).toBe(0);
            expect(rail.y).toBe(58);
            expect(rail.width).toBe(width >= 1800 ? 64 : 56);
            await expect(page.getByText('暂无拉黑设备', { exact: true })).toBeVisible();
            await page.screenshot({ path: `test-results/blacklist-empty-${theme}-${width}.png` });
            if (width === 800) {
                await page.evaluate(() => window.scrollTo(400, 120));
                await expect.poll(() => page.evaluate(() => window.scrollX)).toBeGreaterThan(0);
                expect(await page.locator('.console-rail').boundingBox()).toEqual(rail);
            }
        }
    }
    console.log(
        'BLACKLIST_GEOMETRY PASS: light/dark widths=1920,1440,1280,800; toolbar=50; header=36; empty=64; white light canvas; desktop min1280+xscroll; fixed rail=56/64x58',
    );
});

test('refresh failure remains visible, real retry succeeds and loading disables selection and duplicate refresh', async ({
    page,
}) => {
    await openFixture(page, fixtureRows(1));
    let fail = true;
    let finish;
    const gate = new Promise((resolve) => (finish = resolve));
    const requests = [];
    await page.route('**/api/devices?*perPage=500*', async (route) => {
        requests.push(route.request().url());
        if (fail) {
            await gate;
            return route.fulfill({ status: 500, json: { error: '合成刷新失败' } });
        }
        return route.fulfill({ json: listResponse([], route.request().url()) });
    });
    const refresh = page.locator('.blacklist-refresh');
    await refresh.focus();
    await page.keyboard.press('Enter');
    await expect(refresh).toBeDisabled();
    await expect(selectAll(page)).toBeDisabled();
    await expect(releaseSelected(page)).toBeDisabled();
    await expect(page.locator('.blacklist-table-wrap')).toHaveAttribute('aria-busy', 'true');
    finish();
    await expect(page.getByRole('alert')).toContainText('合成刷新失败');
    await expect(refresh).toBeEnabled();
    fail = false;
    await page.getByRole('button', { name: '重试', exact: true }).focus();
    await page.keyboard.press('Enter');
    await expect(page.getByRole('alert')).toHaveCount(0);
    await expect(page.getByText('暂无拉黑设备', { exact: true })).toBeVisible();
    await expect(page.locator('.blacklist-table-wrap')).toHaveAttribute('aria-busy', 'false');
    expect(requests).toHaveLength(2);
    await page.screenshot({ path: 'test-results/blacklist-refresh-retry-empty.png' });
    console.log(
        'BLACKLIST_REFRESH PASS: gated load aria-busy=true; refresh/selection disabled; HTTP500 alert; keyboard retry HTTP200 empty; requests=2',
    );
});
