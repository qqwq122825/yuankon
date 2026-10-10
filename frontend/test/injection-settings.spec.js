import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';

const matchFixture = JSON.parse(
    await readFile(
        new URL('../src/fixtures/device-injection-match-demo.json', import.meta.url),
        'utf8',
    ),
);

const countries = [
    '印度',
    '巴基斯坦',
    '孟加拉',
    '尼泊尔',
    '斯里兰卡',
    '马尔代夫',
    '印尼',
    '菲律宾',
    '越南',
    '泰国',
    '马来西亚',
    '新加坡',
    '文莱',
    '日本',
    '韩国',
    '台湾',
    '香港',
    '蒙古',
    '美国',
    '加拿大',
    '英国',
    '德国',
    '法国',
    '意大利',
    '西班牙',
    '葡萄牙',
    '奥地利',
    '瑞士',
    '比利时',
    '荷兰',
    '爱尔兰',
    '卢森堡',
    '马耳他',
    '瑞典',
    '挪威',
    '丹麦',
    '芬兰',
    '爱沙尼亚',
    '拉脱维亚',
    '立陶宛',
    '俄罗斯',
    '乌克兰',
    '波兰',
    '捷克',
    '匈牙利',
];

async function login(page) {
    await page.goto('/login');
    await page.getByLabel('账号', { exact: true }).fill('mtx');
    await page.getByLabel('密码', { exact: true }).fill('mtx123');
    await page.getByRole('button', { name: '登录', exact: true }).click();
    await expect(page).toHaveURL('/');
    await expect(page.locator('.console-help')).toHaveAccessibleName('WS · 已连接');
}

function countryButton(page, name = '印度') {
    return page.getByRole('button', { name: `${name} APP 注入配置`, exact: true });
}

function countryDialog(page, name = '印度') {
    return page.getByRole('dialog', { name: `${name} APP 注入配置`, exact: true });
}

async function openInjection(page) {
    const link = page.getByRole('navigation', { name: '主导航', exact: true }).getByRole('link', {
        name: '注入',
        exact: true,
    });
    await link.focus();
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL('/injection');
    await expect(page.getByRole('heading', { name: '注入管理', exact: true })).toBeVisible();
    await expect(link).toHaveAttribute('aria-current', 'page');
}

async function storageSnapshot(page) {
    return page.evaluate(() => ({
        local: Object.fromEntries(Object.entries(localStorage)),
        session: Object.fromEntries(Object.entries(sessionStorage)),
    }));
}

async function geometry(locator) {
    const box = await locator.boundingBox();
    expect(box).not.toBeNull();
    return { ...box, right: box.x + box.width, bottom: box.y + box.height };
}

async function expectGlobalDemo(page) {
    const section = page.getByTestId('injection-global-demo-list');
    await expect(section).toBeVisible();
    await expect(section).toHaveAccessibleName('全局注入列表（假数据）');
    await expect(section).toHaveAttribute('data-protocol', 'mtx-injection-match-demo/v1');
    await expect(section).toHaveAttribute('data-registry-id', 'DEMO-REGISTRY-01');
    await expect(section).toHaveAttribute('data-fixture-only', 'true');
    await expect(section).toContainText('只读假数据 · 非设备扫描结果');
    await expect(section.locator('.injection-global-demo-count')).toHaveText(
        '共 6 项 · 5 项样例启用',
    );
    await expect(section.locator('thead th')).toHaveText(['名称', '示例包名', '启用状态']);
    const rows = section.locator('.injection-global-demo-row');
    await expect(rows).toHaveCount(6);
    expect(await rows.evaluateAll((items) => items.map((item) => item.dataset.templateId))).toEqual(
        matchFixture.globalInjectionList.map((item) => item.id),
    );
    for (const item of matchFixture.globalInjectionList) {
        const row = section.locator(`.injection-global-demo-row[data-template-id="${item.id}"]`);
        await expect(row).toHaveAttribute('data-enabled', String(item.enabled));
        await expect(row.locator('.injection-global-demo-name')).toContainText(item.name);
        await expect(row.locator('.injection-global-demo-package')).toHaveText(item.packageName);
        await expect(row.locator('.injection-global-demo-status')).toHaveText(
            item.enabled ? '样例启用' : '样例停用',
        );
    }
    await expect(section.locator('button, input, select, textarea, a[href]')).toHaveCount(0);
    return section;
}

