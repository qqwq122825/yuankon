import { test, expect } from '@playwright/test';

test('numeric device IDs, server sorting/search, memo titles and keyboard detail navigation', async ({
    page,
}) => {
    await page.goto('/login');
    await page.getByRole('textbox', { name: '账号', exact: true }).fill('mtx');
    await page.getByLabel('密码', { exact: true }).fill('mtx123');
    await page.getByRole('button', { name: '登录', exact: true }).click();
    await expect(page).toHaveURL('/');
    await page.goto('/?q=DEMO-&source=sample&sort=id&direction=asc&page=1');
    await expect(page.locator('.fleet-id')).toHaveText([
        '1',
        '2',
        '3',
        '4',
        '5',
        '6',
        '7',
        '8',
        '9',
        '10',
    ]);
    for (const viewport of [
        { width: 1440, height: 900 },
        { width: 800, height: 800 },
    ]) {
        await page.setViewportSize(viewport);
        const cells = page.locator('.fleet-device-row .fleet-id');
        for (const cell of await cells.all()) {
            const rowId = await cell.locator('xpath=ancestor::tr').getAttribute('data-device-id');
            await expect(cell).toHaveText(rowId);
            await expect(cell).toHaveAttribute('title', rowId);
        }
        if (viewport.width === 800) {
            expect(
                await page.evaluate(() => document.documentElement.scrollWidth),
            ).toBeGreaterThanOrEqual(1280);
            expect(
                await page.locator('.fleet-table-wrap').evaluate((el) => {
                    el.scrollLeft = 120;
                    return el.scrollLeft;
                }),
            ).toBeGreaterThan(0);
        }
        await page.screenshot({
            path: `test-results/device-numeric-id-${viewport.width}.png`,
            fullPage: true,
        });
    }
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.getByRole('button', { name: '下一页', exact: true }).click();
    await expect(page.locator('.fleet-id')).toHaveText(['11', '12']);
    await page.getByRole('button', { name: 'ID ↑', exact: true }).click();
    await expect(page).toHaveURL(/direction=desc/);
    await expect(page).toHaveURL(/page=1/);
    await expect(page).toHaveURL(/source=sample/);
    await expect(page.locator('.fleet-id')).toHaveText([
        '12',
        '11',
        '10',
        '9',
        '8',
        '7',
        '6',
        '5',
        '4',
        '3',
    ]);
    await page.getByRole('textbox', { name: '搜索设备' }).fill('12');
    await page.getByRole('textbox', { name: '搜索设备' }).press('Enter');
    await expect(page.locator('.fleet-id')).toHaveText(['12']);
    const row = page.locator('tr[data-device-id="12"]');
    await row.getByRole('button', { name: /查看 .* 的备忘/ }).click();
    const memos = page.getByRole('dialog', { name: '备忘录 — 12', exact: true });
    await expect(memos).toBeVisible();
    await memos.getByRole('button', { name: '关闭备忘录' }).click();
    await row.focus();
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL('/devices/12');
    await expect(page.locator('.device-system')).toContainText('12 · Android');
    const metadata = page.locator('.metadata-list');
    await expect(
        metadata
            .locator('div')
            .filter({ has: page.getByText('设备 ID', { exact: true }) })
            .locator('dd'),
    ).toHaveText('12');
    await expect(
        metadata
            .locator('div')
            .filter({ has: page.getByText('设备标识', { exact: true }) })
            .locator('dd'),
    ).toHaveText('DEMO-012');
    await page.goto('/?q=999999999&source=sample');
    await expect(page.getByText('暂无匹配设备；可调整筛选条件。')).toBeVisible();
});
