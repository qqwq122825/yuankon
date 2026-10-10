import { test, expect } from '@playwright/test';
import { mkdir, readFile } from 'node:fs/promises';
import path from 'node:path';

const paymentFixture = JSON.parse(
    await readFile(new URL('../src/fixtures/device-payments-demo.json', import.meta.url), 'utf8'),
);
const injectionFixture = JSON.parse(
    await readFile(
        new URL('../src/fixtures/device-injection-records-demo.json', import.meta.url),
        'utf8',
    ),
);
const artifactDir = process.env.DEVICE_PAYMENT_ARTIFACT_DIR || 'test-results';
const headers = { 'X-Boundary-Request': '1' };
const navigation = (page) => page.getByRole('navigation', { name: '设备内导航', exact: true });
const payment = (page) => page.locator('.payment-preview');
const injection = (page) => page.locator('.injection-records-preview');
const modules = [
    {
        label: '支付密码',
        section: 'payments',
        root: payment,
        rows: '.payment-record',
        refresh: '刷新',
    },
    {
        label: '注入记录',
        section: 'templates',
        root: injection,
        rows: '.injection-demo-record',
        refresh: '刷新记录',
    },
];

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

async function choose(page, label) {
    await navigation(page).getByRole('button', { name: label, exact: true }).click();
}

function observe(page) {
    const requests = [];
    const mutations = [];
    const external = [];
    const commands = [];
    const errors = [];
    const downloads = [];
    page.on('request', (request) => {
        const url = new URL(request.url());
        const item = { method: request.method(), path: url.pathname };
        requests.push(item);
        if (['POST', 'PATCH', 'PUT', 'DELETE'].includes(item.method)) mutations.push(item);
        if (['http:', 'https:'].includes(url.protocol) && url.origin !== 'http://127.0.0.1:8081')
            external.push(url.href);
    });
    page.on('websocket', (socket) => {
        socket.on('framesent', ({ payload }) => {
            try {
                const message = JSON.parse(String(payload));
                if (message.type === 'command') commands.push(message);
            } catch {
                // Only structured device-command frames count as execution.
            }
        });
    });
    page.on('pageerror', (error) => errors.push(error.message));
    page.on('download', (download) => downloads.push(download.suggestedFilename()));
    return { requests, mutations, external, commands, errors, downloads };
}

function expectNoExecution(observation, allowAuthentication = false) {
    expect(
        observation.mutations.filter(
            (item) => !(allowAuthentication && item.path.startsWith('/api/auth/')),
        ),
    ).toEqual([]);
    expect(observation.external).toEqual([]);
    expect(observation.commands).toEqual([]);
    expect(observation.errors).toEqual([]);
    expect(observation.downloads).toEqual([]);
}

async function businessState(page) {
    const responses = await Promise.all(
        ['/api/devices/1', '/api/events', '/api/snapshots'].map(async (endpoint) => {
            const response = await page.request.get(endpoint);
            expect(response.status()).toBe(200);
            return response.json();
        }),
    );
    return { detail: responses[0], events: responses[1], snapshots: responses[2] };
}

async function expectReady(page, module, demo = true) {
    await expect(module.root(page)).toHaveAccessibleName(module.label);
    await expect(module.root(page)).toHaveAttribute('aria-busy', 'false');
    await expect(module.root(page)).toHaveAttribute('data-state', 'not_connected');
    await expect(module.root(page)).toHaveAttribute('data-demo', String(demo));
    await expect(
        module.root(page).getByRole('button', { name: '测试数据', exact: true }),
    ).toHaveAttribute('aria-pressed', String(demo));
    if (!demo) await expect(module.root(page).locator(module.rows)).toHaveCount(0);
}