async function expectDefaults(page) {
    await expectGlobalDemo(page);
    await expect(page.locator('.injection-country-card')).toHaveCount(45);
    for (const name of countries) {
        await expect(countryButton(page, name)).toContainText(name);
        await expect(countryButton(page, name)).toContainText('12/12 演示开启');
    }
}

test('injection preview exposes the wide workflow and all 45 regions with synthetic grouped templates', async ({
    page,
}) => {
    await login(page);
    await openInjection(page);
    const wrapper = page.locator('.injection-settings-page');
    await expect(wrapper).not.toHaveClass(/settings-page--centered/);
    await expect(wrapper).toContainText('UI预览');
    await expect(page.getByRole('heading', { name: '工作流程', exact: true })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'APP 注入', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: '新增模板', exact: true })).toBeVisible();
    await expectDefaults(page);
    expect(
        await page
            .locator('.injection-country-card')
            .evaluateAll((buttons) => buttons.every((button) => button.type === 'button')),
    ).toBe(true);
    await expect(page.locator('.injection-workflow-step')).toHaveCount(4);
    const accessibleNames = await page
        .locator('.injection-country-card')
        .evaluateAll((buttons) => buttons.map((button) => button.getAttribute('aria-label')));
    expect(accessibleNames).toEqual(countries.map((name) => `${name} APP 注入配置`));
    const entry = countryButton(page, '尼泊尔');
    await entry.click();
    const dialog = countryDialog(page, '尼泊尔');
    await expect(dialog).toBeVisible();
    await expect(dialog).toContainText('演示配置');
    await expect(dialog.getByRole('heading', { name: /通用界面/ })).toContainText('6/6');
    await expect(dialog.getByRole('heading', { name: /状态展示/ })).toContainText('4/4');
    await expect(dialog.getByRole('heading', { name: /辅助示例/ })).toContainText('2/2');
    const rows = dialog.locator('.injection-template-row');
    await expect(rows).toHaveCount(12);
    await expect(dialog.getByRole('switch')).toHaveCount(12);
    for (const [index, row] of (await rows.all()).entries()) {
        await expect(row).toContainText(
            `com.example.preview.np.sample${String(index + 1).padStart(2, '0')}`,
        );
        await expect(row.getByRole('switch')).toBeEnabled();
        await expect(row.getByRole('switch')).toBeChecked();
    }
    await expect(dialog.getByRole('button', { name: /^编辑 / })).toHaveCount(12);
    await page.keyboard.press('Escape');
    await expect(dialog).toHaveCount(0);
    await expect(entry).toBeFocused();
    console.log(
        'INJECTION_FIELDS PASS: wide workflow; 45 region cards; 12 synthetic templates per region; categories=6/4/2; superadmin switches/edit controls; no reference app data',
    );
});

test('injection region dialog supports internal scrolling, switch keyboard editing, focus trapping and Escape restoration', async ({
    page,
}) => {
    await login(page);
    await openInjection(page);
    const entry = countryButton(page);
    await entry.focus();
    await page.keyboard.press('Enter');
    const dialog = countryDialog(page);
    const close = dialog.getByRole('button', { name: '关闭配置弹窗', exact: true });
    await expect(dialog).toBeVisible();
    await expect(close).toBeFocused();
    const headerBeforeScroll = await geometry(dialog.locator('.injection-dialog-header'));
    const list = dialog.getByTestId('injection-template-list');
    const scroll = await list.evaluate((element) => {
        element.scrollTop = element.scrollHeight;
        return {
            top: element.scrollTop,
            height: element.scrollHeight,
            client: element.clientHeight,
        };
    });
    expect(scroll.height).toBeGreaterThan(scroll.client);
    expect(scroll.top).toBeGreaterThan(0);
    expect(await geometry(dialog.locator('.injection-dialog-header'))).toEqual(headerBeforeScroll);
    const lastSwitch = dialog.getByRole('switch').last();
    await lastSwitch.focus();
    await expect(lastSwitch).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(close).toBeFocused();
    await page.keyboard.press('Shift+Tab');
    await expect(lastSwitch).toBeFocused();
    const firstSwitch = dialog.getByRole('switch').first();
    await firstSwitch.focus();
    await expect(firstSwitch).toBeFocused();
    await page.keyboard.press('Space');
    await expect(firstSwitch).not.toBeChecked();
    await expect(entry).toContainText('11/12 演示开启');
    await page.screenshot({ path: 'test-results/injection-dialog-keyboard.png' });
    await page.keyboard.press('Escape');
    await expect(dialog).toHaveCount(0);
    await expect(entry).toBeFocused();
    await entry.click();
    await expect(dialog).toBeVisible();
    const bounds = await geometry(dialog);
    await page.mouse.click(Math.max(2, bounds.x - 12), bounds.y + 30);
    await expect(dialog).toHaveCount(0);
    await expect(entry).toBeFocused();
    await page.getByRole('button', { name: '刷新', exact: true }).focus();
    await page.keyboard.press('Enter');
    await expect(entry).toContainText('12/12 演示开启');
    await expect(page.locator('.injection-settings-page [role="status"]')).toContainText(
        '配置接口待接入',
    );
    console.log(
        'INJECTION_DIALOG PASS: internal scroll; first/last keyboard focus loop; native switch draft; header fixed on body scroll; Escape/backdrop restore region focus; refresh restores initial switches',
    );
});

