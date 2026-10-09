import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';

test.beforeEach(async ({ page }) => {
    await page.goto('/login');
    await page.getByRole('textbox', { name: '账号', exact: true }).fill('mtx');
    await page.getByLabel('密码', { exact: true }).fill('mtx123');
    await page.getByRole('button', { name: '登录', exact: true }).click();
    await expect(page).toHaveURL('/');
});

test('server logs deep link, filters, incremental refresh and JSONL export work on desktop and narrow windows', async ({
    page,
}) => {
    await page.goto('/logs');
    await expect(page.getByRole('heading', { name: '服务器日志' })).toBeVisible();
    await expect(page.getByRole('columnheader', { name: '设备', exact: true })).toHaveCount(0);
    await expect(page.getByRole('columnheader', { name: '级别' })).toBeVisible();
    await page.getByLabel('日志分类').selectOption('runtime');
    await expect(page.locator('tbody')).toContainText('server_listening');
    await expect(page.locator('tbody')).toContainText('application_ready');
    const download = page.waitForEvent('download');
    await page.getByRole('link', { name: '导出今日 UTC JSONL' }).click();
    const file = await download;
    const exported = (await readFile(await file.path(), 'utf8'))
        .split('\n')
        .filter(Boolean)
        .map(JSON.parse);
    expect(exported.length).toBeGreaterThan(0);
    expect(
        exported.every((row) => row.category === 'runtime' && !Object.hasOwn(row, 'device_id')),
    ).toBe(true);
    await page.getByLabel('日志级别').selectOption('warn');
    await expect(page.getByText('暂无服务器日志', { exact: true })).toBeVisible();
    await page.getByLabel('日志级别').selectOption('');
    await page.getByLabel('日志分类').selectOption('http');
    await page.getByRole('checkbox', { name: '实时增量' }).check();
    await page.evaluate(() => fetch('/api/system/info'));
    await expect(page.locator('tbody')).toContainText('/api/system/info', { timeout: 6000 });
    await page.getByRole('checkbox', { name: '实时增量' }).uncheck();
    const refresh = page.getByRole('button', { name: '刷新', exact: true });
    await refresh.focus();
    await refresh.press('Enter');
    await expect(page.locator('.card')).toHaveAttribute('aria-busy', 'false');
    await page.screenshot({ path: 'test-results/server-logs-desktop.png', fullPage: true });
    await page.setViewportSize({ width: 800, height: 900 });
    await expect(page.getByRole('heading', { name: '服务器日志' })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeGreaterThan(800);
    await page.screenshot({ path: 'test-results/server-logs-narrow.png', fullPage: true });
});

test('ordinary role has no log navigation and cannot open either log page by URL', async ({
    page,
}) => {
    // Frontend role-display fixture; actual studio/member login is covered in accounts.spec.js.
    await page.route('**/api/auth/me', async (route) => {
        const response = await route.fetch();
        const json = await response.json();
        json.user.role = 'member';
        await route.fulfill({ response, json });
    });
    await page.goto('/');
    await expect(page.getByRole('navigation', { name: '主导航' }).getByRole('link')).toHaveText([
        '设备',
        '注入',
        '构建',
        '推送',
    ]);
    await expect(page.getByRole('link', { name: '日志', exact: true })).toHaveCount(0);
    await expect(page.locator('a[href="/protocol"]')).toHaveCount(0);
    const logRequests = [];
    page.on('request', (request) => {
        const pathname = new URL(request.url()).pathname;
        if (/^\/api\/(?:logs|ai|injection|push|performance)(?:\/|$)/.test(pathname))
            logRequests.push(request.url());
    });
    await page.goto('/injection');
    await expect(page).toHaveURL('/injection');
    await expect(page.getByRole('heading', { name: '注入管理', exact: true })).toBeVisible();
    await expect(page.locator('.injection-settings-page')).toContainText('只读模式');
    const document = await page.reload();
    expect(document.status()).toBe(200);
    await expect(page).toHaveURL('/injection');
    await expect(page.locator('.injection-settings-page')).toContainText('只读模式');
    await page.goto('/push');
    await expect(page).toHaveURL('/push');
    await expect(page.getByRole('heading', { name: '推送面板', exact: true })).toBeVisible();
    const pushDocument = await page.reload();
    expect(pushDocument.status()).toBe(200);
    await expect(page).toHaveURL('/push');
    await expect(page.getByRole('heading', { name: '推送面板', exact: true })).toBeVisible();
    for (const path of ['/logs', '/protocol', '/ai', '/blacklist', '/performance']) {
        await page.goto(path);
        await expect(page).toHaveURL('/');
    }
    expect(logRequests).toEqual([]);
});

test('log API errors are displayed without stale rows after switching filters', async ({
    page,
}) => {
    await page.goto('/logs');
    await expect(page.locator('tbody')).toContainText('http_request');
    await page.route('**/api/logs/server/tail?**', (route) =>
        route.fulfill({ status: 500, json: { error: '服务器日志读取失败（测试）' } }),
    );
    await page.getByLabel('日志级别').selectOption('error');
    await expect(page.getByRole('alert')).toContainText('服务器日志读取失败（测试）');
    await expect(page.getByText('暂无服务器日志', { exact: true })).toBeVisible();
});