async function expectPaymentRecords(page, app) {
    const expected = paymentFixture.records.filter((item) => item.appId === app.id);
    await expect(payment(page).locator('.payment-app[aria-pressed="true"]')).toHaveAttribute(
        'data-app-id',
        app.id,
    );
    await expect(payment(page).locator('.payment-record')).toHaveCount(expected.length);
    expect(
        await payment(page)
            .locator('.payment-record')
            .evaluateAll((rows) => rows.map((row) => row.dataset.recordId)),
    ).toEqual(expected.map((item) => item.id));
    await expect(payment(page).locator('.payment-value')).toHaveText(
        expected.map((item) => item.value),
    );
    await expect(payment(page).locator('.payment-stat-total')).toHaveText(String(expected.length));
    await expect(payment(page).locator('.payment-stat-success')).toHaveText(
        String(expected.filter((item) => item.success).length),
    );
    await expect(payment(page).locator('.payment-stat-distinct')).toHaveText(
        String(new Set(expected.map((item) => item.value)).size),
    );
}

async function expectInjectionRecords(page, expected = injectionFixture.records) {
    await expect(injection(page).locator('.injection-demo-record')).toHaveCount(expected.length);
    expect(
        await injection(page)
            .locator('.injection-demo-record')
            .evaluateAll((rows) => rows.map((row) => row.dataset.recordId)),
    ).toEqual(expected.map((item) => item.id));
    for (const record of expected) {
        const row = injection(page).locator(`[data-record-id="${record.id}"]`);
        for (const field of record.fields) await expect(row).toContainText(field.value);
    }
}

async function refresh(page, module) {
    const endpoint = `/api/devices/1/ui-preview/${module.section}`;
    const responseEvent = page.waitForResponse(
        (response) =>
            new URL(response.url()).pathname === endpoint && response.request().method() === 'GET',
    );
    await module.root(page).getByRole('button', { name: module.refresh, exact: true }).click();
    const response = await responseEvent;
    expect(response.status()).toBe(200);
    expect(await response.json()).toMatchObject({
        mode: 'preview',
        implemented: false,
        deviceId: 1,
        section: { id: module.section },
        state: 'not_connected',
        items: [],
        total: 0,
    });
    await expect(module.root(page)).toHaveAttribute('aria-busy', 'false');
}

async function screenshot(page, name) {
    await mkdir(artifactDir, { recursive: true });
    await page.screenshot({ path: path.join(artifactDir, name), animations: 'disabled' });
}

test('payment password page replaces the generic preview with app grouping, real derived totals and fixed fictional records', async ({
    page,
}) => {
    const observation = observe(page);
    await login(page);
    observation.mutations.length = 0;
    const before = await businessState(page);
    await openDetail(page);
    await expect(
        navigation(page).getByRole('button', { name: '支付场景', exact: true }),
    ).toHaveCount(0);
    await expect(
        navigation(page).getByRole('button', { name: '模板预览', exact: true }),
    ).toHaveCount(0);
    const responseEvent = page.waitForResponse(
        (response) => new URL(response.url()).pathname === '/api/devices/1/ui-preview/payments',
    );
    await choose(page, '支付密码');
    expect((await responseEvent).status()).toBe(200);
    await expectReady(page, modules[0]);
    await expect(payment(page)).toContainText('合成测试数据');
    await expect(payment(page).locator('.payment-app')).toHaveCount(
        paymentFixture.applications.length,
    );
    await expectPaymentRecords(page, paymentFixture.applications[0]);
    await expect(page.locator('.device-preview-panel[data-instance="general"]')).toHaveCount(0);
    for (const app of paymentFixture.applications) {
        await payment(page).locator(`.payment-app[data-app-id="${app.id}"]`).click();
        await expectPaymentRecords(page, app);
    }
    const search = payment(page).getByRole('searchbox', { name: '支付应用搜索', exact: true });
    const selected = paymentFixture.applications[1];
    await search.fill(selected.packageName);
    await expect(payment(page).locator('.payment-app')).toHaveCount(1);
    await payment(page).locator(`.payment-app[data-app-id="${selected.id}"]`).click();
    await expectPaymentRecords(page, selected);
    await refresh(page, modules[0]);
    await expectReady(page, modules[0]);
    await expect(search).toHaveValue(selected.packageName);
    await expectPaymentRecords(page, selected);
    await search.fill('DEMO-NO-SUCH-APPLICATION');
    await expect(payment(page).locator('.payment-app')).toHaveCount(0);
    await expect(payment(page).locator('.payment-record')).toHaveCount(0);
    await expect(payment(page).locator('.payment-stat-total')).toHaveText('0');
    await search.fill('');
    const count = observation.requests.length;
    await payment(page).getByRole('button', { name: '测试数据', exact: true }).click();
    await expectReady(page, modules[0], false);
    await refresh(page, modules[0]);
    await expectReady(page, modules[0], false);
    await payment(page).getByRole('button', { name: '测试数据', exact: true }).click();
    await expectReady(page, modules[0]);
    await expectPaymentRecords(page, paymentFixture.applications[0]);
    expect(
        observation.requests
            .slice(count)
            .filter((item) => item.path.includes('ui-preview/payments')),
    ).toEqual([{ method: 'GET', path: '/api/devices/1/ui-preview/payments' }]);
    expect(await businessState(page)).toEqual(before);
    expectNoExecution(observation);
    console.log(
        'PAYMENT_DEMO PASS: 4 fictional apps/24 records; app grouping/search and actual total-success-distinct counts; manual demo off survives authenticated empty GET refresh; no mutations/commands/external requests/downloads',
    );
});

