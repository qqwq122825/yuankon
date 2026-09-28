import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';
test('build form, optional fields, failure, polling and shareable artifact download (synthetic queue fixture)', async ({
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
    const form = page.getByRole('form', { name: 'B 包构建配置' });
    const installerForm = page.getByRole('form', { name: 'A 包构建配置' });
    await expect(form.getByLabel('B 包模板版本')).toHaveValue('screenagent-1.3');
    await expect(installerForm.getByLabel('A 包模板版本')).toHaveValue('installer-1.1');
    await expect(installerForm.getByRole('button', { name: '构建 A 包' })).toBeDisabled();
    await form.getByLabel('后台域名').fill('cohuducox');
    await form.getByLabel('APP 名称').fill('UI 构建测试');
    await expect(form.getByLabel('首页地址')).toHaveCount(0);
    await expect(installerForm.getByLabel('首页地址')).toBeVisible();
    const { user } = await (await page.request.get('/api/auth/me')).json();
    await expect(form.getByLabel('APK ID（选填）')).toHaveValue('');
    await form.getByRole('button', { name: '构建 B 包' }).click();
    await expect(page.getByRole('alert')).toContainText('域名简称尚未配置');
    await form.getByLabel('后台域名').fill('local');
    await form.getByRole('button', { name: '随机生成' }).click();
    await expect(form.getByLabel('包名（留空自动生成）')).toHaveValue(/^org\.boundary\.worker\.p/);
    await form.getByLabel('包名（留空自动生成）').fill('');
    const response = page.waitForResponse(
        (r) =>
            r.url().endsWith('/api/builds') &&
            r.request().method() === 'POST' &&
            r.status() === 202,
    );
    await form.getByRole('button', { name: '构建 B 包' }).click();
    const { build } = await (await response).json();
    expect(build.apk_id).toBe(user.apkId);
    expect(build.routing_reason).toBe('default_empty');
    const row = page.locator(`tr[data-build-id="${build.id}"]`);
    await expect(row).toContainText('已完成', { timeout: 15000 });
    await expect(row.getByRole('progressbar', { name: 'UI 构建测试 构建进度' })).toHaveAttribute(
        'aria-valuenow',
        '100',
    );
    await expect(row).toContainText('批次：无');
    await expect(row).toContainText(/^.*org\.boundary\.app\.p/s);
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);
    await row.getByRole('button', { name: '复制链接' }).click();
    const link = await page.getByLabel('可分享下载链接').inputValue();
    expect(link).toContain(`/api/builds/${build.id}/artifact`);
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(link);
    const download = page.waitForEvent('download');
    await row.getByRole('link', { name: '下载 APK' }).click();
    expect(await readFile(await (await download).path(), 'utf8')).toBe(
        'SYNTHETIC-BROWSER-DOWNLOAD-NOT-APK',
    );
    await row.getByRole('button', { name: '构建日志' }).click();
    const bLog = page.getByRole('log');
    await expect(bLog).toContainText('[COMMAND:APKSIGNER_VERIFY] OK');
    await expect(bLog).toContainText('[COMMAND:ZIPALIGN_VERIFY] OK');
    await expect(page.getByRole('button', { name: '刷新日志' })).toBeVisible();
    await row.getByRole('button', { name: '收起日志' }).click();
    await expect(bLog).toHaveCount(0);
    await expect(row).toContainText('未填写，使用默认归属');
    await expect(row).toContainText('B 包');
    await expect(page.getByRole('button', { name: '保存 APK 归属' })).toHaveCount(0);
    await expect(installerForm).toContainText(build.id.slice(0, 8));
    await installerForm.getByLabel('APP 名称').fill('UI 安装器测试');
    await installerForm.getByLabel('首页地址').fill('https://example.com/');
    await installerForm.getByLabel('包名（留空自动生成）').fill('org.test.uiinstaller');
    const installerResponse = page.waitForResponse(
        (r) =>
            r.url().endsWith('/api/builds') &&
            r.request().method() === 'POST' &&
            r.status() === 202,
    );
    await installerForm.getByRole('button', { name: '构建 A 包' }).click();
    const installer = (await (await installerResponse).json()).build;
    expect(installer.payload_build_id).toBe(build.id);
    const installerRow = page.locator(`tr[data-build-id="${installer.id}"]`);
    await expect(installerRow).toContainText('已完成', { timeout: 15000 });
    await expect(installerRow).toContainText('A 包');
    await expect(installerRow).toContainText(`内置 B 包：${build.id.slice(0, 8)}`);
    await installerRow.getByRole('button', { name: '构建日志' }).click();
    await expect(page.getByRole('log')).toContainText('[COMMAND:APKSIGNER_VERIFY] OK');
    await expect(
        installerRow.getByRole('progressbar', { name: 'UI 安装器测试 构建进度' }),
    ).toHaveAttribute('aria-valuenow', '100');
    await page.screenshot({ path: 'test-results/build-center-desktop.png', fullPage: true });
    await page.setViewportSize({ width: 800, height: 800 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeGreaterThanOrEqual(
        1280,
    );
    await page.screenshot({ path: 'test-results/build-center-narrow.png', fullPage: true });
    page.once('dialog', async (dialog) => {
        expect(dialog.message()).toContain('关联 APK 文件和构建日志会同时永久删除');
        await dialog.accept();
    });
    const deletion = page.waitForResponse(
        (r) =>
            r.url().endsWith(`/api/builds/${build.id}`) &&
            r.request().method() === 'DELETE' &&
            r.status() === 200,
    );
    await row.getByRole('button', { name: '删除', exact: true }).click();
    await deletion;
    await expect(row).toHaveCount(0);
    await expect(page.getByRole('status')).toContainText('构建记录、APK 文件和构建日志已删除');
    expect((await page.request.get(`/api/builds/${build.id}`)).status()).toBe(404);
    await form.getByLabel('包名（留空自动生成）').fill('org.test.explicit');
    await form.getByLabel('批次（选填）').fill('FAIL');
    await form.getByLabel('APK ID（选填）').fill('NONEXISTENT_E2E');
    const failure = page.waitForResponse(
        (r) =>
            r.url().endsWith('/api/builds') &&
            r.request().method() === 'POST' &&
            r.status() === 202,
    );
    await form.getByRole('button', { name: '构建 B 包' }).click();
    const bad = (await (await failure).json()).build;
    expect(bad.apk_id).toBe(user.apkId);
    expect(bad.routing_reason).toBe('default_unmatched');
    const failedRow = page.locator(`tr[data-build-id="${bad.id}"]`);
    await expect(failedRow.getByText('失败', { exact: true })).toBeVisible({ timeout: 15000 });
    await expect(failedRow).toContainText('未匹配可用账号，使用默认归属');
    await expect(failedRow).toContainText('填写值：NONEXISTENT_E2E');
    await expect(failedRow.getByRole('link', { name: '下载 APK' })).toHaveCount(0);
    await expect(failedRow.getByRole('button', { name: '删除', exact: true })).toBeEnabled();
    expect(errors).toEqual([]);
});
