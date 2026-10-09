import { test, expect } from '@playwright/test';

const centeredPages = [
    { path: '/ai', title: 'AI 配置', cards: 7 },
    { path: '/push', title: '推送面板', cards: 2 },
    { path: '/performance', title: '性能', cards: 1 },
    { path: '/settings/translation', title: '翻译设置', cards: 1 },
    { path: '/settings/account', title: '账号设置', cards: 2 },
];
const widePages = [
    { path: '/injection', title: '注入管理' },
    { path: '/accounts', title: '总台账号管理' },
    { path: '/builds', title: '构建中心' },
    { path: '/logs', title: '服务器日志' },
    { path: '/protocol', title: '协议审计' },
];
const widths = [1920, 1440, 1280, 800];

async function login(page) {
    await page.goto('/login');
    await page.getByLabel('账号', { exact: true }).fill('mtx');
    await page.getByLabel('密码', { exact: true }).fill('mtx123');
    await page.getByRole('button', { name: '登录', exact: true }).click();
    await expect(page).toHaveURL('/');
    await expect(page.locator('.console-help')).toHaveAccessibleName('WS · 已连接');
}

function observeExecutionRequests(page) {
    const requests = [];
    page.on('request', (request) => {
        const pathname = new URL(request.url()).pathname;
        if (
            ['POST', 'PUT', 'PATCH', 'DELETE'].includes(request.method()) ||
            /^\/api\/(?:ai|injection|push|performance)(?:\/|$)/.test(pathname)
        )
            requests.push({ method: request.method(), pathname });
    });
    return requests;
}

async function geometry(locator) {
    const box = await locator.boundingBox();
    expect(box).not.toBeNull();
    return { ...box, right: box.x + box.width, center: box.x + box.width / 2 };
}

function expectAligned(box, reference) {
    expect(Math.abs(box.x - reference.x)).toBeLessThanOrEqual(1);
    expect(Math.abs(box.right - reference.right)).toBeLessThanOrEqual(1);
}

async function expectCentered(page, count) {
    const main = await geometry(page.locator('.console-main'));
    const wrapper = page.locator('.settings-page--centered');
    await expect(wrapper).toHaveCount(1);
    const wrapperBox = await geometry(wrapper);
    const title = await geometry(wrapper.locator(':scope > .page-title-row'));
    expect(wrapperBox.width).toBeCloseTo(810, 0);
    expect(Math.abs(wrapperBox.center - main.center)).toBeLessThanOrEqual(1);
    expect(title.width).toBeCloseTo(750, 0);
    expect(Math.abs(title.center - main.center)).toBeLessThanOrEqual(1);
    const cards = wrapper.locator(':scope > .settings-card');
    await expect(cards).toHaveCount(count);
    for (const card of await cards.all()) {
        const box = await geometry(card);
        expect(box.width).toBeCloseTo(750, 0);
        expectAligned(box, title);
        expect(Math.abs(box.center - main.center)).toBeLessThanOrEqual(1);
    }
    return title;
}

test('configuration cards share a centered 750px column across desktop widths and both themes', async ({
    page,
}) => {
    await login(page);
    const requests = observeExecutionRequests(page);
    for (const theme of ['light', 'dark']) {
        if (theme === 'dark') await page.getByRole('button', { name: '切换明暗主题' }).click();
        await expect(page.locator('html')).toHaveAttribute('data-bs-theme', theme);
        for (const width of widths) {
            await page.setViewportSize({ width, height: 900 });
            for (const entry of centeredPages) {
                await page.goto(entry.path);
                await expect(
                    page.getByRole('heading', { name: entry.title, exact: true }),
                ).toBeVisible();
                await expectCentered(page, entry.cards);
                expect(
                    await page.evaluate(() => document.documentElement.scrollWidth),
                ).toBeGreaterThanOrEqual(1280);
                if (width === 800) {
                    const rail = page.locator('.console-rail');
                    const initial = await rail.boundingBox();
                    expect(initial.x).toBe(0);
                    expect(initial.y).toBe(58);
                    expect(initial.width).toBe(56);
                    await page.evaluate(() => window.scrollTo(400, 0));
                    await expect.poll(() => page.evaluate(() => window.scrollX)).toBeGreaterThan(0);
                    expect(await rail.boundingBox()).toEqual(initial);
                    await expectCentered(page, entry.cards);
                    expect(
                        await page.evaluate(() =>
                            Boolean(document.elementFromPoint(28, 80)?.closest('.console-rail')),
                        ),
                    ).toBe(true);
                    await page.evaluate(() => window.scrollTo(0, 0));
                }
                if (
                    (width === 1920 && ['/ai', '/push'].includes(entry.path)) ||
                    (width === 800 && entry.path === '/push') ||
                    (width === 800 && entry.path === '/settings/account')
                )
                    await page.screenshot({
                        path: `test-results/settings-centered-${theme}-${entry.path === '/ai' ? 'ai' : entry.path === '/push' ? 'push' : 'account'}-${width}.png`,
                        fullPage: true,
                    });
            }
        }
    }
    expect(requests).toEqual([]);
    console.log(
        'SETTINGS_CENTERED PASS: AI/push/performance/translation/account; light/dark 1920/1440/1280/800; wrapper=810/card=750; title/card/main centers aligned; push direct cards=2; account cards=2; narrow canvas/rail retained; execution requests=0',
    );
});