test('injection records render fixed fake submissions and local manual/popup dialogs without device operations', async ({
    page,
}) => {
    const observation = observe(page);
    await login(page);
    observation.mutations.length = 0;
    const before = await businessState(page);
    await openDetail(page);
    await choose(page, '注入记录');
    await expectReady(page, modules[1]);
    await expect(injection(page)).toContainText('合成测试数据');
    await expect(injection(page).locator('.injection-tracking-chip')).toHaveCount(
        injectionFixture.applications.length,
    );
    await expectInjectionRecords(page);
    const count = observation.requests.length;
    await injection(page).getByRole('button', { name: '手动注入APP', exact: true }).click();
    const manual = page.getByRole('dialog', { name: '本地手动演示', exact: true });
    await expect(manual).toBeVisible();
    await manual
        .getByRole('combobox', { name: '演示应用', exact: true })
        .selectOption(injectionFixture.applications[1].id);
    await manual.getByRole('button', { name: '展示示例', exact: true }).click();
    await expect(manual).not.toBeVisible();
    await expectInjectionRecords(
        page,
        injectionFixture.records.filter(
            (item) => item.applicationId === injectionFixture.applications[1].id,
        ),
    );
    await injection(page).getByRole('button', { name: '弹窗注入', exact: true }).click();
    const popup = page.getByRole('dialog', { name: '本地弹窗演示', exact: true });
    await expect(popup).toBeVisible();
    await expect(popup).toContainText('9519');
    await popup.getByRole('button', { name: '关闭本地演示', exact: true }).click();
    await expect(popup).not.toBeVisible();
    expect(observation.requests.slice(count)).toEqual([]);
    await refresh(page, modules[1]);
    await expectReady(page, modules[1]);
    await injection(page).getByRole('button', { name: '测试数据', exact: true }).click();
    await expectReady(page, modules[1], false);
    await refresh(page, modules[1]);
    await expectReady(page, modules[1], false);
    await injection(page).getByRole('button', { name: '测试数据', exact: true }).click();
    await expectReady(page, modules[1]);
    await expectInjectionRecords(page);
    expect(await businessState(page)).toEqual(before);
    expectNoExecution(observation);
    console.log(
        'INJECTION_DEMO PASS: 3 fictional app states/6 fixed password+PIN records; manual selection and readonly popup stay local; demo off persists through GET refresh; no mutations/commands/external requests/downloads',
    );
});

