import { test, expect } from '@playwright/test';
import { mkdir, readFile } from 'node:fs/promises';
import path from 'node:path';

const fixture = JSON.parse(
    await readFile(new URL('../src/fixtures/device-ui-demo.json', import.meta.url), 'utf8'),
);
const titles = { password: '密码事件预览', quick: '快捷预览' };
const toggles = { password: '密码事件', quick: '快捷预览' };
const panel = (page, instance) =>
    page.locator(`.device-preview-panel[data-instance="${instance}"]`);
const previewWindow = (page, instance) =>
    page.locator('.floating-viewer-preview').filter({ has: panel(page, instance) });
const demoToggle = (page, instance) =>
    previewWindow(page, instance).getByRole('button', { name: '测试数据', exact: true });
const topToggle = (page, instance) =>
    page.locator('.device-topbar').getByRole('checkbox', { name: toggles[instance], exact: true });

async function login(page) {
    await page.goto('/login');
    await page.getByLabel('账号', { exact: true }).fill('mtx');
    await page.getByLabel('密码', { exact: true }).fill('mtx123');
    await page.getByRole('button', { name: '登录', exact: true }).click();
    await expect(page).toHaveURL('/');
    await expect(page.locator('.console-help')).toHaveAccessibleName('WS · 已连接');
}

async function openDetail(page, id = 1) {
    await page.goto(`/devices/${id}`);
    await expect(page.locator('.device-workbench')).toBeVisible();
    await expect(page.getByRole('textbox', { name: '设备备注', exact: true })).toBeVisible();
}

async function openPanel(page, instance) {
    await topToggle(page, instance).check();
    await expect(panel(page, instance)).toBeVisible();
    await expect(panel(page, instance)).toHaveAttribute('aria-busy', 'false');
    await expect(previewWindow(page, instance)).toHaveAccessibleName(titles[instance]);
}

async function expectDefault(page, instance) {
    await expect(panel(page, instance)).toHaveAttribute('aria-busy', 'false');
    await expect(panel(page, instance)).toHaveAttribute('data-demo', 'false');
    await expect(demoToggle(page, instance)).toHaveAttribute('aria-pressed', 'false');
    await expect(panel(page, instance).locator('.device-preview-count')).toHaveText(/共\s*0\s*项/);
    await expect(panel(page, instance)).toContainText('未接入');
    await expect(panel(page, instance).locator('.lock-event-demo, .template-demo')).toHaveCount(0);
    await expectNoDownload(page, instance);
}

async function expectNoDownload(page, instance) {
    await expect(previewWindow(page, instance).getByRole('button', { name: /下载/ })).toHaveCount(
        0,
    );
    await expect(previewWindow(page, instance).locator('a[download]')).toHaveCount(0);
}

async function enableDemo(page, instance) {
    await demoToggle(page, instance).click();
    await expect(demoToggle(page, instance)).toHaveAttribute('aria-pressed', 'true');
    await expect(panel(page, instance)).toHaveAttribute('data-demo', 'true');
    await expect(panel(page, instance)).toContainText('合成测试数据 · 非设备记录');
    await expect(
        panel(page, instance).locator(
            instance === 'password' ? '.lock-event-demo' : '.template-demo',
        ),
    ).toBeVisible();
    await expectNoDownload(page, instance);
}

function observe(page) {
    const mutations = [];
    const external = [];
    const commands = [];
    const errors = [];
    const downloads = [];
    page.on('request', (request) => {
        const url = new URL(request.url());
        if (['http:', 'https:'].includes(url.protocol) && url.origin !== 'http://127.0.0.1:8081')
            external.push(url.href);
        if (['POST', 'PATCH', 'PUT', 'DELETE'].includes(request.method()))
            mutations.push({ method: request.method(), path: url.pathname });
    });
    page.on('websocket', (socket) => {
        socket.on('framesent', ({ payload }) => {
            try {
                const message = JSON.parse(String(payload));
                if (message.type === 'command') commands.push(message);
            } catch {
                // Non-JSON heartbeat frames are not device commands.
            }
        });
    });
    page.on('pageerror', (error) => errors.push(error.message));
    page.on('download', (download) => downloads.push(download.suggestedFilename()));
    return { mutations, external, commands, errors, downloads };
}