test('superadmin edits and adds only memory drafts, sends no execution or storage writes, and refresh/navigation reset them', async ({
    page,
}) => {
    let observing = false;
    const requests = [];
    const frames = [];
    page.on('request', (request) => {
        if (observing)
            requests.push({
                url: request.url(),
                method: request.method(),
                body: request.postData() || '',
            });
    });
    page.on('websocket', (socket) =>
        socket.on('framesent', (event) => {
            if (observing) frames.push(String(event.payload));
        }),
    );
    await login(page);
    const origin = new URL(page.url()).origin;
    observing = true;
    await openInjection(page);
    const storage = await storageSnapshot(page);
    await countryButton(page).click();
    const dialog = countryDialog(page);
    await dialog.getByRole('button', { name: '编辑 通用模板 01', exact: true }).click();
    const editor = page.getByRole('dialog', { name: '编辑模板', exact: true });
    await expect(editor).toBeVisible();
    await expect(editor.getByLabel('模板名称', { exact: true })).toHaveValue('通用模板 01');
    await expect(editor.getByLabel('示例包名', { exact: true })).toHaveValue(
        'com.example.preview.in.sample01',
    );
    await expect(editor.getByLabel('地区', { exact: true })).toBeDisabled();
    await expect(editor.getByLabel('模板名称', { exact: true })).toHaveAttribute('maxlength', '60');
    const packageField = editor.getByLabel('示例包名', { exact: true });
    await packageField.fill('not-a-preview-package');
    expect(await packageField.evaluate((input) => input.validity.patternMismatch)).toBe(true);
    await editor.getByRole('button', { name: '应用到预览', exact: true }).click();
    await expect(editor).toBeVisible();
    await editor.getByLabel('模板名称', { exact: true }).fill('UI 合成模板');
    await editor.getByLabel('示例包名', { exact: true }).fill('com.example.preview.in.edited');
    await editor.getByRole('button', { name: '应用到预览', exact: true }).click();
    await expect(editor).toHaveCount(0);
    await expect(dialog.locator('.injection-template-row').first()).toContainText('UI 合成模板');
    await expect(dialog.locator('.injection-template-row').first()).toContainText(
        'com.example.preview.in.edited',
    );
    await expect(page.locator('.injection-settings-page [role="status"]')).toContainText(
        '已修改演示模板',
    );
    await page.keyboard.press('Escape');
    await expect(dialog).toHaveCount(0);
    const add = page.getByRole('button', { name: '新增模板', exact: true });
    await add.focus();
    await page.keyboard.press('Enter');
    const newEditor = page.getByRole('dialog', { name: '新增模板', exact: true });
    await expect(newEditor).toBeVisible();
    await newEditor.getByLabel('模板名称', { exact: true }).fill('UI 取消草稿');
    await newEditor.getByRole('button', { name: '取消', exact: true }).click();
    await expect(newEditor).toHaveCount(0);
    await expect(add).toBeFocused();
    await add.click();
    await expect(newEditor).toBeVisible();
    await expect(newEditor.getByLabel('模板名称', { exact: true })).toHaveValue('');
    await newEditor.getByLabel('地区', { exact: true }).selectOption('in');
    await newEditor.getByLabel('模板名称', { exact: true }).fill('UI 新增模板');
    await newEditor.getByLabel('示例包名', { exact: true }).fill('com.example.preview.in.edited');
    await newEditor.getByRole('button', { name: '应用到预览', exact: true }).click();
    await expect(newEditor.getByRole('alert')).toHaveText('当前地区已有相同的示例包名。');
    await newEditor.getByLabel('示例包名', { exact: true }).fill('com.example.preview.in.added');
    await newEditor.getByRole('button', { name: '应用到预览', exact: true }).click();
    await expect(newEditor).toHaveCount(0);
    await expect(add).toBeFocused();
    await expect(page.locator('.injection-settings-page [role="status"]')).toContainText(
        '已添加演示模板',
    );
    await countryButton(page).click();
    await expect(dialog.locator('.injection-template-row')).toHaveCount(13);
    await expect(dialog).toContainText('UI 新增模板');
    await expect(dialog).toContainText('com.example.preview.in.added');
    await page.keyboard.press('Escape');
    expect(await storageSnapshot(page)).toEqual(storage);
    await page.getByRole('button', { name: '刷新', exact: true }).click();
    await expectDefaults(page);
    await countryButton(page).click();
    await expect(dialog.locator('.injection-template-row')).toHaveCount(12);
    await expect(dialog).not.toContainText('UI 合成模板');
    await expect(dialog).not.toContainText('UI 新增模板');
    await dialog.getByRole('switch').first().uncheck();
    await page.keyboard.press('Escape');
    await page
        .getByRole('navigation', { name: '主导航', exact: true })
        .getByRole('link', { name: '设备', exact: true })
        .click();
    await expect(page).toHaveURL('/');
    await openInjection(page);
    await expectDefaults(page);
    await countryButton(page).click();
    await dialog.getByRole('switch').first().uncheck();
    await page.keyboard.press('Escape');
    const document = await page.reload();
    expect(document.status()).toBe(200);
    await expect(page).toHaveURL('/injection');
    await expect(page.locator('.console-help')).toHaveAccessibleName('WS · 已连接');
    await expectDefaults(page);
    expect(await storageSnapshot(page)).toEqual(storage);
    expect(requests.length).toBeGreaterThan(0);
    for (const request of requests) {
        const url = new URL(request.url);
        expect(url.origin).toBe(origin);
        expect(request.method).toBe('GET');
        expect(url.pathname).not.toMatch(
            /^\/api\/(?:injection|settings\/injection|templates)(?:\/|$)/,
        );
        expect(`${request.url}\n${request.body}`).not.toMatch(
            /com\.example\.preview\.in\.(?:added|edited)/,
        );
    }
    for (const payload of frames) {
        expect(payload).not.toMatch(/com\.example\.preview\.in\.(?:added|edited)/);
        expect(['get_bot_list', 'subscribe', 'unsubscribe', 'ping']).toContain(
            JSON.parse(payload).type,
        );
    }
    expect(JSON.stringify(await storageSnapshot(page))).not.toContain('UI 新增模板');
    console.log(
        'INJECTION_DRAFT PASS: superadmin local edit/add; 13th preview row; notices say pending; HTTP same-origin GET only; WS no execution; storage unchanged; refresh/route departure/reload reset all drafts',
    );
});