test('payment and injection demonstrations remain hidden until authenticated preview reads pass strict identity and empty-response checks', async ({
    page,
}) => {
    const observation = observe(page);
    await login(page);
    observation.mutations.length = 0;
    for (const module of modules) {
        const endpoint = `**/api/devices/1/ui-preview/${module.section}`;
        const empty = await (
            await page.request.get(`/api/devices/1/ui-preview/${module.section}`)
        ).json();
        let release;
        let started = 0;
        const gate = new Promise((resolve) => {
            release = resolve;
        });
        await page.route(
            endpoint,
            async (route) => {
                started++;
                await gate;
                await route
                    .fulfill({ status: 500, json: { error: `DEMO-${module.section}-FAILED` } })
                    .catch(() => {});
            },
            { times: 1 },
        );
        try {
            await openDetail(page);
            await choose(page, module.label);
            await expect.poll(() => started).toBe(1);
            await expect(module.root(page)).toHaveAttribute('aria-busy', 'true');
            await expect(module.root(page)).toHaveAttribute('data-demo', 'false');
            await expect(module.root(page).locator(module.rows)).toHaveCount(0);
            await expect(
                module.root(page).getByRole('button', { name: '测试数据', exact: true }),
            ).toBeDisabled();
            release();
            await expect(module.root(page)).toHaveAttribute('data-state', 'error');
            await expect(module.root(page).getByRole('alert')).toContainText(
                `DEMO-${module.section}-FAILED`,
            );
            await expect(module.root(page).locator(module.rows)).toHaveCount(0);
            await module
                .root(page)
                .getByRole('button', { name: module.refresh, exact: true })
                .click();
            await expectReady(page, module);
            for (const invalid of [
                { ...empty, deviceId: 2 },
                { ...empty, section: { id: 'diagnostic' } },
                { ...empty, implemented: true },
                { ...empty, items: [{ value: 'DEMO-REJECTED-REMOTE-DATA' }], total: 1 },
            ]) {
                await page.route(
                    endpoint,
                    (route) => route.fulfill({ status: 200, json: invalid }),
                    { times: 1 },
                );
                await module
                    .root(page)
                    .getByRole('button', { name: module.refresh, exact: true })
                    .click();
                await expect(module.root(page)).toHaveAttribute('data-state', 'error');
                await expect(module.root(page)).toHaveAttribute('data-demo', 'false');
                await expect(module.root(page).locator(module.rows)).toHaveCount(0);
                await expect(module.root(page)).not.toContainText('DEMO-REJECTED-REMOTE-DATA');
                await module
                    .root(page)
                    .getByRole('button', { name: module.refresh, exact: true })
                    .click();
                await expectReady(page, module);
            }
        } finally {
            release();
            await page.unroute(endpoint);
        }
    }
    const endpoint = '**/api/devices/1/ui-preview/payments';
    await page.route(
        endpoint,
        (route) => route.fulfill({ status: 401, json: { error: 'DEMO-AUTH-EXPIRED' } }),
        { times: 1 },
    );
    await choose(page, '支付密码');
    await expect(page).toHaveURL('/login');
    await expect(payment(page)).toHaveCount(0);
    const logout = await page.evaluate(async (requestHeaders) => {
        const response = await fetch('/api/auth/logout', {
            method: 'POST',
            headers: { ...requestHeaders, 'Content-Type': 'application/json' },
            body: '{}',
            credentials: 'same-origin',
        });
        return { status: response.status, body: await response.json() };
    }, headers);
    expect(logout).toEqual({ status: 200, body: { success: true } });
    await login(page);
    await openDetail(page);
    await choose(page, '支付密码');
    await expectReady(page, modules[0]);
    expectNoExecution(observation, true);
    console.log(
        'PAYMENT_INJECTION_GATE PASS: pending/500/wrong-device/wrong-section/nonempty/implemented responses hide fixture; strict GET retry restores sample default; 401 removes protected view and fresh auth resets context; only explicit auth POSTs',
    );
});

