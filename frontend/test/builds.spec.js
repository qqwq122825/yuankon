import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';
test('build form, optional fields, failure, polling and authenticated copy/download (synthetic queue fixture)', async ({
    page,
    context,
}) => {
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.goto('/login');
    await page.getByLabel('账号', { exact: true }).fill('mtx');
    await page.getByLabel('密码', { exact: true }).fill('mtx123');
    await page.getByRole('button', { name: '登录', exact: true }).click();
    await expect(page).toHaveURL('/');
    await page.goto('/builds');
    const form = page.getByRole('form', { name: 'APK 构建配置' });
    await expect(form.getByLabel('模板版本')).toHaveValue('screenagent-1.0');
    await form.getByLabel('后台域名').fill('cohuducox');
    await form.getByLabel('APP 名称').fill('UI 构建测试');
    await form.getByLabel('首页网址').fill('https://example.com/');
    await form.getByLabel('APK ID', { exact: true }).fill('BUILD_E2E');
    await form.getByRole('button', { name: '开始构建' }).click();
    await expect(page.getByRole('alert')).toContainText('域名简称尚未配置');
    await form.getByLabel('后台域名').fill('local');
    await form.getByRole('button', { name: '随机生成' }).click();
    await expect(form.getByLabel('包名（留空自动生成）')).toHaveValue(/^org\.boundary\.app\.p/);
    await form.getByLabel('包名（留空自动生成）').fill('');
    const response = page.waitForResponse(
        (r) =>
            r.url().endsWith('/api/builds') &&
            r.request().method() === 'POST' &&
            r.status() === 202,
    );
    await form.getByRole('button', { name: '开始构建' }).click();
    const { build } = await (await response).json();
    const row = page.locator(`tr[data-build-id="${build.id}"]`);
    await expect(row).toContainText('已完成', { timeout: 15000 });
    await expect(row).toContainText('批次：无');
    await expect(row).toContainText(/^.*org\.boundary\.app\.p/s);
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);
    await row.getByRole('button', { name: '复制链接' }).click();
    const link = await page.getByLabel('下载链接（需登录）').inputValue();
    expect(link).toContain(`/api/builds/${build.id}/artifact`);
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(link);
    const download = page.waitForEvent('download');
    await row.getByRole('link', { name: '下载 APK' }).click();
    expect(await readFile(await (await download).path(), 'utf8')).toBe(
        'SYNTHETIC-BROWSER-DOWNLOAD-NOT-APK',
    );
    await expect(page.getByLabel('已配置 APK ID')).toContainText('BUILD_E2E');
    await page.screenshot({ path: 'test-results/build-center-desktop.png', fullPage: true });
    await page.setViewportSize({ width: 800, height: 800 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeGreaterThanOrEqual(
        1280,
    );
    await page.screenshot({ path: 'test-results/build-center-narrow.png', fullPage: true });
    await form.getByLabel('模板版本').selectOption('browser-1.0');
    await form.getByLabel('包名（留空自动生成）').fill('org.test.explicit');
    await form.getByLabel('批次（选填）').fill('FAIL');
    const failure = page.waitForResponse(
        (r) =>
            r.url().endsWith('/api/builds') &&
            r.request().method() === 'POST' &&
            r.status() === 202,
    );
    await form.getByRole('button', { name: '开始构建' }).click();
    const bad = (await (await failure).json()).build;
    const failedRow = page.locator(`tr[data-build-id="${bad.id}"]`);
    await expect(failedRow.getByText('失败', { exact: true })).toBeVisible({ timeout: 15000 });
    await expect(failedRow.getByRole('link', { name: '下载 APK' })).toHaveCount(0);
    expect(errors).toEqual([]);
});
