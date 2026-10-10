import { test, expect } from '@playwright/test';
import { mkdir, readFile } from 'node:fs/promises';
import path from 'node:path';

const fixture = JSON.parse(
    await readFile(new URL('../src/fixtures/device-sms-demo.json', import.meta.url), 'utf8'),
);
const artifactDir = process.env.DEVICE_SMS_ARTIFACT_DIR || 'test-results';
const sms = (page) => page.locator('.sms-preview');
const navigation = (page) => page.getByRole('navigation', { name: '设备内导航', exact: true });
const demoToggle = (page) => sms(page).getByRole('button', { name: '测试数据', exact: true });
const search = (page) =>
    sms(page).getByRole('searchbox', { name: '搜索短信内容或号码', exact: true });

async function login(page) {
    await page.goto('/login');
    await page.getByLabel('账号', { exact: true }).fill('mtx');
    await page.getByLabel('密码', { exact: true }).fill('mtx123');
    await page.getByRole('button', { name: '登录', exact: true }).click();
    await expect(page).toHaveURL('/');
    await expect(page.locator('.console-help')).toHaveAccessibleName('WS · 已连接');
}

async function openSms(page, id = 1) {
    await page.goto(`/devices/${id}`);
    await expect(page.locator('.device-workbench')).toBeVisible();
    await navigation(page).getByRole('button', { name: '短信记录', exact: true }).click();
    await expect(sms(page)).toBeVisible();
}

async function expectDefault(page) {
    await expect(sms(page)).toHaveAccessibleName('短信记录');
    await expect(sms(page)).toHaveAttribute('aria-busy', 'false');
    await expect(sms(page)).toHaveAttribute('data-demo', 'false');
    await expect(sms(page)).toHaveAttribute('data-state', 'not_connected');
    await expect(demoToggle(page)).toHaveAttribute('aria-pressed', 'false');
    await expect(search(page)).toHaveValue('');
    await expect(sms(page).locator('.sms-count')).toHaveText('共 0 条短信');
    await expect(sms(page).locator('.sms-message')).toHaveCount(0);
    await expect(sms(page).locator('.sms-empty')).toHaveText('暂无短信记录');
    await expect(sms(page)).toContainText('未接入');
}

async function expectMessages(page, messages) {
    await expect(sms(page).locator('.sms-count')).toHaveText(`共 ${messages.length} 条短信`);
    await expect(sms(page).locator('.sms-message')).toHaveCount(messages.length);
    await expect(sms(page).locator('.sms-demo-notice')).toContainText(
        `匹配 ${messages.length} / 共 8 条合成样例`,
    );
    expect(
        await sms(page)
            .locator('.sms-message')
            .evaluateAll((elements) =>
                elements.map((element) => ({
                    id: element.dataset.messageId,
                    synthetic: element.dataset.synthetic,
                })),
            ),
    ).toEqual(messages.map((message) => ({ id: message.id, synthetic: 'true' })));
    await expect(sms(page).locator('.sms-message-body')).toHaveText(
        messages.map((message) => message.body),
    );
}

async function businessState(page) {
    const results = await Promise.all(
        ['/api/devices/1', '/api/events', '/api/snapshots'].map(async (endpoint) => {
            const response = await page.request.get(endpoint);
            expect(response.status()).toBe(200);
            return response.json();
        }),
    );
    return { detail: results[0], events: results[1], snapshots: results[2] };
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
        requests.push({ method: request.method(), path: url.pathname });
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
                // Subscription and heartbeat frames are not device commands.
            }
        });
    });
    page.on('pageerror', (error) => errors.push(error.message));
    page.on('download', (download) => downloads.push(download.suggestedFilename()));
    return { requests, mutations, external, commands, errors, downloads };
}

function expectNoExecution(observation) {
    expect(observation.mutations).toEqual([]);
    expect(observation.external).toEqual([]);
    expect(observation.commands).toEqual([]);
    expect(observation.errors).toEqual([]);
    expect(observation.downloads).toEqual([]);
}

