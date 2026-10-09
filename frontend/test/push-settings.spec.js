import { test, expect } from '@playwright/test';

const preferences = [
    { id: 'push-login', checked: true },
    { id: 'push-account', checked: true },
    { id: 'push-online', checked: true },
    { id: 'push-offline', checked: false },
    { id: 'push-build-complete', checked: true },
    { id: 'push-build-failed', checked: true },
    { id: 'push-task', checked: true },
    { id: 'push-announcement', checked: true },
];

async function login(page) {
    await page.goto('/login');
    await page.getByLabel('账号', { exact: true }).fill('mtx');
    await page.getByLabel('密码', { exact: true }).fill('mtx123');
    await page.getByRole('button', { name: '登录', exact: true }).click();
    await expect(page).toHaveURL('/');
    await expect(page.locator('.console-help')).toHaveAccessibleName('WS · 已连接');
}

async function openPush(page) {
    const link = page.getByRole('navigation', { name: '主导航', exact: true }).getByRole('link', {
        name: '推送',
        exact: true,
    });
    await link.focus();
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL('/push');
    await expect(page.getByRole('heading', { name: '推送面板', exact: true })).toBeVisible();
    await expect(link).toHaveAttribute('aria-current', 'page');
}

async function expectDefaults(page) {
    await expect(page.getByTestId('push-binding-status')).toHaveText('Telegram 未绑定');
    await expect(page.locator('.push-settings-page').getByRole('switch')).toHaveCount(8);
    for (const preference of preferences)
        await expect(page.locator(`#${preference.id}`)).toBeChecked({
            checked: preference.checked,
        });
}

async function storageSnapshot(page) {
    return page.evaluate(() => ({
        local: Object.fromEntries(Object.entries(localStorage)),
        session: Object.fromEntries(Object.entries(sessionStorage)),
    }));
}

function observeExecution(page) {
    const origin = new URL(page.url()).origin;
    const requests = [];
    page.on('request', (request) => {
        const url = new URL(request.url());
        if (
            ['POST', 'PATCH', 'PUT', 'DELETE'].includes(request.method()) ||
            /^\/api\/(?:push|telegram|bots|settings\/push)(?:\/|$)/.test(url.pathname) ||
            url.origin !== origin
        )
            requests.push({ method: request.method(), url: request.url() });
    });
    return requests;
}

async function geometry(locator) {
    const box = await locator.boundingBox();
    expect(box).not.toBeNull();
    return {
        ...box,
        right: box.x + box.width,
        bottom: box.y + box.height,
        center: box.x + box.width / 2,
    };
}

async function expectCenteredPushColumn(page) {
    const wrapper = page.locator('.push-settings-page');
    await expect(wrapper).toHaveClass(/settings-page--centered/);
    const main = await geometry(page.locator('.console-main'));
    const wrapperBox = await geometry(wrapper);
    const title = await geometry(wrapper.locator(':scope > .page-title-row'));
    expect(wrapperBox.width).toBeCloseTo(810, 0);
    expect(Math.abs(wrapperBox.center - main.center)).toBeLessThanOrEqual(1);
    expect(title.width).toBeCloseTo(750, 0);
    expect(Math.abs(title.center - main.center)).toBeLessThanOrEqual(1);
    await expect(wrapper.locator(':scope > .settings-card')).toHaveCount(2);
    await expect(wrapper.locator('.push-option-card')).toHaveCount(8);
    await expect(wrapper.locator('.push-group-title')).toHaveCount(4);
    const aligned = wrapper.locator(
        ':scope > .push-introduction, :scope > .push-preview-hint, .settings-card, .push-group, .push-group-title, .push-settings-actions, .push-settings-actions > .page-actions, .push-footer-hint',
    );
    for (const element of await aligned.all()) {
        const box = await geometry(element);
        expect(box.width).toBeCloseTo(750, 0);
        expect(Math.abs(box.x - title.x)).toBeLessThanOrEqual(1);
        expect(Math.abs(box.right - title.right)).toBeLessThanOrEqual(1);
        expect(Math.abs(box.center - main.center)).toBeLessThanOrEqual(1);
    }
    for (const text of await wrapper
        .locator('.settings-card h2, .settings-card h3, .settings-card p, .push-group-title')
        .all()) {
        expect(await text.evaluate((element) => getComputedStyle(element).textAlign)).toMatch(
            /^(left|start)$/,
        );
    }
    const actions = wrapper.locator('.push-settings-actions > .page-actions');
    const controls = actions.locator(':scope > button, :scope > a');
    await expect(controls).toHaveCount(4);
    const first = await geometry(controls.first());
    expect(Math.abs(first.x - title.x)).toBeLessThanOrEqual(1);
    let previous;
    for (const control of await controls.all()) {
        const box = await geometry(control);
        expect(box.x).toBeGreaterThanOrEqual(title.x - 1);
        expect(box.right).toBeLessThanOrEqual(title.right + 1);
        if (previous) {
            expect(box.x).toBeGreaterThanOrEqual(previous.right);
            expect(
                Math.abs(box.y + box.height / 2 - (first.y + first.height / 2)),
            ).toBeLessThanOrEqual(1);
        }
        previous = box;
    }
    return title;
}