function expectNoExecution(observation, allowedAuth = false) {
    expect(
        allowedAuth
            ? observation.mutations.filter((request) => !request.path.startsWith('/api/auth/'))
            : observation.mutations,
    ).toEqual([]);
    expect(observation.external).toEqual([]);
    expect(observation.commands).toEqual([]);
    expect(observation.errors).toEqual([]);
    expect(observation.downloads).toEqual([]);
}

async function installClipboardProbe(page, fail = false) {
    await page.addInitScript(
        ({ fail }) => {
            window.__mtxDemoClipboard = [];
            window.__mtxDemoCopyFailure = fail;
            Object.defineProperty(navigator, 'clipboard', {
                configurable: true,
                value: {
                    async writeText(value) {
                        if (window.__mtxDemoCopyFailure)
                            throw new DOMException(
                                'Synthetic clipboard permission denial',
                                'NotAllowedError',
                            );
                        window.__mtxDemoClipboard.push(value);
                    },
                },
            });
        },
        { fail },
    );
}

test('fixed preview panels default to honest empty API data and independently opt in to explicit synthetic fixtures', async ({
    page,
}) => {
    const observation = observe(page);
    await login(page);
    observation.mutations.length = 0;
    await openDetail(page);
    for (const [instance, section] of [
        ['password', 'password'],
        ['quick', 'templates'],
    ]) {
        const response = page.waitForResponse(
            (result) =>
                new URL(result.url()).pathname === `/api/devices/1/ui-preview/${section}` &&
                result.request().method() === 'GET',
        );
        await openPanel(page, instance);
        const returned = await response;
        expect(returned.status()).toBe(200);
        expect(await returned.json()).toMatchObject({
            mode: 'preview',
            implemented: false,
            state: 'not_connected',
            total: 0,
            items: [],
        });
        await expectDefault(page, instance);
        await expect(panel(page, instance).getByRole('combobox')).toHaveCount(0);
        await expect(panel(page, instance).locator('.device-preview-action')).toHaveCount(0);
    }
    await enableDemo(page, 'password');
    await expectDefault(page, 'quick');
    await expect(previewWindow(page, 'password').locator('.device-demo-count')).toHaveText('16 条');
    await expect(panel(page, 'password').locator('.lock-event-demo-record')).toHaveCount(16);
    await enableDemo(page, 'quick');
    await expect(previewWindow(page, 'quick').locator('.device-demo-count')).toHaveText(
        '已提交 1/2',
    );
    await expect(panel(page, 'quick').locator('.template-demo-card')).toHaveCount(2);
    await demoToggle(page, 'password').click();
    await expectDefault(page, 'password');
    await expect(panel(page, 'quick').locator('.template-demo')).toBeVisible();
    await demoToggle(page, 'quick').click();
    await expectDefault(page, 'quick');
    const after = await (await page.request.get('/api/devices/1/ui-preview/password')).json();
    expect(after.items).toEqual([]);
    expect(after.total).toBe(0);
    expectNoExecution(observation);
    console.log(
        'DEVICE_PANEL_DEMO_DEFAULT PASS: real GET empty/not_connected; two independent opt-in fixture toggles; 16 events/1-of-2 submitted samples; no download button/anchor in either mode; POST/WS commands/external/downloads=0',
    );
});