async function retryGet(page, buttonName = '获取短信', id = 1) {
    const returned = page.waitForResponse(
        (response) =>
            new URL(response.url()).pathname === `/api/devices/${id}/ui-preview/sms` &&
            response.request().method() === 'GET',
    );
    await sms(page).getByRole('button', { name: buttonName, exact: true }).click();
    return returned;
}

async function screenshot(page, filename) {
    await mkdir(artifactDir, { recursive: true });
    await page.screenshot({ path: path.join(artifactDir, filename), animations: 'disabled' });
}

test('SMS defaults to strict empty GET data, authorization stays local and existing five-field scenario metadata is preserved', async ({
    page,
}) => {
    const observation = observe(page);
    await login(page);
    observation.mutations.length = 0;
    const before = await businessState(page);
    const expectedObservations = before.detail.snapshot.payload.observations.filter((item) =>
        item.scenario.startsWith('sms'),
    );
    expect(expectedObservations).toHaveLength(1);
    const returned = page.waitForResponse(
        (response) =>
            new URL(response.url()).pathname === '/api/devices/1/ui-preview/sms' &&
            response.request().method() === 'GET',
    );
    await openSms(page);
    const response = await returned;
    expect(response.status()).toBe(200);
    expect(await response.json()).toMatchObject({
        mode: 'preview',
        implemented: false,
        deviceId: 1,
        state: 'not_connected',
        section: { id: 'sms' },
        items: [],
        total: 0,
    });
    await expectDefault(page);
    const metadata = sms(page).locator('details.sms-metadata');
    await expect(metadata).not.toHaveAttribute('open');
    await expect(metadata.locator('table')).not.toBeVisible();
    await metadata.locator(':scope > summary').focus();
    await page.keyboard.press('Enter');
    await expect(metadata).toHaveAttribute('open');
    await expect(metadata.locator('thead th')).toHaveCount(5);
    await expect(metadata.locator('tbody tr')).toHaveCount(expectedObservations.length);
    for (const [index, item] of expectedObservations.entries()) {
        await expect(metadata.locator('tbody tr').nth(index).locator('td')).toHaveText([
            item.scenario,
            item.channel,
            item.case_id,
            String(item.text_returned ?? '—'),
            item.synthetic_match,
        ]);
    }
    await metadata.locator(':scope > summary').focus();
    await page.keyboard.press('Space');
    await expect(metadata).not.toHaveAttribute('open');
    const beforeLocalAction = observation.requests.length;
    await sms(page).getByRole('button', { name: '自动授权', exact: true }).click();
    await expect(sms(page).locator('.sms-preview-feedback')).toHaveText(
        '自动授权尚未接入；未改变设备权限。',
    );
    expect(observation.requests).toHaveLength(beforeLocalAction);
    const refreshed = await retryGet(page);
    expect(refreshed.status()).toBe(200);
    await expectDefault(page);
    await expect(sms(page).locator('.sms-preview-feedback')).toHaveText(
        '已读取预览状态；设备短信功能尚未接入。',
    );
    await navigation(page).getByRole('button', { name: '密码记录', exact: true }).click();
    await expect(sms(page)).toHaveCount(0);
    const passwordCases = before.detail.snapshot.payload.observations.filter(
        (item) => item.scenario === 'password_field',
    );
    await expect(page.locator('.record-metadata tbody tr')).toHaveCount(passwordCases.length);
    for (const [index, item] of passwordCases.entries())
        await expect(page.locator('.record-metadata tbody tr').nth(index).locator('td')).toHaveText(
            [
                item.scenario,
                item.channel,
                item.case_id,
                String(item.text_returned ?? '—'),
                item.synthetic_match,
            ],
        );
    expect(await businessState(page)).toEqual(before);
    expectNoExecution(observation);
    console.log(
        'DEVICE_SMS_EMPTY PASS: strict GET200 preview/not_connected/items[]/total0; opt-in false/count0; metadata5 native Enter/Space fold; authorization local/no permission mutation; fetch button only GET retry; password table preserved; devices/events/snapshots unchanged; POST/external/WS commands/downloads=0',
    );
});