test('injection management, account administration, build grid, server logs and records keep their wide desktop layout', async ({
    page,
}) => {
    await login(page);
    const requests = observeExecutionRequests(page);
    for (const width of widths) {
        await page.setViewportSize({ width, height: 900 });
        for (const entry of widePages) {
            await page.goto(entry.path);
            await expect(
                page.getByRole('heading', { name: entry.title, exact: true }),
            ).toBeVisible();
            const wrapper = page.locator('.settings-page');
            await expect(wrapper).not.toHaveClass(/settings-page--centered/);
            const main = await geometry(page.locator('.console-main'));
            const wrapperBox = await geometry(wrapper);
            const title = await geometry(wrapper.locator(':scope > .page-title-row'));
            expect(wrapperBox.width).toBeGreaterThan(1000);
            expect(title.width).toBeGreaterThan(1000);
            expect(title.x - main.x).toBeCloseTo(30, 0);
            if (entry.path === '/builds') {
                const grid = page.locator('.ab-build-grid');
                await expect(grid).toHaveCSS('display', 'grid');
                const worker = await geometry(
                    grid.getByRole('form', { name: 'B 包构建配置', exact: true }),
                );
                const installer = await geometry(
                    grid.getByRole('form', { name: 'A 包构建配置', exact: true }),
                );
                expect(Math.abs(worker.y - installer.y)).toBeLessThanOrEqual(1);
                expect(installer.x).toBeGreaterThanOrEqual(worker.right + 10);
                expect(worker.width).toBeGreaterThan(400);
                expect(installer.width).toBeGreaterThan(400);
            }
        }
    }
    expect(requests).toEqual([]);
    console.log(
        'SETTINGS_WIDE PASS: injection/accounts/builds/logs/protocol widths>1000; title left padding=30; build forms=2 parallel columns; no centered modifier; execution requests=0',
    );
});

test('centered pages retain keyboard navigation and an aligned translation error/retry flow', async ({
    page,
}) => {
    await login(page);
    const requests = observeExecutionRequests(page);
    await page.goto('/ai');
    const back = page.getByRole('link', { name: '返回设备', exact: true });
    await back.focus();
    await expect(back).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL('/');
    await page.getByRole('link', { name: '推送', exact: true }).focus();
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL('/push');
    const builds = page.getByRole('link', { name: '前往构建', exact: true });
    await builds.focus();
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL('/builds');
    await expect(page.getByRole('heading', { name: '构建中心', exact: true })).toBeVisible();
    await page.goto('/settings/account');
    await page.getByRole('link', { name: '返回设备', exact: true }).focus();
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL('/');
    const failure = '翻译设置读取失败（居中测试）';
    await page.route(
        '**/api/settings/translation',
        (route) => {
            expect(route.request().method()).toBe('GET');
            return route.fulfill({ status: 500, json: { error: failure } });
        },
        { times: 1 },
    );
    await page.goto('/settings/translation');
    await expect(page.getByRole('heading', { name: '翻译设置', exact: true })).toBeVisible();
    const wrapper = page.locator('.settings-page--centered');
    const title = await geometry(wrapper.locator(':scope > .page-title-row'));
    const alert = page.getByRole('alert').filter({ hasText: failure });
    await expect(alert).toBeVisible();
    const errorBox = await geometry(alert);
    expect(errorBox.width).toBeCloseTo(750, 0);
    expectAligned(errorBox, title);
    await expect(wrapper.locator(':scope > .settings-card')).toHaveCount(0);
    const retry = alert.getByRole('button', { name: '重新读取', exact: true });
    await retry.focus();
    await expect(retry).toBeFocused();
    const loaded = page.waitForResponse(
        (response) =>
            new URL(response.url()).pathname === '/api/settings/translation' &&
            response.request().method() === 'GET' &&
            response.status() === 200,
    );
    await page.keyboard.press('Enter');
    expect((await loaded).status()).toBe(200);
    await expect(alert).toHaveCount(0);
    await expectCentered(page, 1);
    const key = page.getByLabel('API Key', { exact: true });
    await key.focus();
    await expect(key).toBeFocused();
    await expect(key).toHaveAttribute('type', 'password');
    await expect(page.getByLabel('目标语言', { exact: true })).toBeEnabled();
    expect(requests).toEqual([]);
    await page.screenshot({ path: 'test-results/settings-centered-translation-retry.png' });
    console.log(
        'SETTINGS_KEYBOARD_RETRY PASS: return/build routes by keyboard; GET500 alert=750px aligned; retry keyboard GET200; card/title aligned; password field focus/role retained; execution requests=0',
    );
});