test('lock event demo tabs, selection and nine-point patterns copy only synthetic JSON and keep preview actions local', async ({
    page,
}) => {
    await installClipboardProbe(page);
    const observation = observe(page);
    await login(page);
    observation.mutations.length = 0;
    await openDetail(page);
    await openPanel(page, 'password');
    await enableDemo(page, 'password');
    const demo = panel(page, 'password').locator('.lock-event-demo');
    const tab = (category) => demo.locator(`.lock-event-demo-tab[data-category="${category}"]`);
    const row = (id) => demo.locator(`.lock-event-demo-record[data-record-id="${id}"]`);
    for (const [category, label, count, selectedId] of [
        ['all', '全部', 16, 'DEMO-EVENT-01'],
        ['system', '系统', 12, 'DEMO-EVENT-01'],
        ['scenario', '样例', 1, 'DEMO-EVENT-13'],
        ['app', 'APP', 3, 'DEMO-EVENT-14'],
    ]) {
        await tab(category).click();
        await expect(tab(category)).toHaveText(`${label} ${count}`);
        await expect(tab(category)).toHaveAttribute('aria-pressed', 'true');
        await expect(demo.locator('.lock-event-demo-record')).toHaveCount(count);
        await expect(row(selectedId)).toHaveAttribute('aria-pressed', 'true');
        await expect(demo.locator('.lock-event-demo-record[aria-pressed="true"]')).toHaveCount(1);
    }
    await tab('all').click();
    const selected = fixture.lockEvents.find((record) => record.id === 'DEMO-EVENT-02');
    await row(selected.id).focus();
    await page.keyboard.press('Enter');
    await expect(row(selected.id)).toHaveAttribute('aria-pressed', 'true');
    await expect(row(selected.id)).toHaveClass(/selected/);
    await expect(row(selected.id)).toContainText(selected.sampleValue);
    await expect(row(selected.id)).toContainText(selected.source);
    await expect(row(selected.id).locator('.lock-event-demo-pattern i')).toHaveCount(9);
    await expect(row(selected.id).locator('.lock-event-demo-pattern i.lit')).toHaveCount(
        selected.pattern.length,
    );
    expect(
        await row(selected.id)
            .locator('.lock-event-demo-pattern i')
            .evaluateAll((dots) =>
                dots.flatMap((dot, index) => (dot.classList.contains('lit') ? [index + 1] : [])),
            ),
    ).toEqual(selected.pattern);
    await expect(row(selected.id).locator('.lock-event-demo-pattern')).toHaveCSS(
        'grid-template-columns',
        '6px 6px 6px',
    );
    await demo.locator('.lock-event-demo-copy').click();
    await expect(demo.getByRole('status')).toHaveText('已复制选中的合成样例。');
    const copied = await page.evaluate(() => window.__mtxDemoClipboard);
    expect(copied).toHaveLength(1);
    expect(JSON.parse(copied[0])).toEqual({ synthetic: true, ...selected });
    await expect(demo.getByRole('textbox', { name: '样例复制内容', exact: true })).toHaveCount(0);
    await demo.locator('.lock-event-demo-unlock').click();
    await expect(demo.getByRole('status')).toHaveText('解锁预览：仅展示合成样例，未下发设备指令。');
    await demo.locator('.lock-event-demo-v2').click();
    await expect(demo.getByRole('status')).toHaveText('V2 预览：仅展示合成样例，未下发设备指令。');
    await tab('scenario').click();
    await expect(demo.getByRole('status')).toHaveCount(0);
    expectNoExecution(observation);
    console.log(
        'DEVICE_PANEL_DEMO_LOCK PASS: tabs16/12/1/3; single keyboard selection; exact nine-point fixture; clipboard writeText probe receives synthetic-only JSON; two local preview statuses; POST/WS commands/external=0',
    );
});

test('clipboard permission rejection offers readonly selected synthetic text and recovers without issuing a device request', async ({
    page,
}) => {
    await installClipboardProbe(page, true);
    const observation = observe(page);
    await login(page);
    observation.mutations.length = 0;
    await openDetail(page);
    await openPanel(page, 'password');
    await enableDemo(page, 'password');
    const demo = panel(page, 'password').locator('.lock-event-demo');
    await demo.locator('.lock-event-demo-copy').click();
    await expect(demo.getByRole('status')).toHaveText(
        '自动复制未完成，请复制下方已选中的样例文本。',
    );
    const fallback = demo.getByRole('textbox', { name: '样例复制内容', exact: true });
    await expect(fallback).toBeVisible();
    await expect(fallback).toHaveAttribute('readonly', '');
    await expect(fallback).toBeFocused();
    expect(JSON.parse(await fallback.inputValue())).toEqual({
        synthetic: true,
        ...fixture.lockEvents[0],
        pattern: [],
    });
    expect(
        await fallback.evaluate((element) => [
            element.selectionStart,
            element.selectionEnd,
            element.value.length,
        ]),
    ).toEqual([0, (await fallback.inputValue()).length, (await fallback.inputValue()).length]);
    expect(await page.evaluate(() => window.__mtxDemoClipboard)).toEqual([]);
    await expect(demo.locator('.lock-event-demo-copy')).toBeEnabled();
    await page.evaluate(() => {
        window.__mtxDemoCopyFailure = false;
    });
    await demo.locator('.lock-event-demo-copy').click();
    await expect(demo.getByRole('status')).toHaveText('已复制选中的合成样例。');
    await expect(fallback).toHaveCount(0);
    expect(await page.evaluate(() => window.__mtxDemoClipboard.length)).toBe(1);
    expectNoExecution(observation);
    console.log(
        'DEVICE_PANEL_DEMO_COPY_FAILURE PASS: simulated NotAllowedError; readonly full selected synthetic JSON fallback; retry success; POST/WS commands/external=0',
    );
});

