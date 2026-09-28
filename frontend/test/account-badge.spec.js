import { test, expect } from '@playwright/test';

async function login(page) {
    await page.goto('/login');
    await page.getByLabel('账号', { exact: true }).fill('mtx');
    await page.getByLabel('密码', { exact: true }).fill('mtx123');
    await page.getByRole('button', { name: '登录', exact: true }).click();
    await expect(page).toHaveURL('/');
}

test('account has one automatically assigned APK ID and keyboard opens read-only account details', async ({
    page,
}) => {
    await login(page);
    const { user } = await (await page.request.get('/api/auth/me')).json();
    expect(user.apkId).toMatch(/^[0-9]+$/);
    const badge = page.getByRole('link', { name: '账号设置', exact: true });
    await expect(badge).toContainText(`超管 · APK ${user.apkId}`);
    await expect(badge).toContainText('长期有效');
    await page.goto('/builds');
    await expect(page.getByLabel('新 APK ID', { exact: true })).toHaveCount(0);
    await expect(page.getByRole('button', { name: '生成设备登记码' })).toHaveCount(0);
    await badge.focus();
    await badge.press('Enter');
    await expect(page).toHaveURL('/settings/account');
    await expect(page.locator('.account-apk-list')).toHaveText(user.apkId);
    await expect(page.locator('.account-facts')).toContainText('长期有效');
    await page.screenshot({ path: 'test-results/account-badge-desktop.png' });
    await page.setViewportSize({ width: 800, height: 800 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeGreaterThanOrEqual(
        1280,
    );
    await page.reload();
    await expect(badge).toContainText(`APK ${user.apkId}`);
});

test('account date badge renders active, expiring and expired states from explicit profile fixtures', async ({
    page,
}) => {
    await login(page);
    let validUntil = Date.parse('2099-10-12T00:00:00+08:00');
    await page.route('**/api/auth/me', async (route) => {
        const response = await route.fetch();
        const body = await response.json();
        body.user = {
            ...body.user,
            username: 'fixture_user',
            role: 'member',
            apkId: '10074',
            validUntil,
        };
        await route.fulfill({ response, json: body });
    });
    await page.reload();
    const badge = page.getByRole('link', { name: '账号设置', exact: true });
    await expect(badge).toContainText('fixture_user');
    await expect(badge).toContainText('员工 · APK 10074');
    await expect(badge.locator('.account-validity')).toHaveText('到期 2099-10-11');
    await expect(badge.locator('.account-validity')).toHaveClass(/active/);
    validUntil = Date.now() + 86400000;
    await page.reload();
    await expect(badge.locator('.account-validity')).toHaveClass(/expiring/);
    validUntil = Date.now() - 86400000;
    await page.reload();
    await expect(badge.locator('.account-validity')).toHaveClass(/expired/);
    await expect(badge).toContainText('已到期');
    await page.getByRole('button', { name: '切换明暗主题' }).click();
    await page.screenshot({ path: 'test-results/account-badge-expired-fixture-dark.png' });
});