test('eight explicit synthetic SMS messages search locally across sender, address and text, escape markup and reset when disabled', async ({
    page,
}) => {
    const observation = observe(page);
    await login(page);
    observation.mutations.length = 0;
    const before = await businessState(page);
    await openSms(page);
    await expectDefault(page);
    const requestsBeforeDemo = observation.requests.length;
    await demoToggle(page).click();
    await expect(demoToggle(page)).toHaveAttribute('aria-pressed', 'true');
    await expect(sms(page)).toHaveAttribute('data-demo', 'true');
    await expect(sms(page)).toContainText('合成测试数据 · 非设备短信');
    expect(fixture.fixtureOnly).toBe(true);
    expect(fixture.messages).toHaveLength(8);
    await expectMessages(page, fixture.messages);
    await expect(sms(page).getByRole('button', { name: /下载|导出/ })).toHaveCount(0);
    await expect(sms(page).locator('a[download]')).toHaveCount(0);
    await screenshot(page, 'device-sms-records.png');
    const normalize = (value) => String(value).normalize('NFKC').toLowerCase();
    for (const query of [
        '示例通信',
        'ｄｅｍｏ－１０００２',
        'demo mobile',
        'DEMO-PACKAGE-08',
        '<b>示例</b>',
    ]) {
        await search(page).fill(query);
        const expected = fixture.messages.filter((message) =>
            [message.sender, message.address, message.body].some((value) =>
                normalize(value).includes(normalize(query.trim())),
            ),
        );
        expect(expected.length).toBeGreaterThan(0);
        await expectMessages(page, expected);
        expect(observation.requests).toHaveLength(requestsBeforeDemo);
    }
    const escaped = sms(page).locator('.sms-message[data-message-id="DEMO-SMS-08"]');
    await expect(escaped.locator('.sms-message-body')).toHaveText(fixture.messages[7].body);
    await expect(escaped.locator('b')).toHaveCount(0);
    await expect(escaped.locator('script, iframe')).toHaveCount(0);
    await search(page).fill('DEMO-NO-MATCH-999');
    await expectMessages(page, []);
    await expect(sms(page).locator('.sms-empty')).toHaveText('没有匹配的合成短信');
    await search(page).fill('');
    await expectMessages(page, fixture.messages);
    await search(page).fill('演示账单');
    await expectMessages(page, [fixture.messages[1]]);
    await demoToggle(page).click();
    await expectDefault(page);
    await expect(sms(page).locator('.sms-demo-notice')).toHaveCount(0);
    await demoToggle(page).click();
    await expect(search(page)).toHaveValue('');
    await expectMessages(page, fixture.messages);
    expect(observation.requests).toHaveLength(requestsBeforeDemo);
    expect(await businessState(page)).toEqual(before);
    expectNoExecution(observation);
    console.log(
        'DEVICE_SMS_DEMO PASS: opt-in8 fixed synthetic messages; sender/address/body search with NFKC/case fold and exact counts; no-result0; HTML-like fixture rendered as text/no b/script; disable clears search and records/re-enable8; no download; search/demo issue no requests; devices/events/snapshots unchanged; POST/external/WS commands=0',
    );
});