test('template demo opens, skips and resets local fictional applications without offering fixture downloads', async ({
    page,
}) => {
    const observation = observe(page);
    await login(page);
    observation.mutations.length = 0;
    const before = await (await page.request.get('/api/devices/1')).json();
    await openDetail(page);
    await openPanel(page, 'quick');
    await enableDemo(page, 'quick');
    const demo = panel(page, 'quick').locator('.template-demo');
    const app = (id) => demo.locator(`.template-demo-card[data-demo-app="${id}"]`);
    const [first, second] = fixture.applications;
    await expect(app(first.id)).toHaveClass(/is-submitted/);
    await expect(app(first.id).locator('.template-demo-badge')).toHaveText('已提交 (示例)');
    await expect(app(first.id).locator('.template-demo-details')).toBeVisible();
    await expect(app(first.id).locator('.template-demo-fields dd')).toHaveText(
        first.fields.map((field) => field.value),
    );
    await expect(
        app(first.id).getByRole('checkbox', { name: `跳过 ${first.name} 本地示例`, exact: true }),
    ).toBeChecked();
    await expect(app(second.id).locator('.template-demo-badge')).toHaveText('就绪 (示例)');
    await expect(app(second.id).locator('.template-demo-details')).toHaveCount(0);
    const skip = app(second.id).getByRole('checkbox', {
        name: `跳过 ${second.name} 本地示例`,
        exact: true,
    });
    await skip.focus();
    await page.keyboard.press('Space');
    await expect(skip).toBeChecked();
    await expect(demo.getByRole('status')).toHaveText(
        `「${second.name}」已跳过本地示例；未下发设备指令。`,
    );
    const open = app(second.id).getByRole('button', {
        name: `打开 ${second.name} 合成详情`,
        exact: true,
    });
    await open.click();
    await expect(open).toHaveAttribute('aria-expanded', 'true');
    await expect(app(second.id).locator('.template-demo-details')).toBeVisible();
    await expect(app(second.id).locator('.template-demo-package')).toHaveText(second.packageName);
    await expect(app(second.id).locator('.template-demo-fields dd')).toHaveText(
        second.fields.map((field) => field.value),
    );
    await expect(demo.getByRole('status')).toHaveText(
        `已展开「${second.name}」的合成详情；未启动外部应用。`,
    );
    await app(second.id)
        .getByRole('button', { name: `重置 ${second.name} 本地预览`, exact: true })
        .click();
    await expect(skip).not.toBeChecked();
    await expect(open).toHaveAttribute('aria-expanded', 'false');
    await expect(app(second.id).locator('.template-demo-details')).toHaveCount(0);
    await expect(demo.getByRole('status')).toHaveText(`已恢复「${second.name}」的本地示例。`);
    await skip.check();
    await open.click();
    await previewWindow(page, 'quick')
        .getByRole('button', { name: '重置测试数据', exact: true })
        .click();
    await expect(skip).not.toBeChecked();
    await expect(open).toHaveAttribute('aria-expanded', 'false');
    await expect(panel(page, 'quick').locator('.device-demo-feedback')).toHaveText(
        '测试数据已恢复；未执行设备操作。',
    );
    await expect(previewWindow(page, 'quick').locator('.device-demo-count')).toHaveText(
        '已提交 1/2',
    );
    await expect(panel(page, 'quick').locator('.device-demo-feedback')).toHaveAttribute(
        'role',
        'status',
    );
    await expectNoDownload(page, 'quick');
    const after = await (await page.request.get('/api/devices/1')).json();
    expect(after.device).toEqual(before.device);
    expect(after.snapshots).toEqual(before.snapshots);
    expect(after.events).toEqual(before.events);
    expectNoExecution(observation);
    console.log(
        'DEVICE_PANEL_DEMO_TEMPLATE PASS: two fictional dev.mtx.demo apps; first submitted1/2; keyboard skip/open/item reset/header reset local; no fixture download entry/event; device/history/events unchanged; POST/WS commands/external/downloads=0',
    );
});