test('studio and member role-display fixtures can inspect but never edit preview switches or templates', async ({
    page,
}) => {
    await login(page);
    for (const role of ['studio_admin', 'member']) {
        await page.route('**/api/auth/me', async (route) => {
            const response = await route.fetch();
            const json = await response.json();
            json.user.role = role;
            await route.fulfill({ response, json });
        });
        await page.goto('/injection');
        await expect(page).toHaveURL('/injection');
        await expect(page.locator('.injection-settings-page')).toContainText('只读模式');
        await expect(page.getByRole('button', { name: '新增模板', exact: true })).toHaveCount(0);
        if (role === 'member')
            await expect(
                page.getByRole('navigation', { name: '主导航', exact: true }).getByRole('link'),
            ).toHaveText(['设备', '注入', '构建', '推送']);
        await expectDefaults(page);
        const entry = countryButton(page);
        await entry.focus();
        await page.keyboard.press('Enter');
        const dialog = countryDialog(page);
        const close = dialog.getByRole('button', { name: '关闭配置弹窗', exact: true });
        await expect(dialog).toBeVisible();
        await expect(close).toBeFocused();
        await expect(dialog.getByRole('switch')).toHaveCount(12);
        for (const checkbox of await dialog.getByRole('switch').all()) {
            await expect(checkbox).toBeDisabled();
            await expect(checkbox).toBeChecked();
        }
        await expect(dialog.getByRole('button', { name: /^编辑 / })).toHaveCount(0);
        await page.keyboard.press('Tab');
        await expect(close).toBeFocused();
        await page.keyboard.press('Shift+Tab');
        await expect(close).toBeFocused();
        await page.keyboard.press('Escape');
        await expect(dialog).toHaveCount(0);
        await expect(entry).toBeFocused();
        const document = await page.reload();
        expect(document.status()).toBe(200);
        await expect(page).toHaveURL('/injection');
        await expect(page.locator('.injection-settings-page')).toContainText('只读模式');
        await expect(page.getByRole('button', { name: '新增模板', exact: true })).toHaveCount(0);
        await page.unroute('**/api/auth/me');
    }
    console.log(
        'INJECTION_READONLY_UI PASS: studio/member role-display fixtures; allowed route+refresh; no add/edit; 12 disabled checked switches; close-only focus loop; actual authenticated roles tested separately in accounts.spec.js',
    );
});

