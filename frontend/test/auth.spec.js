import { test, expect } from '@playwright/test';

async function signIn(page, password = 'mtx123') {
    await page.goto('/login');
    await page.getByRole('textbox', { name: '账号', exact: true }).fill('mtx');
    await page.getByLabel('密码', { exact: true }).fill(password);
    await page.getByRole('button', { name: '登录', exact: true }).click();
    await expect(page).toHaveURL('/');
    await expect(page.getByText('WS · 已连接')).toBeVisible();
}

test('first-run web installer creates the superadmin then locks the install route', async ({
    browser,
}) => {
    const context = await browser.newContext();
    const page = await context.newPage();
    let installed = false,
        environmentReady = false;
    await page.route('**/api/install/status', async (route) =>
        route.fulfill({ json: { installed } }),
    );
    await page.route('**/api/install/environment', async (route) => {
        if (route.request().method() === 'POST') environmentReady = true;
        await route.fulfill({
            status: 200,
            json: {
                ready: environmentReady,
                state: environmentReady ? 'ready' : 'idle',
                stage: environmentReady ? 'complete' : 'waiting',
                message: environmentReady ? '构建环境已就绪' : '构建环境尚未安装',
                components: [
                    { id: 'java', label: 'JDK 17', ready: environmentReady },
                    { id: 'platform', label: 'Android SDK Platform 35', ready: environmentReady },
                ],
                log: environmentReady ? '[STAGE:complete] 构建环境安装并验证完成' : '',
            },
        });
    });
    await page.route('**/api/install', async (route) => {
        const input = route.request().postDataJSON();
        expect(input).toEqual({
            username: 'first_admin',
            password: '123456',
            confirmPassword: '123456',
        });
        installed = true;
        await route.fulfill({
            status: 201,
            json: { installed: true, user: { username: 'first_admin', apkId: '1' } },
        });
    });
    await page.goto('/');
    await expect(page).toHaveURL('/install');
    await expect(page.getByRole('heading', { name: '初始化工作台' })).toBeVisible();
    const accountInput = page.getByRole('textbox', { name: '超管账号', exact: true });
    await expect(accountInput).toBeDisabled();
    await page.getByRole('button', { name: '安装构建环境', exact: true }).click();
    await expect(page.getByRole('button', { name: '构建环境已就绪' })).toBeDisabled();
    await expect(page.getByText('JDK 17', { exact: true })).toBeVisible();
    await expect(accountInput).toBeEnabled();
    await accountInput.fill('first_admin');
    await page.getByLabel('超管密码').fill('123456');
    await page.getByLabel('确认密码').fill('123456');
    await expect(page.getByLabel('超管密码')).toHaveAttribute('type', 'password');
    await page.getByLabel('显示密码').check();
    await expect(page.getByLabel('超管密码')).toHaveAttribute('type', 'text');
    await expect(page.getByLabel('确认密码')).toHaveAttribute('type', 'text');
    await page.getByRole('button', { name: '完成安装' }).click();
    await expect(page).toHaveURL('/login');
    await expect(page.getByText('初始化完成，请使用刚设置的超管账号登录。')).toBeVisible();
    await page.goto('/install');
    await expect(page).toHaveURL('/login');
    await context.close();
});

test('deep links require login; errors, cookie restoration and logout work', async ({ page }) => {
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.goto('/devices/1');
    await expect(page).toHaveURL('/login');
    await expect(page.getByRole('navigation', { name: '主导航' })).toHaveCount(0);
    await page.getByRole('textbox', { name: '账号', exact: true }).fill('mtx');
    await page.getByLabel('密码', { exact: true }).fill('wrong-password');
    await page.getByRole('button', { name: '登录', exact: true }).click();
    await expect(page.getByRole('alert')).toHaveText('账号或密码错误');
    await expect(page.getByLabel('密码', { exact: true })).toHaveValue('');
    await signIn(page);
    await page.goto('/install');
    await expect(page.getByRole('heading', { name: '构建环境', exact: true })).toBeVisible();
    await expect(page.getByRole('heading', { name: '创建超管账号' })).toHaveCount(0);
    await expect(page.getByRole('link', { name: '返回构建页面' })).toBeVisible();
    await page.goto('/');
    const cookie = (await page.context().cookies()).find((c) => c.name === 'boundary_session_8081');
    expect(cookie).toMatchObject({ httpOnly: true, sameSite: 'Strict', path: '/api' });
    expect(await page.evaluate(() => document.cookie)).not.toContain('boundary_session');
    expect(await page.evaluate(() => Object.keys(localStorage))).toEqual(['boundary-theme']);
    await page.reload();
    await expect(page.getByRole('link', { name: '账号设置', exact: true })).toContainText(
        '超管 · APK',
    );
    await expect(page.getByRole('link', { name: '账号设置', exact: true })).toContainText(
        '长期有效',
    );
    await page.goto('/settings/account');
    await expect(page.getByRole('heading', { name: 'mtx · 超级管理员' })).toBeVisible();
    await page.getByRole('button', { name: '退出登录', exact: true }).click();
    await expect(page).toHaveURL('/login');
    expect((await page.request.get('/api/devices')).status()).toBe(401);
    expect((await page.request.get('/api/snapshots/1/image')).status()).toBe(401);
    await page.goBack();
    await expect(page).toHaveURL('/login');
    expect(errors).toEqual([]);
});

test('new browser login immediately removes the old browser session and UI', async ({
    browser,
}) => {
    const first = await browser.newContext(),
        second = await browser.newContext();
    try {
        const oldPage = await first.newPage(),
            newPage = await second.newPage();
        await signIn(oldPage);
        await oldPage.goto('/devices/1');
        await expect(oldPage.getByText('WS · 已连接')).toBeVisible();
        await signIn(newPage);
        await expect(oldPage).toHaveURL('/login');
        await expect(oldPage.getByRole('status')).toContainText('另一端登录');
        await expect(oldPage.getByRole('navigation', { name: '主导航' })).toHaveCount(0);
        expect((await first.request.get('/api/auth/me')).status()).toBe(401);
        expect((await second.request.get('/api/auth/me')).status()).toBe(200);
        await oldPage.reload();
        await expect(oldPage).toHaveURL('/login');
        await expect(newPage).toHaveURL('/');
    } finally {
        await first.close();
        await second.close();
    }
});

test('password validation and password change end the session', async ({ page }) => {
    await signIn(page);
    await page.goto('/settings/account');
    await page.getByLabel('原密码', { exact: true }).fill('mtx123');
    await page.getByLabel('新密码', { exact: true }).fill('changed-test-password');
    await page.getByLabel('确认新密码', { exact: true }).fill('not-matching');
    await page.getByRole('button', { name: '更新密码并退出' }).click();
    await expect(page.getByRole('alert')).toHaveText('两次新密码不一致');
    await page.getByLabel('确认新密码', { exact: true }).fill('changed-test-password');
    await page.getByRole('button', { name: '更新密码并退出' }).click();
    await expect(page).toHaveURL('/login');
    expect((await page.request.get('/api/auth/me')).status()).toBe(401);
    await signIn(page, 'changed-test-password');
    // Only the disposable browser-test database is changed; restore its seed for other tests.
    const restored = await page.request.post('/api/auth/change-password', {
        headers: { 'X-Boundary-Request': '1' },
        data: { oldPassword: 'changed-test-password', newPassword: 'mtx123' },
    });
    expect(restored.status()).toBe(200);
});