test('demo state belongs to each window and resets on close, route change and authenticated account session replacement', async ({
    page,
}) => {
    const observation = observe(page);
    await login(page);
    observation.mutations.length = 0;
    await openDetail(page);
    for (const instance of ['password', 'quick']) {
        await openPanel(page, instance);
        await enableDemo(page, instance);
    }
    const appTab = panel(page, 'password').locator('.lock-event-demo-tab[data-category="app"]');
    await appTab.click();
    await expect(panel(page, 'password').locator('.lock-event-demo-record')).toHaveCount(3);
    const second = fixture.applications[1];
    const skip = panel(page, 'quick').getByRole('checkbox', {
        name: `跳过 ${second.name} 本地示例`,
        exact: true,
    });
    await skip.check();
    await demoToggle(page, 'password').click();
    await expectDefault(page, 'password');
    await expect(skip).toBeChecked();
    await enableDemo(page, 'password');
    await expect(
        panel(page, 'password').locator('.lock-event-demo-tab[data-category="all"]'),
    ).toHaveAttribute('aria-pressed', 'true');
    await expect(panel(page, 'password').locator('.lock-event-demo-record')).toHaveCount(16);
    await page.keyboard.press('Escape');
    await expect(panel(page, 'password')).toHaveCount(0);
    await expect(topToggle(page, 'password')).not.toBeChecked();
    await expect(topToggle(page, 'password')).toBeFocused();
    await expect(panel(page, 'quick').locator('.template-demo')).toBeVisible();
    await expect(skip).toBeChecked();
    await openPanel(page, 'password');
    await expectDefault(page, 'password');
    await previewWindow(page, 'quick')
        .getByRole('button', { name: '关闭快捷预览', exact: true })
        .click();
    await expect(panel(page, 'quick')).toHaveCount(0);
    await expect(topToggle(page, 'quick')).toBeFocused();
    await expectDefault(page, 'password');
    await openPanel(page, 'quick');
    await expectDefault(page, 'quick');
    await enableDemo(page, 'quick');
    await expect(skip).not.toBeChecked();
    await enableDemo(page, 'password');
    await skip.focus();
    await expect(skip).toBeFocused();
    await expect(previewWindow(page, 'quick')).toHaveCSS('z-index', '91');
    await expect(previewWindow(page, 'password')).toHaveCSS('z-index', '90');
    await page.keyboard.press('Escape');
    await expect(panel(page, 'quick')).toHaveCount(0);
    await expect(topToggle(page, 'quick')).toBeFocused();
    await expect(panel(page, 'password').locator('.lock-event-demo-record')).toHaveCount(16);
    await expect(demoToggle(page, 'password')).toHaveAttribute('aria-pressed', 'true');
    await openPanel(page, 'quick');
    await expectDefault(page, 'quick');
    await enableDemo(page, 'quick');
    await appTab.focus();
    await expect(appTab).toBeFocused();
    await expect(previewWindow(page, 'password')).toHaveCSS('z-index', '91');
    await expect(previewWindow(page, 'quick')).toHaveCSS('z-index', '90');
    await page.keyboard.press('Escape');
    await expect(panel(page, 'password')).toHaveCount(0);
    await expect(topToggle(page, 'password')).toBeFocused();
    await expect(panel(page, 'quick').locator('.template-demo-card')).toHaveCount(2);
    await expect(demoToggle(page, 'quick')).toHaveAttribute('aria-pressed', 'true');
    await openPanel(page, 'password');
    await expectDefault(page, 'password');
    await enableDemo(page, 'password');
    await openDetail(page, 2);
    await expect(page.locator('.device-preview-panel')).toHaveCount(0);
    for (const instance of ['password', 'quick']) {
        await expect(topToggle(page, instance)).not.toBeChecked();
        await openPanel(page, instance);
        await expectDefault(page, instance);
        await enableDemo(page, instance);
    }
    await page.goto('/settings/account');
    await page.getByRole('button', { name: '退出登录', exact: true }).click();
    await expect(page).toHaveURL('/login');
    await expect(page.locator('.device-preview-panel')).toHaveCount(0);
    await login(page);
    await openDetail(page, 2);
    for (const instance of ['password', 'quick']) {
        await expect(topToggle(page, instance)).not.toBeChecked();
        await openPanel(page, instance);
        await expectDefault(page, instance);
    }
    expect(observation.mutations).toEqual([
        { method: 'POST', path: '/api/auth/logout' },
        { method: 'POST', path: '/api/auth/login' },
    ]);
    expectNoExecution(observation, true);
    console.log(
        'DEVICE_PANEL_DEMO_RESET PASS: independent opt-in/selection; keyboard focus switches active window and Escape closes only focused window in both directions with own opener restored; close/reopen default false; other window local state retained; device route/account logout-login reset; only two explicit auth POSTs, device mutations/WS commands/external=0',
    );
});