test('source, device and account replacement recompute demo defaults and discard stale payment and injection responses', async ({
    page,
}) => {
    const observation = observe(page);
    let source = 'api';
    await page.routeWebSocket(
        (url) => url.pathname === '/ws/panel',
        (socket) => {
            const server = socket.connectToServer();
            server.onMessage((raw) => {
                let message;
                try {
                    message = JSON.parse(String(raw));
                } catch {
                    socket.send(raw);
                    return;
                }
                if (
                    [
                        'get_device_state_response',
                        'device_status_update',
                        'device_online',
                        'device_offline',
                    ].includes(message.type) &&
                    message.data?.localId === 1
                )
                    socket.send(JSON.stringify({ ...message, data: { ...message.data, source } }));
                else socket.send(raw);
            });
        },
    );
    await login(page);
    observation.mutations.length = 0;
    const original = await (await page.request.get('/api/devices/1')).json();
    await page.route('**/api/devices/1', (route) =>
        route.fulfill({
            status: 200,
            json: { ...original, device: { ...original.device, source } },
        }),
    );
    for (const module of modules) {
        for (const notSample of ['api', 'import', 'unknown', '']) {
            source = notSample;
            await openDetail(page);
            await choose(page, module.label);
            await expectReady(page, module, false);
        }
        await module.root(page).getByRole('button', { name: '测试数据', exact: true }).click();
        await expectReady(page, module);
        await refresh(page, module);
        await expectReady(page, module);
        source = 'sample';
        await openDetail(page);
        await choose(page, module.label);
        await expectReady(page, module);
        await module.root(page).getByRole('button', { name: '测试数据', exact: true }).click();
        await expectReady(page, module, false);
        await refresh(page, module);
        await expectReady(page, module, false);
        const endpoint = `**/api/devices/1/ui-preview/${module.section}`;
        let release;
        let started = 0;
        const gate = new Promise((resolve) => {
            release = resolve;
        });
        await page.route(endpoint, async (route) => {
            started++;
            await gate;
            await route
                .fulfill({ status: 500, json: { error: 'DEMO-LATE-PRIOR-DEVICE' } })
                .catch(() => {});
        });
        try {
            await module
                .root(page)
                .getByRole('button', { name: module.refresh, exact: true })
                .click();
            await expect.poll(() => started).toBe(1);
            await expect(module.root(page).locator(module.rows)).toHaveCount(0);
            await page.locator('.device-back').click();
            await expect(page).toHaveURL('/');
            await openDetail(page, 2);
            await choose(page, module.label);
            await expectReady(page, module);
            release();
            await expect(module.root(page)).not.toContainText('DEMO-LATE-PRIOR-DEVICE');
            await expect(page.locator('.device-topbar h1')).toContainText('测试设备 2');
        } finally {
            release();
            await page.unroute(endpoint);
        }
        await module.root(page).getByRole('button', { name: '测试数据', exact: true }).click();
        await expectReady(page, module, false);
    }
    await page.goto('/settings/account');
    await page.getByRole('button', { name: '退出登录', exact: true }).click();
    await expect(page).toHaveURL('/login');
    await login(page);
    await openDetail(page, 2);
    for (const module of modules) {
        await choose(page, module.label);
        await expectReady(page, module);
    }
    expectNoExecution(observation, true);
    console.log(
        'PAYMENT_INJECTION_CONTEXT PASS: sample-only defaults; api/import/unknown/empty source stays empty with HTTP+WS agreement; manual choice survives refresh; pending prior-device response aborted; logout/relogin clears old off choices; no device mutations',
    );
});