test('injection preview keeps the wide desktop grid and fixed rail in light/dark wide and narrow windows', async ({
    page,
}) => {
    await login(page);
    await openInjection(page);
    for (const theme of ['light', 'dark']) {
        if (theme === 'dark')
            await page.getByRole('button', { name: '切换明暗主题', exact: true }).click();
        await expect(page.locator('html')).toHaveAttribute('data-bs-theme', theme);
        for (const width of [1920, 1440, 1280, 800]) {
            await page.setViewportSize({ width, height: 900 });
            await page.evaluate(() => window.scrollTo(0, 0));
            const main = await geometry(page.locator('.console-main'));
            const wrapper = page.locator('.injection-settings-page');
            await expect(wrapper).not.toHaveClass(/settings-page--centered/);
            const title = await geometry(wrapper.locator(':scope > .page-title-row'));
            expect(title.width).toBeGreaterThan(1000);
            expect(title.x - main.x).toBeCloseTo(30, 0);
            await expectDefaults(page);
            const cards = page.locator('.injection-country-card');
            const first = await geometry(cards.nth(0));
            const second = await geometry(cards.nth(1));
            expect(first.width).toBeGreaterThan(100);
            expect(first.height).toBeGreaterThanOrEqual(65);
            expect(first.height).toBeLessThanOrEqual(100);
            expect(second.y).toBeCloseTo(first.y, 0);
            expect(second.x).toBeGreaterThan(first.right);
            const ninth = await geometry(cards.nth(8));
            const tenth = await geometry(cards.nth(9));
            expect(ninth.y).toBeCloseTo(first.y, 0);
            expect(tenth.y).toBeGreaterThan(first.bottom);
            expect(tenth.x).toBeCloseTo(first.x, 0);

            expect(
                await page.evaluate(() => document.documentElement.scrollWidth),
            ).toBeGreaterThanOrEqual(1280);
            const rail = page.locator('.console-rail');
            const initial = await rail.boundingBox();
            expect(initial.x).toBe(0);
            expect(initial.y).toBe(58);
            expect(initial.width).toBe(width >= 1800 ? 64 : 56);
            await page.evaluate(() => window.scrollTo(400, document.documentElement.scrollHeight));
            if (width === 800)
                await expect.poll(() => page.evaluate(() => window.scrollX)).toBeGreaterThan(0);
            expect(await rail.boundingBox()).toEqual(initial);
            expect(
                await page.evaluate(() =>
                    Boolean(document.elementFromPoint(28, 80)?.closest('.console-rail')),
                ),
            ).toBe(true);
            await page.evaluate(() => window.scrollTo(0, 0));
            if (width === 1920 || width === 800)
                await page.screenshot({
                    path: `test-results/injection-settings-${theme}-${width}.png`,
                    fullPage: true,
                });
            await countryButton(page, '尼泊尔').focus();
            await page.keyboard.press('Enter');
            const dialog = countryDialog(page, '尼泊尔');
            await expect(dialog).toBeVisible();
            const box = await geometry(dialog);
            expect(box.width).toBeCloseTo(560, 0);
            expect(box.height).toBeLessThanOrEqual(900);
            await expect(
                dialog.getByRole('button', { name: '关闭配置弹窗', exact: true }),
            ).toBeFocused();
            if (width === 1920 || width === 800)
                await page.screenshot({
                    path: `test-results/injection-modal-${theme}-${width}.png`,
                });
            await page.keyboard.press('Escape');
            await expect(dialog).toHaveCount(0);
            await expect(countryButton(page, '尼泊尔')).toBeFocused();
            expect(await rail.boundingBox()).toEqual(initial);
        }
    }
    console.log(
        'INJECTION_GEOMETRY PASS: light/dark 1920/1440/1280/800; wide title/grid; 45 compact cards; 1280px minimum canvas; horizontal scroll; fixed 56/64px rail; modal size/keyboard/focus restoration; eight screenshots',
    );
});