test('synthetic panels keep 300px desktop geometry in both themes at 1440, 1280 and narrow horizontal-scroll widths', async ({
    page,
}) => {
    const observation = observe(page);
    await login(page);
    observation.mutations.length = 0;
    for (const theme of ['light', 'dark']) {
        await page.goto('/');
        if (theme === 'dark')
            await page.getByRole('button', { name: '切换明暗主题', exact: true }).click();
        await expect(page.locator('html')).toHaveAttribute('data-bs-theme', theme);
        for (const width of [1440, 1280, 800]) {
            await page.setViewportSize({ width, height: 900 });
            await openDetail(page);
            for (const instance of ['password', 'quick']) {
                await openPanel(page, instance);
                await enableDemo(page, instance);
                await expect(previewWindow(page, instance)).toHaveCSS('width', '300px');
                await expect(previewWindow(page, instance)).toHaveCSS('border-radius', '14px');
                await expect(previewWindow(page, instance)).toHaveCSS('top', '360px');
                await expect(previewWindow(page, instance).locator('.viewer-width')).toHaveCount(0);
            }
            await expect(previewWindow(page, 'password')).toHaveCSS('left', '126px');
            await expect(previewWindow(page, 'quick')).toHaveCSS(
                'left',
                `${Math.max(1280, width) - 492}px`,
            );
            await expect(page.locator('.device-topbar')).toHaveCSS('height', '44px');
            await expect(page.locator('.device-nav')).toHaveCSS('width', '110px');
            await expect(page.locator('.device-tools')).toHaveCSS('width', '176px');
            const boxes = await page.locator('.floating-viewer-preview').evaluateAll((windows) =>
                Object.fromEntries(
                    windows.map((window) => {
                        const section = window.querySelector('.device-preview-panel');
                        const { x, y, width, height } = window.getBoundingClientRect();
                        return [
                            section.dataset.instance,
                            { x, y, width, height, right: x + width, bottom: y + height },
                        ];
                    }),
                ),
            );
            expect(boxes.password.width).toBe(300);
            expect(boxes.quick.width).toBe(300);
            expect(boxes.password.y).toBe(boxes.quick.y);
            expect(boxes.password.right).toBeLessThanOrEqual(boxes.quick.x);
            for (const instance of ['password', 'quick']) {
                expect(
                    await panel(page, instance).evaluate(
                        (element) => element.scrollWidth <= element.clientWidth + 1,
                    ),
                ).toBe(true);
                const heading = previewWindow(page, instance).locator('.floating-heading');
                expect(
                    await heading.evaluate(
                        (element) => element.scrollWidth <= element.clientWidth + 1,
                    ),
                ).toBe(true);
                const headerBounds = await previewWindow(page, instance).evaluate((window) => {
                    const box = (element) => {
                        const { x, y, width, height } = element.getBoundingClientRect();
                        return { x, y, width, height, right: x + width, bottom: y + height };
                    };
                    return {
                        window: box(window),
                        heading: box(window.querySelector('.floating-heading')),
                        controls: Array.from(
                            window.querySelectorAll(
                                '.floating-heading button, .floating-heading .device-demo-count',
                            ),
                            (element) => ({ label: element.textContent.trim(), ...box(element) }),
                        ),
                    };
                });
                expect(headerBounds.controls).toHaveLength(instance === 'quick' ? 4 : 3);
                for (const control of headerBounds.controls) {
                    expect(control.width, `${instance} header ${control.label}`).toBeGreaterThan(0);
                    expect(
                        control.x,
                        `${instance} header ${control.label} left`,
                    ).toBeGreaterThanOrEqual(headerBounds.window.x - 1);
                    expect(
                        control.right,
                        `${instance} header ${control.label} right`,
                    ).toBeLessThanOrEqual(headerBounds.window.right + 1);
                    expect(
                        control.y,
                        `${instance} header ${control.label} top`,
                    ).toBeGreaterThanOrEqual(headerBounds.heading.y - 1);
                    expect(
                        control.bottom,
                        `${instance} header ${control.label} bottom`,
                    ).toBeLessThanOrEqual(headerBounds.heading.bottom + 1);
                }
                await expect(demoToggle(page, instance)).toHaveCSS('font-size', '9px');
                if (instance === 'quick') {
                    const reset = previewWindow(page, instance).getByRole('button', {
                        name: '重置测试数据',
                        exact: true,
                    });
                    await expect(reset).toHaveCSS('width', '22px');
                    await expect(reset).toHaveCSS('font-size', '13px');
                }
            }
            expect(
                await page.evaluate(() => document.documentElement.scrollWidth),
            ).toBeGreaterThanOrEqual(1280);
            if (theme === 'light' && width === 1440) {
                await page.screenshot({
                    path: 'test-results/device-panel-demo.png',
                    fullPage: true,
                    animations: 'disabled',
                });
                if (process.env.DEVICE_PREVIEW_ARTIFACT_DIR) {
                    await mkdir(process.env.DEVICE_PREVIEW_ARTIFACT_DIR, { recursive: true });
                    await page.screenshot({
                        path: path.join(
                            process.env.DEVICE_PREVIEW_ARTIFACT_DIR,
                            'device-panel-demo.png',
                        ),
                        fullPage: true,
                        animations: 'disabled',
                    });
                }
            }
            await page.screenshot({
                path: `test-results/device-panel-demo-${theme}-${width}.png`,
                fullPage: true,
                animations: 'disabled',
            });
            if (width === 800) {
                await page.evaluate(() => window.scrollTo(360, 0));
                await expect.poll(() => page.evaluate(() => window.scrollX)).toBe(360);
                await expect(previewWindow(page, 'password')).toHaveCSS('left', '126px');
                await expect(previewWindow(page, 'quick')).toHaveCSS('left', '788px');
                const anchoredNav = await page.locator('.device-nav').boundingBox();
                expect(anchoredNav.x).toBe(0);
                expect(anchoredNav.y).toBe(44);
                await page.screenshot({
                    path: `test-results/device-panel-demo-scroll-${theme}.png`,
                    animations: 'disabled',
                });
            }
        }
    }
    expectNoExecution(observation);
    console.log(
        'DEVICE_PANEL_DEMO_GEOMETRY PASS: light/dark1440/1280/800; width300/radius14/top360; left126/right192gap; parallel nonoverlapping; all header button/count bounds inside own300px window; togglefont9/reset22pxfont13; no internal horizontal overflow; minimum1280/settled horizontal scroll360/fixedleft110; portable screenshots; POST/WS commands/external=0',
    );
});