test('SMS GET failures and malformed states retry without fabricated records, and route changes cancel late device responses', async ({
    page,
}) => {
    const observation = observe(page);
    await login(page);
    observation.mutations.length = 0;
    const before = await businessState(page);
    const emptyState = await (await page.request.get('/api/devices/1/ui-preview/sms')).json();
    await page.route(
        '**/api/devices/1/ui-preview/sms',
        (route) => route.fulfill({ status: 500, json: { error: '合成短信预览读取失败' } }),
        { times: 1 },
    );
    await openSms(page);
    await expect(sms(page)).toHaveAttribute('data-state', 'error');
    await expect(sms(page).getByRole('alert')).toContainText('合成短信预览读取失败');
    expect((await retryGet(page, '重试预览')).status()).toBe(200);
    await expectDefault(page);
    for (const malformed of [
        { ...emptyState, deviceId: 2, section: { id: 'analysis' } },
        { ...emptyState, items: [{ body: 'DEMO-SHOULD-NOT-RENDER' }], total: 1 },
        { ...emptyState, implemented: true, state: 'connected' },
    ]) {
        await page.route(
            '**/api/devices/1/ui-preview/sms',
            (route) => route.fulfill({ status: 200, json: malformed }),
            { times: 1 },
        );
        expect((await retryGet(page)).status()).toBe(200);
        await expect(sms(page)).toHaveAttribute('data-state', 'error');
        await expect(sms(page).getByRole('alert')).toContainText(
            '短信预览状态不符合当前约定，请重试。',
        );
        await expect(sms(page).locator('.sms-message')).toHaveCount(0);
        await expect(sms(page)).not.toContainText('DEMO-SHOULD-NOT-RENDER');
        expect((await retryGet(page, '重试预览')).status()).toBe(200);
        await expectDefault(page);
    }
    let completeFeedback;
    const feedbackGate = new Promise((resolve) => (completeFeedback = resolve));
    await page.route(
        '**/api/devices/1/ui-preview/sms',
        async (route) => {
            await feedbackGate;
            await route.fulfill({ status: 200, json: emptyState });
        },
        { times: 1 },
    );
    const feedbackResponse = page.waitForResponse(
        (response) => new URL(response.url()).pathname === '/api/devices/1/ui-preview/sms',
    );
    try {
        await sms(page).getByRole('button', { name: '获取短信', exact: true }).click();
        await expect(sms(page)).toHaveAttribute('aria-busy', 'true');
        await sms(page).getByRole('button', { name: '自动授权', exact: true }).click();
        completeFeedback();
        expect((await feedbackResponse).status()).toBe(200);
        await expectDefault(page);
        await expect(sms(page).locator('.sms-preview-feedback')).toHaveText(
            '自动授权尚未接入；未改变设备权限。',
        );
    } finally {
        completeFeedback();
    }
    let release;
    let started = 0;
    const gate = new Promise((resolve) => (release = resolve));
    await page.route('**/api/devices/1/ui-preview/sms', async (route) => {
        started++;
        await gate;
        await route
            .fulfill({ status: 500, json: { error: '迟到的设备一短信响应' } })
            .catch(() => {});
    });
    try {
        await sms(page).getByRole('button', { name: '获取短信', exact: true }).click();
        await expect.poll(() => started).toBe(1);
        await expect(sms(page)).toHaveAttribute('aria-busy', 'true');
        await expect(
            sms(page).getByRole('button', { name: '获取短信', exact: true }),
        ).toBeDisabled();
        await page.locator('.device-back').click();
        await expect(page).toHaveURL('/');
        await expect(sms(page)).toHaveCount(0);
        await openSms(page, 2);
        await expectDefault(page);
        release();
        await page.waitForTimeout(100);
        await expect(page.locator('.device-topbar h1')).toContainText('测试设备 2');
        await expect(sms(page)).not.toContainText('迟到的设备一短信响应');
        await expectDefault(page);
        await expect(sms(page).locator('.sms-metadata')).toContainText('暂无短信场景元数据');
    } finally {
        release();
        await page.unroute('**/api/devices/1/ui-preview/sms');
    }
    expect(await businessState(page)).toEqual(before);
    expectNoExecution(observation);
    console.log(
        'DEVICE_SMS_RETRY PASS: GET500 alert/real retry200; malformed device-section/nonempty-items/implemented states rejected to zero records; earlier GET does not overwrite newer authorization feedback; late pending device1 GET aborted on route change and absent on device2; devices/events/snapshots unchanged; POST/external/WS commands/downloads=0',
    );
});

