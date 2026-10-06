import { test, expect } from '@playwright/test';
import { randomUUID } from 'node:crypto';
const password = 'FixturePass123!';
async function login(page, username = 'mtx', pass = 'mtx123') {
    await page.goto('/login');
    await page.getByRole('textbox', { name: '账号', exact: true }).fill(username);
    await page.getByLabel('密码', { exact: true }).fill(pass);
    await page.getByRole('button', { name: '登录', exact: true }).click();
    await expect(page).toHaveURL('/');
}
async function logout(page) {
    await page.goto('/settings/account');
    await page.getByRole('button', { name: '退出登录' }).click();
    await expect(page).toHaveURL('/login');
}
async function apiCreate(page, username, studio = true, parentId = null) {
    const url = studio ? '/api/accounts/studios' : `/api/accounts/studios/${parentId}/members`;
    const res = await page.request.post(url, {
        headers: { 'X-Boundary-Request': '1' },
        data: {
            requestId: randomUUID(),
            username,
            password,
            confirmPassword: password,
            validUntil: studio ? Date.parse('2027-11-01T00:00:00+08:00') : null,
            note: 'synthetic fixture',
            ...(studio ? { name: '合成总台' } : {}),
        },
    });
    expect(res.status()).toBe(201);
    return (await res.json()).account;
}
test('admin creates studio and member via left navigation, real list refresh, keyboard modal and narrow desktop layout', async ({
    page,
}) => {
    await login(page);
    await page.getByRole('link', { name: '账号', exact: true }).click();
    await expect(page).toHaveURL('/accounts');
    await expect(page.getByRole('heading', { name: '总台账号管理' })).toBeVisible();
    await expect(
        page.getByText(
            '总台到期未续费时，本台及子账号的设备自动归超管；历史记录保留，续费不自动归还已接管设备。',
        ),
    ).toBeVisible();
    const username = `ui_${randomUUID().slice(0, 8)}`;
    const create = page.getByRole('button', { name: '创建总台', exact: true });
    await create.click();
    await expect(page.getByLabel('总台名称')).toBeFocused();
    await page.getByLabel('总台名称').fill('界面合成总台');
    await page.getByLabel('账号', { exact: true }).fill(username);
    await page.getByLabel('初始 / 新密码').fill(password);
    await page.getByLabel('确认密码').fill(password);
    await page.getByLabel('到期日（北京时间）').fill('2027-10-31');
    await page.getByLabel('备注', { exact: true }).fill('界面测试');
    await page.getByRole('button', { name: '保存', exact: true }).click();
    await expect(page.getByRole('status')).toContainText(`已创建 ${username} · APK ID`);
    const row = page.getByRole('row').filter({ hasText: username });
    await expect(row).toContainText('界面合成总台');
    await row.getByRole('link', { name: '子账号', exact: true }).click();
    await expect(page.getByRole('heading', { name: '子账号管理' })).toBeVisible();
    const newMember = page.getByRole('button', { name: '创建子账号', exact: true });
    await newMember.click();
    await page.getByLabel('账号', { exact: true }).press('Escape');
    await expect(newMember).toBeFocused();
    await newMember.click();
    await page.getByLabel('账号', { exact: true }).fill(`${username}_m`);
    await page.getByLabel('初始 / 新密码').fill(password);
    await page.getByLabel('确认密码').fill(password);
    await expect(page.getByRole('checkbox', { name: '继承总台有效期' })).toBeChecked();
    await page.getByRole('button', { name: '保存', exact: true }).click();
    await expect(page.getByRole('row').filter({ hasText: `${username}_m` })).toContainText(
        '继承总台',
    );
    await expect(page.getByText(/已启用 1 \/ 5/)).toBeVisible();
    const memberRow = page.getByRole('row').filter({ hasText: `${username}_m` });
    await memberRow.getByRole('button', { name: '停用', exact: true }).click();
    await expect(memberRow.getByRole('button', { name: '启用', exact: true })).toBeVisible();
    await memberRow.getByRole('button', { name: '启用', exact: true }).click();
    await expect(memberRow.getByRole('button', { name: '停用', exact: true })).toBeVisible();
    await page.screenshot({ path: 'test-results/accounts-desktop.png', fullPage: true });
    await page.setViewportSize({ width: 800, height: 900 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeGreaterThan(800);
    await expect(page.locator('.console-rail')).toBeVisible();
    await page.screenshot({ path: 'test-results/accounts-narrow.png', fullPage: true });
});
test('actual studio/member login shows role menus and inherited validity and blocks management/log deep links', async ({
    page,
}) => {
    await login(page);
    const username = `role_${randomUUID().slice(0, 8)}`;
    const studio = await apiCreate(page, username);
    const member = await apiCreate(page, `${username}_m`, false, studio.id);
    await logout(page);
    await login(page, username, password);
    await expect(page.getByRole('navigation', { name: '主导航' }).getByRole('link')).toHaveText([
        '设备',
        '账号',
        '构建',
        '翻译',
    ]);
    await page.goto('/accounts');
    await expect(page.getByRole('heading', { name: '子账号管理' })).toBeVisible();
    await expect(page.getByRole('row').filter({ hasText: member.username })).toBeVisible();
    await page.goto('/logs');
    await expect(page).toHaveURL('/');
    await page.goto('/');
    await expect(page.getByText('暂无匹配设备；可调整筛选条件。', { exact: true })).toBeVisible();
    await logout(page);
    await login(page, member.username, password);
    await expect(page.getByRole('navigation', { name: '主导航' }).getByRole('link')).toHaveText([
        '设备',
        '构建',
    ]);
    await expect(page.locator('.console-account')).toContainText('子账号');
    await expect(page.locator('.console-account')).not.toContainText('长期有效');
    for (const path of ['/accounts', '/settings/translation', '/logs', '/protocol']) {
        await page.goto(path);
        await expect(page).toHaveURL('/');
    }
    await page.goto('/settings/account');
    await expect(page.getByRole('heading', { name: `${member.username} · 子账号` })).toBeVisible();
    await expect(page.getByText('账号有效期（继承总台）')).toBeVisible();
});
test('account duplicate/business errors leave form usable and reset password/validity changes are real', async ({
    page,
}) => {
    await login(page);
    const name = `edit_${randomUUID().slice(0, 8)}`;
    const studio = await apiCreate(page, name);
    await page.goto('/accounts');
    const row = page.getByRole('row').filter({ hasText: name });
    await row.getByRole('button', { name: '期限', exact: true }).click();
    await expect(
        page.getByText('续期仅恢复账号使用期限；已归超管的设备不会自动归还。'),
    ).toBeVisible();
    await page.getByLabel('到期日（北京时间）').fill('2027-12-31');
    await page.getByRole('button', { name: '保存', exact: true }).click();
    await expect(row).toContainText('2027-12-31');
    await row.getByRole('button', { name: '重置密码', exact: true }).click();
    await page.getByLabel('初始 / 新密码').fill('NewFixturePass123!');
    await page.getByLabel('确认密码').fill('NewFixturePass123!');
    await page.getByRole('button', { name: '保存', exact: true }).click();
    await expect(page.getByRole('status')).toContainText('原登录会话已撤销');
    const res = await page.request.get(`/api/accounts?parentId=${studio.id}`);
    expect(res.status()).toBe(200);
    await page.getByRole('button', { name: '创建总台', exact: true }).click();
    await page.getByLabel('总台名称').fill('重复测试');
    await page.getByLabel('账号', { exact: true }).fill(name);
    await page.getByLabel('初始 / 新密码').fill(password);
    await page.getByLabel('确认密码').fill(password);
    await page.getByLabel('到期日（北京时间）').fill('2027-10-31');
    await page.getByRole('button', { name: '保存', exact: true }).click();
    await expect(page.getByRole('alert')).toContainText('账号已存在');
    await page.getByRole('button', { name: '取消', exact: true }).click();
    await logout(page);
    await login(page, name, 'NewFixturePass123!');
    await expect(page.locator('.console-account')).toContainText('2027-12-31');
});

test('expired studio fleet is visibly taken over and renewal does not return the device', async ({
    page,
}) => {
    await login(page);
    const username = `expire_${randomUUID().slice(0, 8)}`;
    const created = await page.request.post('/api/accounts/studios', {
        headers: { 'X-Boundary-Request': '1' },
        data: {
            requestId: randomUUID(),
            username,
            password,
            confirmPassword: password,
            validUntil: Date.now() + 2000,
            name: '到期合成总台',
            note: 'expiry fixture',
        },
    });
    expect(created.status()).toBe(201);
    const studio = (await created.json()).account;
    const deviceId = `EXPIRY-UI-${randomUUID().slice(0, 8)}`;
    const online = await page.request.post('/api/client/online', {
        headers: { 'X-Boundary-Request': '1' },
        data: {
            deviceId,
            apkId: studio.apkId,
            model: '到期合成设备',
            brand: 'Fixture',
            osVersion: '15',
        },
    });
    expect(online.status()).toBe(201);
    const device = await online.json();
    await expect(async () => {
        const response = await page.request.get(`/api/accounts?q=${username}`);
        expect(response.status()).toBe(200);
        expect((await response.json()).data[0].expiryTakeover?.deviceCount).toBe(1);
    }).toPass({ timeout: 7000, intervals: [100, 200] });
    await page.goto('/accounts');
    const row = page.getByRole('row').filter({ hasText: username });
    await expect(row).toContainText('最近到期接管 1 台');
    await page.screenshot({ path: 'test-results/accounts-expiry-takeover.png', fullPage: true });
    await row.getByRole('button', { name: '期限', exact: true }).click();
    await page.getByLabel('到期日（北京时间）').fill('2027-12-31');
    await page.getByRole('button', { name: '保存', exact: true }).click();
    await expect(row).toContainText('2027-12-31');
    await expect(row).toContainText('最近到期接管 1 台');
    const owner = await page.request.get(`/api/devices/${device.localId}/ownership`);
    expect((await owner.json()).owner.username).toBe('mtx');
    await logout(page);
    await login(page, username, password);
    await expect(page.getByText('暂无匹配设备；可调整筛选条件。', { exact: true })).toBeVisible();
    expect((await page.request.get(`/api/devices/${device.localId}`)).status()).toBe(404);
    // Remove only this synthetic fixture from the shared fleet listing.
    await logout(page);
    await login(page);
    const cleanup = await page.request.delete(`/api/devices/${device.localId}`, {
        headers: { 'X-Boundary-Request': '1' },
        data: {},
    });
    expect(cleanup.status()).toBe(200);
});