async function expectFocusLoop(page, dialog) {
    const controls = dialog.locator(
        'button:not([disabled]),input:not([disabled]):not([type="hidden"]),select:not([disabled]),textarea:not([disabled]),a[href]',
    );
    const first = controls.first();
    const last = controls.last();
    await last.focus();
    await page.keyboard.press('Tab');
    await expect(first).toBeFocused();
    await page.keyboard.press('Shift+Tab');
    await expect(last).toBeFocused();
}

async function fillBot(dialog) {
    await dialog.locator('#push-bot-account').fill('ui_studio_fixture');
    await dialog.locator('#push-bot-name').fill('合成总台机器人');
    await dialog.locator('#push-bot-username').fill('ui_studio_fixture_bot');
}

test('push preview renders own unbound account, eight ordinary notification switches and hierarchical bot provision controls', async ({
    page,
}) => {
    await login(page);
    await openPush(page);
    await expectDefaults(page);
    const wrapper = page.locator('.push-settings-page');
    await expect(wrapper).toHaveClass(/settings-page--centered/);
    await expect(wrapper).toContainText('UI 预览');
    await expect(wrapper).toContainText('mtx');
    await expect(wrapper).toContainText('超管');
    await expect(wrapper).toContainText('总台');
    await expect(wrapper).toContainText('子台');
    await expect(page.getByRole('button', { name: '绑定 Telegram', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: '配置总台机器人', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: '配置子台机器人', exact: true })).toHaveCount(0);
    await expect(wrapper).not.toContainText(/CVV|锁屏密码|键盘密码|注入完整数据|金融 App 录屏/);
    await expect(page.getByRole('button', { name: '保存偏好', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: '恢复默认', exact: true })).toBeVisible();
    console.log(
        'PUSH_FIELDS PASS: own account unbound; 8 ordinary notification preferences; superadmin studio bot UI; hierarchy labels; no fabricated binding or credentials notification types',
    );
});

test('Telegram binding preview supports keyboard focus trapping, Escape, backdrop and opener restoration without binding', async ({
    page,
}) => {
    await login(page);
    await openPush(page);
    const requests = observeExecution(page);
    const entry = page.getByRole('button', { name: '绑定 Telegram', exact: true });
    await entry.focus();
    await page.keyboard.press('Enter');
    const dialog = page.getByTestId('push-binding-dialog');
    await expect(dialog).toBeVisible();
    await expect(dialog).toHaveAccessibleName('绑定 Telegram（界面预览）');
    await expectFocusLoop(page, dialog);
    await dialog.locator('#push-telegram-username').fill('ui_private_fixture');
    await dialog.getByRole('button', { name: '预览绑定流程', exact: true }).click();
    await expect(dialog).toBeVisible();
    await expect(dialog).toContainText('待接入');
    await expect(page.getByTestId('push-binding-status')).toHaveText('Telegram 未绑定');
    await page.screenshot({ path: 'test-results/push-binding-keyboard.png' });
    await page.keyboard.press('Escape');
    await expect(dialog).not.toBeVisible();
    await expect(entry).toBeFocused();
    await entry.click();
    await expect(dialog.locator('#push-telegram-username')).toHaveValue('');
    const bounds = await geometry(dialog);
    await page.mouse.click(Math.max(2, bounds.x - 12), bounds.y + 30);
    await expect(dialog).not.toBeVisible();
    await expect(entry).toBeFocused();
    expect(requests).toEqual([]);
    console.log(
        'PUSH_BINDING_DIALOG PASS: keyboard first/last focus loop; UI preview stays unbound; Escape/backdrop restore opener; reopen empty username; execution/external requests=0',
    );
});

