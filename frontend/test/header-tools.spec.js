import { test, expect } from '@playwright/test';

async function login(page, { navigate = true } = {}) {
    if (navigate) await page.goto('/login');
    await page.getByRole('textbox', { name: '账号', exact: true }).fill('mtx');
    await page.getByLabel('密码', { exact: true }).fill('mtx123');
    await page.getByRole('button', { name: '登录', exact: true }).click();
    await expect(page).toHaveURL('/');
    await expect(page.locator('.console-help')).toHaveAccessibleName('WS · 已连接');
}

async function expectIconTools(page) {
    const header = page.locator('.console-topbar');
    const tools = header.locator('.console-theme, .console-help, .console-logout');
    await expect(tools).toHaveCount(3);
    for (const tool of await tools.all()) {
        await expect(tool).toBeVisible();
        const box = await tool.boundingBox();
        expect(box.width).toBe(34);
        expect(box.height).toBe(34);
        expect(await tool.locator('img, svg').count()).toBeGreaterThan(0);
    }
    await expect(header.getByRole('button', { name: '切换明暗主题', exact: true })).toBeVisible();
    await expect(header.getByRole('link', { name: 'WS · 已连接', exact: true })).toBeVisible();
    await expect(header.getByRole('button', { name: '退出当前账号', exact: true })).toBeVisible();
}

test('header icon tools toggle the actual theme, open audit by keyboard and end the real session', async ({
    page,
}) => {
    await login(page);
    for (const width of [1440, 941, 940, 625, 550]) {
        await page.setViewportSize({ width, height: 800 });
        await page.evaluate(() => window.scrollTo(0, 0));
        await expectIconTools(page);
    }
    await page.setViewportSize({ width: 625, height: 800 });
    const theme = page.getByRole('button', { name: '切换明暗主题', exact: true });
    await theme.focus();
    await page.keyboard.press('Enter');
    await expect(page.locator('html')).toHaveAttribute('data-bs-theme', 'dark');
    expect(await page.evaluate(() => localStorage.getItem('boundary-theme'))).toBe('dark');
    await page.reload();
    await expect(page.locator('html')).toHaveAttribute('data-bs-theme', 'dark');
    await expect(page.locator('.console-help')).toHaveAccessibleName('WS · 已连接');
    const audit = page.getByRole('link', { name: 'WS · 已连接', exact: true });
    await audit.focus();
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL('/protocol');
    await expect(page.getByRole('heading', { name: '协议审计', exact: true })).toBeVisible();
    const signout = page.getByRole('button', { name: '退出当前账号', exact: true });
    await signout.focus();
    const response = page.waitForResponse(
        (response) =>
            new URL(response.url()).pathname === '/api/auth/logout' &&
            response.request().method() === 'POST',
    );
    await page.keyboard.press('Enter');
    expect((await response).status()).toBe(200);
    await expect(page).toHaveURL('/login');
    await expect(page.getByRole('status')).toHaveText('已退出登录');
    expect((await page.request.get('/api/auth/me')).status()).toBe(401);
    await expect(page.locator('.console-topbar')).toHaveCount(0);
    await page.goto('/');
    await expect(page).toHaveURL('/login');
    console.log(
        'HEADER_TOOLS PASS: icon=34x34; theme keyboard/persistence; audit keyboard; logout POST=200; session me=401; protected route=login',
    );
});

test('failed header logout keeps the account active, displays an external alert and allows a real retry', async ({
    page,
}) => {
    await login(page);
    await page.setViewportSize({ width: 625, height: 800 });
    const failure = '合成退出失败，请重试';
    let failures = 0;
    await page.route(
        '**/api/auth/logout',
        (route) => {
            expect(route.request().method()).toBe('POST');
            failures++;
            return route.fulfill({ status: 500, json: { error: failure } });
        },
        { times: 1 },
    );
    const signout = page.getByRole('button', { name: '退出当前账号', exact: true });
    await signout.click();
    const alert = page.getByRole('alert').filter({ hasText: failure });
    await expect(alert).toBeVisible();
    expect(await alert.evaluate((element) => element.closest('.console-topbar') === null)).toBe(
        true,
    );
    await expect(page).toHaveURL('/');
    await expect(page.getByRole('link', { name: '账号设置', exact: true })).toBeVisible();
    await expect(signout).toBeEnabled();
    expect((await page.request.get('/api/auth/me')).status()).toBe(200);
    expect(failures).toBe(1);
    await page.screenshot({ path: 'test-results/header-logout-failure-625.png' });
    const response = page.waitForResponse(
        (response) =>
            new URL(response.url()).pathname === '/api/auth/logout' &&
            response.request().method() === 'POST',
    );
    await signout.focus();
    await page.keyboard.press('Enter');
    expect((await response).status()).toBe(200);
    await expect(page).toHaveURL('/login');
    expect((await page.request.get('/api/auth/me')).status()).toBe(401);
    console.log(
        'HEADER_LOGOUT_RETRY PASS: first POST=500; external alert visible; session me=200; retry POST=200; session me=401',
    );
});

test('a header logout error never survives account-page logout and a new SPA session', async ({
    page,
}) => {
    await login(page);
    await page.setViewportSize({ width: 625, height: 800 });
    const failure = '合成旧会话退出失败';
    await page.route(
        '**/api/auth/logout',
        (route) => {
            expect(route.request().method()).toBe('POST');
            return route.fulfill({ status: 500, json: { error: failure } });
        },
        { times: 1 },
    );
    await page.getByRole('button', { name: '退出当前账号', exact: true }).click();
    const staleAlert = page.getByRole('alert').filter({ hasText: failure });
    await expect(staleAlert).toBeVisible();
    // Preserve the mounted App: a document reload would reset the stale ref and mask this bug.
    await page.getByRole('link', { name: '账号设置', exact: true }).click();
    await expect(page).toHaveURL('/settings/account');
    const accountLogout = page.waitForResponse(
        (response) =>
            new URL(response.url()).pathname === '/api/auth/logout' &&
            response.request().method() === 'POST',
    );
    await page.getByRole('button', { name: '退出登录', exact: true }).click();
    expect((await accountLogout).status()).toBe(200);
    await expect(page).toHaveURL('/login');
    expect((await page.request.get('/api/auth/me')).status()).toBe(401);
    // Submit the existing login form without navigating/reloading the document.
    await login(page, { navigate: false });
    expect((await page.request.get('/api/auth/me')).status()).toBe(200);
    await expect(staleAlert).toHaveCount(0);
    await expect(page.locator('.console-header-error')).toHaveCount(0);
    await expectIconTools(page);
    const theme = page.getByRole('button', { name: '切换明暗主题', exact: true });
    await theme.focus();
    await page.keyboard.press('Enter');
    await expect(page.locator('html')).toHaveAttribute('data-bs-theme', 'dark');
    await page.getByRole('link', { name: 'WS · 已连接', exact: true }).focus();
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL('/protocol');
    await expect(page.getByRole('heading', { name: '协议审计', exact: true })).toBeVisible();
    const headerLogout = page.waitForResponse(
        (response) =>
            new URL(response.url()).pathname === '/api/auth/logout' &&
            response.request().method() === 'POST',
    );
    await page.getByRole('button', { name: '退出当前账号', exact: true }).click();
    expect((await headerLogout).status()).toBe(200);
    await expect(page).toHaveURL('/login');
    expect((await page.request.get('/api/auth/me')).status()).toBe(401);
    console.log(
        'HEADER_LOGOUT_SESSION_RESET PASS: header POST=500; account POST=200; old me=401; relogin me=200; stale alerts=0; theme/audit/logout usable; final me=401',
    );
});