test('global injection demo registry is the same read-only six-item fixture used by the four matched device shortcuts', async ({
    page,
}) => {
    await login(page);
    const origin = new URL(page.url()).origin;
    const requests = [];
    const commands = [];
    const errors = [];
    const downloads = [];
    page.on('request', (request) =>
        requests.push({ method: request.method(), url: request.url() }),
    );
    page.on('websocket', (socket) =>
        socket.on('framesent', ({ payload }) => {
            try {
                const message = JSON.parse(String(payload));
                if (message.type === 'command') commands.push(message);
            } catch {
                /* Non-JSON heartbeat frames do not contain commands. */
            }
        }),
    );
    page.on('pageerror', (error) => errors.push(error.message));
    page.on('download', (download) => downloads.push(download.suggestedFilename()));
    await openInjection(page);
    const storage = await storageSnapshot(page);
    const section = await expectGlobalDemo(page);
    const initialRows = await section.locator('.injection-global-demo-row').evaluateAll((rows) =>
        rows.map((row) => ({
            id: row.dataset.templateId,
            enabled: row.dataset.enabled,
            packageName: row.querySelector('.injection-global-demo-package').textContent.trim(),
        })),
    );
    expect(initialRows.map((row) => row.enabled)).toEqual([
        'true',
        'true',
        'true',
        'true',
        'true',
        'false',
    ]);
    await page.goto('/devices/1');
    await expect(page.locator('.device-workbench')).toBeVisible();
    await page
        .locator('.device-topbar')
        .getByRole('checkbox', { name: '快捷预览', exact: true })
        .check();
    const quick = page.locator('.device-preview-panel[data-instance="quick"]');
    await expect(quick).toHaveAttribute('aria-busy', 'false');
    await expect(quick).toHaveAttribute('data-demo', 'true');
    await expect(quick.locator('.template-demo-card')).toHaveCount(4);
    const installed = new Set(matchFixture.installedApplications.map((item) => item.packageName));
    const expected = initialRows.filter(
        (row) => row.enabled === 'true' && installed.has(row.packageName),
    );
    expect(expected.map((row) => row.id)).toEqual([
        'DEMO-TEMPLATE-A',
        'DEMO-TEMPLATE-B',
        'DEMO-TEMPLATE-C',
        'DEMO-TEMPLATE-D',
    ]);
    expect(
        await quick.locator('.template-demo-card').evaluateAll((cards) =>
            cards.map((card) => ({
                id: card.dataset.demoApp,
                packageName: card.dataset.package,
            })),
        ),
    ).toEqual(expected.map(({ id, packageName }) => ({ id, packageName })));
    await expect(quick.locator('.template-demo-details')).toHaveCount(1);
    await page.goto('/injection');
    await expectGlobalDemo(page);
    await page.getByRole('button', { name: '刷新', exact: true }).focus();
    await page.keyboard.press('Enter');
    await expectGlobalDemo(page);
    expect(await storageSnapshot(page)).toEqual(storage);
    for (const request of requests) {
        expect(request.method).toBe('GET');
        expect(new URL(request.url).origin).toBe(origin);
        expect(new URL(request.url).pathname).not.toMatch(
            /^\/api\/(?:injection|settings\/injection|templates)(?:\/|$)/,
        );
    }
    expect(commands).toEqual([]);
    expect(errors).toEqual([]);
    expect(downloads).toEqual([]);
    console.log(
        'INJECTION_GLOBAL_MATCH PASS: six readonly registry rows/five enabled; same fixed package registry as exact four device intersection; disabledF/uninstalledE/unlistedG excluded; no controls or config API; refresh preserves registry/storage; only same-origin GET, no WScommands/external/downloads',
    );
});
