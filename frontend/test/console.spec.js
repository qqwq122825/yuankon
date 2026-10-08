import { test, expect } from '@playwright/test';

test.beforeEach(async ({ page }) => {
    await page.goto('/login');
    await page.getByRole('textbox', { name: '账号', exact: true }).fill('mtx');
    await page.getByLabel('密码', { exact: true }).fill('mtx123');
    await page.getByRole('button', { name: '登录', exact: true }).click();
    await expect(page).toHaveURL('/');
});

test('list, server sorting, query preservation, pagination, empty state and keyboard search', async ({
    page,
}) => {
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.goto('/');
    await expect(page.getByText('WS · 已连接')).toBeVisible();
    await expect(page.getByRole('navigation', { name: '主导航' }).getByRole('link')).toHaveText([
        '设备',
        '账号',
        '构建',
        '翻译',
        '日志',
    ]);
    await expect(page.locator('tbody tr')).toHaveCount(10);
    await expect(page.locator('.fleet-table thead')).toContainText('ID');
    await expect(page.locator('.fleet-table thead')).toContainText('壁纸');
    await expect(page.locator('.fleet-table thead')).toContainText('账号');
    await expect(page.locator('.fleet-table thead')).toContainText('备注');
    await expect(page.locator('.fleet-table thead')).toContainText('备忘');
    await expect(page.locator('.fleet-table thead')).toContainText('注入');
    await expect(page.locator('.fleet-table thead')).toContainText('AI');
    await expect(page.locator('.fleet-table thead')).toContainText('安装时间');
    await expect(page.locator('tbody tr').first()).toContainText('—');
    const tableMetrics = await page
        .locator('.fleet-table tbody tr')
        .first()
        .evaluate((row) => {
            const table = row.closest('table');
            const header = table.querySelector('thead tr');
            const headerCell = header.querySelector('th');
            const bodyCell = row.querySelector('td');
            const preview = row.querySelector('.phone-preview');
            const box = (element) => {
                const rect = element.getBoundingClientRect();
                return { width: Math.round(rect.width), height: Math.round(rect.height) };
            };
            return {
                row: box(row),
                header: box(header),
                preview: box(preview),
                headerFont: getComputedStyle(headerCell).fontSize,
                bodyFont: getComputedStyle(bodyCell).fontSize,
                bodyPadding: getComputedStyle(bodyCell).padding,
            };
        });
    expect(tableMetrics.row.height).toBe(85);
    expect(tableMetrics.header.height).toBe(36);
    expect(tableMetrics.preview).toEqual({ width: 36, height: 64 });
    expect(tableMetrics.headerFont).toBe('11px');
    expect(tableMetrics.bodyFont).toBe('13px');
    expect(tableMetrics.bodyPadding).toBe('10px 14px');
    const noteButton = page.getByRole('button', {
        name: '编辑 测试设备 1 的备注',
        exact: true,
    });
    await expect(noteButton).toHaveText('合成示例');
    await noteButton.click();
    await expect(page).toHaveURL('/');
    const noteEditor = page.getByRole('textbox', {
        name: '编辑 测试设备 1 的备注',
        exact: true,
    });
    await expect(noteEditor).toBeFocused();
    await page.screenshot({ path: 'test-results/device-note-inline-editor.png', fullPage: true });
    await noteEditor.fill('');
    await noteEditor.press('Enter');
    await expect(page.getByRole('status')).toHaveText('测试设备 1备注已保存');
    await expect(noteButton).toHaveText('点击备注');
    await noteButton.click();
    await noteEditor.fill('列表内联备注');
    await noteEditor.press('Enter');
    await expect(page.getByRole('status')).toHaveText('测试设备 1备注已保存');
    await expect(noteButton).toHaveText('列表内联备注');
    await expect(page).toHaveURL('/');
    await page.getByRole('button', { name: '查看 测试设备 1 的备忘（0 条）', exact: true }).click();
    const memos = page.getByRole('dialog', { name: '备忘录 — 1' });
    await expect(memos).toContainText('共 0 条');
    await memos.getByRole('button', { name: '＋ 添加' }).click();
    await memos.getByRole('textbox', { name: '备忘内容' }).fill('E2E 跟进记录');
    await memos.getByRole('button', { name: '待跟进', exact: true }).click();
    await memos.getByRole('button', { name: '保存', exact: true }).click();
    await expect(memos).toContainText('共 1 条');
    await expect(memos).toContainText('E2E 跟进记录');
    await page.screenshot({ path: 'test-results/device-memo-dialog.png', fullPage: true });
    await memos.getByRole('button', { name: '编辑', exact: true }).click();
    await memos.getByRole('textbox', { name: '备忘内容' }).fill('E2E 已处理记录');
    await memos.getByRole('button', { name: '已处理', exact: true }).click();
    await memos.getByRole('button', { name: '更新', exact: true }).click();
    await expect(memos).toContainText('E2E 已处理记录');
    page.once('dialog', (dialog) => dialog.accept());
    await memos.getByRole('button', { name: '删除', exact: true }).click();
    await expect(memos).toContainText('共 0 条');
    await memos.getByRole('button', { name: '关闭备忘录' }).click();
    await expect(memos).toHaveCount(0);
    await expect(
        page.getByRole('button', { name: '查看 测试设备 1 的备忘（0 条）', exact: true }),
    ).toBeVisible();
    await page.setViewportSize({ width: 2400, height: 900 });
    await page.screenshot({ path: 'test-results/device-table-reference.png', fullPage: true });
    await expect(page.locator('.fleet-table-wrap')).toHaveAttribute('aria-busy', 'false');
    const filterRequests = [];
    const recordFilterRequest = (request) => {
        if (new URL(request.url()).pathname === '/api/devices') filterRequests.push(request.url());
    };
    page.on('request', recordFilterRequest);
    const onlineFilter = page.getByRole('button', { name: '在线', exact: true });
    await expect(onlineFilter).toHaveAttribute('aria-pressed', 'false');
    await onlineFilter.click();
    await expect(page).toHaveURL(/status=online/);
    await expect(onlineFilter).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByText('暂无匹配设备；可调整筛选条件。')).toBeVisible();
    await onlineFilter.click();
    await expect(page).not.toHaveURL(/status=online/);
    await expect(page.locator('tbody tr')).toHaveCount(10);
    await page.getByRole('button', { name: '无障碍', exact: true }).click();
    await expect(page).toHaveURL(/a11y=enabled/);
    await expect(page.locator('tbody tr')).toHaveCount(10);
    for (const name of ['设备上报', '历史记录', '合成示例'])
        await expect(page.getByRole('button', { name, exact: true })).toHaveCount(0);
    await page.getByRole('button', { name: '清除筛选', exact: true }).click();
    await expect(page.locator('tbody tr')).toHaveCount(10);
    await page.getByRole('button', { name: '下一页' }).click();
    await expect(page).toHaveURL(/page=2/);
    await expect(page.locator('tbody tr')).toHaveCount(2);
    expect(filterRequests).toEqual([]);
    page.off('request', recordFilterRequest);
    await page.getByRole('button', { name: /ID ⇅|ID ↑/ }).click();
    await expect(page).toHaveURL(/page=1/);
    await expect(page.locator('tbody tr').first().locator('.fleet-id')).toHaveText('12');
    await page.getByRole('checkbox', { name: '选择当前页' }).check();
    await expect(page.getByText('已选择 10 台')).toBeVisible();
    await page.getByRole('textbox', { name: '搜索设备' }).fill('DEMO-001');
    await page.getByRole('textbox', { name: '搜索设备' }).press('Enter');
    await expect(page.locator('tbody tr')).toHaveCount(1);
    await expect(page.locator('tbody tr').first().locator('.fleet-id')).toHaveText('1');
    await page.getByRole('textbox', { name: '搜索设备' }).fill('nothing');
    await page.getByRole('textbox', { name: '搜索设备' }).press('Enter');
    await expect(page.getByText('暂无匹配设备；可调整筛选条件。')).toBeVisible();
    expect(errors).toEqual([]);
});
test('detail saves notes, keeps screenshots at 300px, resizes reader, drags and closes', async ({
    page,
}) => {
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.goto('/devices/1');
    await expect(page.getByRole('button', { name: /^BOUNDARY\s*开始$/ })).toBeVisible();
    await expect(page.getByText('只读查看', { exact: true })).toHaveCount(0);
    await page.getByRole('textbox', { name: '设备备注' }).fill('Vue 自动化备注');
    await page.getByRole('button', { name: '保存备注' }).click();
    await expect(page.getByRole('status')).toHaveText('备注已保存');
    await page.reload();
    await expect(page.getByRole('textbox', { name: '设备备注' })).toHaveValue('Vue 自动化备注');
    await page.getByRole('button', { name: '截图 + 阅读器' }).click();
    const reader = page.getByRole('region', { name: '阅读器', exact: true }),
        shot = page.getByRole('region', { name: '截图', exact: true });
    await expect(reader).toBeVisible();
    await expect(shot).toBeVisible();
    expect((await reader.boundingBox()).width).toBe(300);
    expect((await shot.boundingBox()).width).toBe(300);
    await expect(reader.locator('.width-control')).toHaveCount(1);
    await expect(shot.locator('.width-control')).toHaveCount(0);
    await expect(shot.getByRole('button', { name: '放大截图', exact: true })).toHaveCount(0);
    await reader.getByRole('button', { name: '放大阅读器', exact: true }).click();
    expect((await reader.boundingBox()).width).toBe(320);
    expect((await shot.boundingBox()).width).toBe(300);
    await expect(reader.getByRole('tab')).toHaveCount(0);
    await expect(reader.getByRole('textbox')).toHaveCount(0);
    await expect(reader.locator('.reader-map-stage')).toBeVisible();
    await expect(reader.locator('.reader-map-node')).toHaveCount(19);
    const heading = shot.locator('header'),
        box = await heading.boundingBox();
    await page.mouse.move(box.x + 50, box.y + 15);
    await page.mouse.down();
    await page.mouse.move(0, 0);
    await page.mouse.up();
    expect(await shot.boundingBox()).toMatchObject({ x: 0, y: 0, width: 300 });
    await page.screenshot({ path: 'test-results/viewer-full-window.png', fullPage: true });
    await page.keyboard.press('Escape');
    await expect(shot).toHaveCount(0);
    await expect(reader).toBeVisible();
    await page.getByRole('button', { name: '关闭全部浮窗' }).click();
    await expect(reader).toHaveCount(0);
    expect(errors).toEqual([]);
});
test('narrow viewport keeps 1280 desktop canvas and parallel independent viewers', async ({
    page,
}) => {
    await page.setViewportSize({ width: 800, height: 800 });
    await page.goto('/devices/1');
    await page.getByRole('button', { name: '截图 + 阅读器' }).click();
    const shot = await page.getByRole('region', { name: '截图', exact: true }).boundingBox(),
        reader = await page.getByRole('region', { name: '阅读器', exact: true }).boundingBox();
    expect(shot.width).toBe(300);
    expect(reader.width).toBe(300);
    expect(shot.y).toBe(reader.y);
    expect(reader.x).toBeGreaterThanOrEqual(shot.x + shot.width);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeGreaterThanOrEqual(
        1280,
    );
    await page.screenshot({ path: 'test-results/narrow-desktop.png', fullPage: true });
});
test('left navigation stays anchored during vertical and horizontal scrolling and remains usable', async ({
    page,
}) => {
    await page.setViewportSize({ width: 1440, height: 500 });
    const rail = page.locator('.console-rail');
    const initial = await rail.boundingBox();
    expect(initial.x).toBe(0);
    expect(initial.y).toBe(58);
    expect(initial.width).toBe(56);
    expect(initial.height).toBe(442);
    expect((await page.locator('main').boundingBox()).x).toBe(initial.width);
    await page.evaluate(() => window.scrollTo(0, 350));
    await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(0);
    expect(await rail.boundingBox()).toEqual(initial);
    await page.screenshot({ path: 'test-results/fixed-rail-vertical.png' });

    await page.setViewportSize({ width: 800, height: 500 });
    await page.evaluate(() => window.scrollTo(400, 250));
    await expect.poll(() => page.evaluate(() => window.scrollX)).toBeGreaterThan(0);
    expect(await rail.boundingBox()).toEqual(initial);
    expect(
        await page.evaluate(
            () => document.elementFromPoint(28, 80)?.closest('.console-rail') !== null,
        ),
    ).toBe(true);
    await page.screenshot({ path: 'test-results/fixed-rail-narrow.png' });
    const nav = page.getByRole('navigation', { name: '主导航' });
    await nav.getByRole('link', { name: '构建', exact: true }).click();
    await expect(page).toHaveURL('/builds');
    await expect(nav.getByRole('link', { name: '构建', exact: true })).toHaveClass(/active/);
    await nav.getByRole('link', { name: '翻译', exact: true }).focus();
    await nav.getByRole('link', { name: '翻译', exact: true }).press('Enter');
    await expect(page).toHaveURL('/settings/translation');
    await expect(nav.getByRole('link', { name: '翻译', exact: true })).toHaveClass(/active/);
    await page.goto('/devices/1');
    await expect(rail).toHaveCount(0);
    await page.goto('/');
    await page.setViewportSize({ width: 1920, height: 900 });
    const large = await rail.boundingBox();
    expect(large).toEqual({ x: 0, y: 58, width: 64, height: 842 });
});
test('translation validation, build center, server logs and protocol audit', async ({ page }) => {
    await page.goto('/settings/translation');
    await expect(page.getByRole('heading', { name: '翻译设置' })).toBeVisible();
    await expect(page.getByRole('button', { name: '验证已保存密钥' })).toBeDisabled();
    await page.getByRole('checkbox', { name: '启用翻译' }).check();
    await page.getByRole('button', { name: '保存设置' }).click();
    await expect(page.getByRole('alert')).toContainText('请填写翻译 API Key');
    await page.getByRole('link', { name: '构建', exact: true }).click();
    await expect(page.getByText(/Telegram 发送待接入/)).toBeVisible();
    await page.getByRole('link', { name: '日志', exact: true }).click();
    await expect(page).toHaveURL('/logs');
    await expect(page.getByRole('heading', { name: '服务器日志' })).toBeVisible();
    await expect(page.getByText('快照档案', { exact: true })).toHaveCount(0);
    await expect(page.getByText('观察记录', { exact: true })).toHaveCount(0);
    await page.goto('/protocol');
    await expect(page.getByRole('heading', { name: '协议审计' })).toBeVisible();
    await page.getByRole('checkbox', { name: '实时增量' }).check();
    await page.getByRole('button', { name: '刷新', exact: true }).click();
    await expect(page.locator('tbody')).toContainText('panel');
});
test('WS reconnects after a real socket drop without stale duplicate subscriptions', async ({
    page,
    request,
}) => {
    await page.goto('/devices/1');
    await expect(page.getByText('WS · 已连接')).toBeVisible();
    const health = await request.get('/api/health');
    const closed = page.waitForEvent('websocket');
    process.kill(Number(health.headers()['x-test-server-pid']), 'SIGUSR2');
    await closed;
    await expect(page.getByText('WS · 已连接')).toBeVisible();
    await page.getByRole('button', { name: '查询状态' }).click();
    await expect(page.getByRole('status')).toContainText('已请求服务端已知状态');
});