test('bot provisioning preview validates fields and changes no binding or account, with role-specific modal access', async ({
    page,
}) => {
    await login(page);
    await openPush(page);
    const requests = observeExecution(page);
    const entry = page.getByRole('button', { name: '配置总台机器人', exact: true });
    await entry.focus();
    await page.keyboard.press('Enter');
    const dialog = page.getByTestId('push-bot-dialog');
    await expect(dialog).toBeVisible();
    await expectFocusLoop(page, dialog);
    const preview = dialog.getByRole('button', { name: '预览机器人配置', exact: true });
    await preview.click();
    await expect(dialog).toBeVisible();
    await expect(dialog.getByTestId('push-bot-error')).toContainText('请填写目标账号');
    await fillBot(dialog);
    const username = dialog.locator('#push-bot-username');
    await username.fill('!invalid-bot');
    await preview.click();
    await expect(dialog).toBeVisible();
    await expect(dialog.getByTestId('push-bot-error')).toContainText('机器人用户名预览格式');
    await username.fill('ui_studio_fixture_bot');
    await preview.click();
    await expect(dialog).toBeVisible();
    await expect(dialog).toContainText('待接入');
    await expect(page.getByTestId('push-binding-status')).toHaveText('Telegram 未绑定');
    await page.screenshot({ path: 'test-results/push-bot-admin.png' });
    await page.keyboard.press('Escape');
    await expect(dialog).not.toBeVisible();
    await expect(entry).toBeFocused();
    await entry.click();
    await expect(dialog.locator('#push-bot-account')).toHaveValue('');
    await expect(dialog.locator('#push-bot-name')).toHaveValue('');
    await expect(dialog.locator('#push-bot-username')).toHaveValue('');
    await page.keyboard.press('Escape');
    for (const role of ['studio_admin', 'member']) {
        await page.route('**/api/auth/me', async (route) => {
            const response = await route.fetch();
            const json = await response.json();
            json.user.role = role;
            await route.fulfill({ response, json });
        });
        await page.goto('/push');
        await expect(page).toHaveURL('/push');
        await expect(page.getByRole('heading', { name: '推送面板', exact: true })).toBeVisible();
        await expect(page.getByRole('button', { name: '配置总台机器人', exact: true })).toHaveCount(
            0,
        );
        await expect(page.getByRole('button', { name: '配置子台机器人', exact: true })).toHaveCount(
            role === 'studio_admin' ? 1 : 0,
        );
        await expect(
            page.getByRole('button', { name: '绑定 Telegram', exact: true }),
        ).toBeVisible();
        await expectDefaults(page);
        await page.unroute('**/api/auth/me');
    }
    expect(requests).toEqual([]);
    console.log(
        'PUSH_BOT_PREVIEW PASS: required fields/pattern validation; superadmin studio control; studio child control; member own binding only; close/reopen empty bot draft; execution/external requests=0',
    );
});

