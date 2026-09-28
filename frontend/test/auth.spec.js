import { test, expect } from '@playwright/test';

async function signIn(page, password = 'mtx123') {
    await page.goto('/login');
    await page.getByRole('textbox', { name: '账号', exact: true }).fill('mtx');
    await page.getByLabel('密码', { exact: true }).fill(password);
    await page.getByRole('button', { name: '登录', exact: true }).click();
    await expect(page).toHaveURL('/');
    await expect(page.getByText('WS · 已连接')).toBeVisible();
}

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