test('payment and injection pages retain compact desktop geometry, keyboard actions, horizontal scrolling and dark-theme presentation', async ({
    page,
}) => {
    const observation = observe(page);
    await login(page);
    observation.mutations.length = 0;
    await openDetail(page);
    const paymentEntry = navigation(page).getByRole('button', { name: '支付密码', exact: true });
    await paymentEntry.focus();
    await page.keyboard.press('Enter');
    await expectReady(page, modules[0]);
    const app = payment(page).locator(
        `.payment-app[data-app-id="${paymentFixture.applications[1].id}"]`,
    );
    await app.focus();
    await page.keyboard.press('Space');
    await expectPaymentRecords(page, paymentFixture.applications[1]);
    const lightPaymentBackground = await payment(page)
        .locator('.payment-record')
        .first()
        .evaluate((element) => getComputedStyle(element).backgroundColor);
    for (const theme of ['light', 'dark']) {
        if (theme === 'dark') {
            await page.goto('/');
            await page.getByRole('button', { name: '切换明暗主题', exact: true }).click();
            await openDetail(page);
        }
        await expect(page.locator('html')).toHaveAttribute('data-bs-theme', theme);
        for (const width of [1440, 900]) {
            await page.setViewportSize({ width, height: 900 });
            await choose(page, '支付密码');
            await expectReady(page, modules[0]);
            const paymentBackground = await payment(page)
                .locator('.payment-record')
                .first()
                .evaluate((element) => getComputedStyle(element).backgroundColor);
            if (theme === 'dark') expect(paymentBackground).not.toBe(lightPaymentBackground);
            else expect(paymentBackground).toBe(lightPaymentBackground);
            const rowBoxes = await payment(page)
                .locator('.payment-record')
                .evaluateAll((rows) =>
                    rows.map((row) => ({
                        width: row.getBoundingClientRect().width,
                        height: row.getBoundingClientRect().height,
                    })),
                );
            expect(rowBoxes.length).toBeGreaterThan(0);
            expect(
                rowBoxes.every((box) => box.width > 300 && box.height >= 90 && box.height <= 220),
            ).toBe(true);
            const stats = await payment(page)
                .locator('.payment-stat-total, .payment-stat-success, .payment-stat-distinct')
                .evaluateAll((items) => items.map((item) => item.getBoundingClientRect().top));
            expect(Math.max(...stats) - Math.min(...stats)).toBeLessThan(2);
            const canvas = await page.evaluate(() => ({
                viewport: innerWidth,
                width: document.documentElement.scrollWidth,
            }));
            if (width < 1280) expect(canvas.width).toBeGreaterThan(canvas.viewport);
            await screenshot(page, `device-payments-${theme}-${width}.png`);
            await choose(page, '注入记录');
            await expectReady(page, modules[1]);
            const manualButton = injection(page).getByRole('button', {
                name: '手动注入APP',
                exact: true,
            });
            await manualButton.focus();
            await page.keyboard.press('Enter');
            const dialog = page.getByRole('dialog', { name: '本地手动演示', exact: true });
            await expect(dialog).toBeVisible();
            await dialog.getByRole('button', { name: '关闭本地演示', exact: true }).focus();
            await page.keyboard.press('Space');
            await expect(dialog).not.toBeVisible();
            await screenshot(page, `device-injection-${theme}-${width}.png`);
        }
    }
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.getByRole('checkbox', { name: '快捷预览', exact: true }).check();
    await expect(page.locator('.device-preview-panel[data-instance="quick"]')).toBeVisible();
    await expect(page.locator('.device-preview-panel[data-instance="quick"]')).toHaveAttribute(
        'data-section',
        'templates',
    );
    expectNoExecution(observation);
    console.log(
        'PAYMENT_INJECTION_LAYOUT PASS: light/dark 1440/900 desktop layouts; derived-stat cards remain one row, record heights compact, narrow viewport horizontally scrolls; Enter/Space navigation/app/dialog controls; existing quick templates floating panel remains',
    );
});