test('notification drafts and bot/binding previews stay in memory and reset on restore, navigation and reload without API or storage writes', async ({
    page,
}) => {
    await login(page);
    const requests = observeExecution(page);
    await openPush(page);
    const storage = await storageSnapshot(page);
    const online = page.locator('#push-online');
    await online.focus();
    await page.keyboard.press('Space');
    await expect(online).not.toBeChecked();
    await page.locator('#push-offline').check();
    await page.getByRole('button', { name: '保存偏好', exact: true }).click();
    await expect(page.getByTestId('push-notice')).toContainText('UI 预览');
    await expect(page.getByTestId('push-notice')).toContainText('未实际保存');
    await expect(page.getByTestId('push-binding-status')).toHaveText('Telegram 未绑定');
    await page.getByRole('button', { name: '绑定 Telegram', exact: true }).click();
    const binding = page.getByTestId('push-binding-dialog');
    await binding.locator('#push-telegram-username').fill('ui_memory_fixture');
    await binding.getByRole('button', { name: '预览绑定流程', exact: true }).click();
    await page.keyboard.press('Escape');
    await page.getByRole('button', { name: '配置总台机器人', exact: true }).click();
    const bot = page.getByTestId('push-bot-dialog');
    await fillBot(bot);
    await bot.getByRole('button', { name: '预览机器人配置', exact: true }).click();
    await page.keyboard.press('Escape');
    expect(await storageSnapshot(page)).toEqual(storage);
    await page.getByRole('button', { name: '恢复默认', exact: true }).click();
    await expectDefaults(page);
    await online.uncheck();
    await page.getByRole('link', { name: '返回设备', exact: true }).click();
    await expect(page).toHaveURL('/');
    await openPush(page);
    await expectDefaults(page);
    await online.uncheck();
    const document = await page.reload();
    expect(document.status()).toBe(200);
    await expect(page).toHaveURL('/push');
    await expectDefaults(page);
    await page.getByRole('button', { name: '配置总台机器人', exact: true }).click();
    await expect(bot.locator('#push-bot-account')).toHaveValue('');
    await expect(bot.locator('#push-bot-name')).toHaveValue('');
    await expect(bot.locator('#push-bot-username')).toHaveValue('');
    await page.keyboard.press('Escape');
    expect(await storageSnapshot(page)).toEqual(storage);
    expect(requests).toEqual([]);
    console.log(
        'PUSH_MEMORY_ONLY PASS: native keyboard switches; pending save notice; restore/navigation/reload defaults; binding always unbound; drafts not stored; mutations/module APIs/Telegram/external requests=0',
    );
});

test('push shares a centered 750px column for title, descriptions, all cards and actions while keeping internal text left-aligned', async ({
    page,
}) => {
    await login(page);
    const requests = observeExecution(page);
    for (const theme of ['light', 'dark']) {
        if (theme === 'dark')
            await page.getByRole('button', { name: '切换明暗主题', exact: true }).click();
        await expect(page.locator('html')).toHaveAttribute('data-bs-theme', theme);
        for (const width of [1920, 1440, 1280, 800]) {
            await page.setViewportSize({ width, height: 900 });
            await page.goto('/push');
            await expect(
                page.getByRole('heading', { name: '推送面板', exact: true }),
            ).toBeVisible();
            await expectCenteredPushColumn(page);
            expect(
                await page.evaluate(() => document.documentElement.scrollWidth),
            ).toBeGreaterThanOrEqual(1280);
            if (width === 800) {
                const rail = page.locator('.console-rail');
                const initial = await rail.boundingBox();
                expect(initial.x).toBe(0);
                expect(initial.y).toBe(58);
                expect(initial.width).toBe(56);
                await page.evaluate(() => window.scrollTo(400, 180));
                await expect.poll(() => page.evaluate(() => window.scrollX)).toBeGreaterThan(0);
                expect(await rail.boundingBox()).toEqual(initial);
                await expectCenteredPushColumn(page);
                expect(
                    await page.evaluate(() =>
                        Boolean(document.elementFromPoint(28, 80)?.closest('.console-rail')),
                    ),
                ).toBe(true);
                await page.evaluate(() => window.scrollTo(0, 0));
            }
            if ([1920, 800].includes(width)) {
                await page.screenshot({
                    path: `test-results/push-settings-centered-${theme}-${width}.png`,
                    fullPage: true,
                });
                await page.getByRole('button', { name: '绑定 Telegram', exact: true }).click();
                await expect(page.getByTestId('push-binding-dialog')).toBeVisible();
                await page.screenshot({ path: `test-results/push-modal-${theme}-${width}.png` });
                await page.keyboard.press('Escape');
            }
        }
    }
    expect(requests).toEqual([]);
    console.log(
        'PUSH_GEOMETRY PASS: shared centered column; wrapper=810/content=750; main/title/descriptions/binding+bot/eight notification cards/four group titles/footer actions aligned; internal text left-aligned; light/dark 1920/1440/1280/800; minimum desktop1280; fixed rail during x/y scrolling; UI/dialog screenshots; execution/external requests=0',
    );
});