test('SMS records preserve desktop geometry and keyboard actions in both themes at 1440, 1280 and narrow 800px widths', async ({
    page,
}) => {
    const observation = observe(page);
    await login(page);
    observation.mutations.length = 0;
    const before = await businessState(page);
    for (const theme of ['light', 'dark']) {
        await page.goto('/');
        if (theme === 'dark')
            await page.getByRole('button', { name: '切换明暗主题', exact: true }).click();
        await expect(page.locator('html')).toHaveAttribute('data-bs-theme', theme);
        for (const width of [1440, 1280, 800]) {
            await page.setViewportSize({ width, height: 900 });
            await page.goto('/devices/1');
            await expect(page.locator('.device-workbench')).toBeVisible();
            const entry = navigation(page).getByRole('button', { name: '短信记录', exact: true });
            await entry.focus();
            await page.keyboard.press('Enter');
            await expectDefault(page);
            await demoToggle(page).focus();
            await page.keyboard.press('Space');
            await expectMessages(page, fixture.messages);
            await search(page).focus();
            await page.keyboard.type('DEMO-10003');
            await expectMessages(page, [fixture.messages[2]]);
            await search(page).fill('');
            await expectMessages(page, fixture.messages);
            await sms(page).getByRole('button', { name: '自动授权', exact: true }).focus();
            await page.keyboard.press('Enter');
            await expect(sms(page).locator('.sms-preview-feedback')).toHaveText(
                '自动授权尚未接入；未改变设备权限。',
            );
            await expect(page.locator('.device-topbar')).toHaveCSS('height', '44px');
            await expect(page.locator('.device-nav')).toHaveCSS('width', '110px');
            await expect(page.locator('.device-tools')).toHaveCSS('width', '176px');
            await expect(sms(page).locator('.sms-message').first()).toHaveCSS(
                'background-color',
                theme === 'dark' ? 'rgb(31, 41, 56)' : 'rgb(255, 255, 255)',
            );
            await expect(search(page)).toHaveCSS(
                'background-color',
                theme === 'dark' ? 'rgb(31, 41, 56)' : 'rgb(255, 255, 255)',
            );
            expect(
                await page.evaluate(() => document.documentElement.scrollWidth),
            ).toBeGreaterThanOrEqual(1280);
            expect(
                await sms(page).evaluate(
                    (element) => element.scrollWidth <= element.clientWidth + 1,
                ),
            ).toBe(true);
            const controls = await sms(page)
                .locator('.sms-preview-actions button')
                .evaluateAll((buttons) =>
                    buttons.map((button) => {
                        const { y, width, height } = button.getBoundingClientRect();
                        return { y, width, height };
                    }),
                );
            expect(controls).toHaveLength(3);
            expect(
                Math.max(...controls.map((button) => button.y)) -
                    Math.min(...controls.map((button) => button.y)),
            ).toBeLessThanOrEqual(1);
            expect(controls.every((button) => button.width > 0 && button.height > 0)).toBe(true);
            await screenshot(page, `device-sms-${theme}-${width}.png`);
            if (width === 800) {
                await page.evaluate(() => window.scrollTo(360, 0));
                await expect.poll(() => page.evaluate(() => window.scrollX)).toBe(360);
                const nav = await page.locator('.device-nav').boundingBox();
                expect(nav.x).toBe(0);
                expect(nav.y).toBe(44);
                await screenshot(page, `device-sms-scroll-${theme}-800.png`);
            }
        }
    }
    expect(await businessState(page)).toEqual(before);
    expectNoExecution(observation);
    console.log(
        'DEVICE_SMS_GEOMETRY PASS: light/dark1440/1280/800; 44header/110fixedrail/176tools/min1280 desktop; horizontal scroll360/fixednav; three toolbar controls retain one row; no internal horizontal overflow; Enter/Space/search keyboard; portable screenshots; devices/events/snapshots unchanged; POST/external/WS commands/downloads=0',
    );
});
