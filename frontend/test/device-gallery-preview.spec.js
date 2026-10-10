import { test, expect } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';

const artifactDir = process.env.DEVICE_GALLERY_ARTIFACT_DIR || 'test-results';
const endpoint = (id = 1) => `/api/devices/${id}/ui-preview/gallery`;
const gallery = (page) => page.locator('.gallery-preview');
const navigation = (page) => page.getByRole('navigation', { name: '设备内导航', exact: true });
const fetchButton = (page) => gallery(page).getByRole('button', { name: '获取相册', exact: true });
const emptyText = '暂无相册数据，点击「获取相册」加载';
const refreshedText = '相册功能尚未接入，当前仅刷新预览状态。';

async function login(page) {
    await page.goto('/login');
    await page.getByLabel('账号', { exact: true }).fill('mtx');
    await page.getByLabel('密码', { exact: true }).fill('mtx123');
    await page.getByRole('button', { name: '登录', exact: true }).click();
    await expect(page).toHaveURL('/');
    await expect(page.locator('.console-help')).toHaveAccessibleName('WS · 已连接');
}

async function choose(page, label) {
    await navigation(page).getByRole('button', { name: label, exact: true }).click();
}

async function openGallery(page, id = 1) {
    await page.goto(`/devices/${id}`);
    await expect(page.locator('.device-workbench')).toBeVisible();
    await choose(page, '相册图片');
    await expect(gallery(page)).toBeVisible();
}

async function expectEmpty(page) {
    await expect(gallery(page)).toHaveAccessibleName('相册图片');
    await expect(gallery(page)).toHaveAttribute('aria-busy', 'false');
    await expect(gallery(page)).toHaveAttribute('data-state', 'not_connected');
    await expect(gallery(page).locator('.gallery-toolbar button')).toHaveCount(2);
    await expect(gallery(page).getByRole('button')).toHaveCount(2);
    await expect(
        gallery(page).getByRole('button', { name: '测试数据', exact: true }),
    ).toHaveAttribute('aria-pressed', 'false');
    await expect(fetchButton(page)).toBeEnabled();
    await expect(gallery(page).locator('.gallery-empty')).toHaveText(emptyText);
    await expect(gallery(page).locator('img, video, canvas, .card, h2')).toHaveCount(0);
    await expect(gallery(page).locator('a[download]')).toHaveCount(0);
    await expect(page.locator('.inspection-orbit, .detail-analysis-card')).toHaveCount(0);
    await expect(page.locator('.device-preview-panel[data-instance="general"]')).toHaveCount(0);
    await expect(page.locator('.floating-viewer')).toHaveCount(0);
    await expect(
        navigation(page).getByRole('button', { name: '相册图片', exact: true }),
    ).toHaveAttribute('aria-pressed', 'true');
}

async function businessState(page) {
    const values = await Promise.all(
        ['/api/devices/1', '/api/events', '/api/snapshots'].map(async (url) => {
            const response = await page.request.get(url);
            expect(response.status()).toBe(200);
            return response.json();
        }),
    );
    return { detail: values[0], events: values[1], snapshots: values[2] };
}

function observe(page) {
    const requests = [];
    const mutations = [];
    const external = [];
    const commands = [];
    const errors = [];
    const downloads = [];
    const aborted = [];
    page.on('request', (request) => {
        const url = new URL(request.url());
        const item = { method: request.method(), path: url.pathname };
        requests.push(item);
        if (['POST', 'PATCH', 'PUT', 'DELETE'].includes(request.method())) mutations.push(item);
        if (['http:', 'https:'].includes(url.protocol) && url.origin !== 'http://127.0.0.1:8081')
            external.push(url.href);
    });
    page.on('requestfailed', (request) => {
        if (
            new URL(request.url()).pathname.endsWith('/ui-preview/gallery') &&
            /ERR_ABORTED|cancel/i.test(request.failure()?.errorText || '')
        )
            aborted.push(new URL(request.url()).pathname);
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
    return { requests, mutations, external, commands, errors, downloads, aborted };
}

function expectNoExecution(observation) {
    expect(observation.mutations).toEqual([]);
    expect(observation.external).toEqual([]);
    expect(observation.commands).toEqual([]);
    expect(observation.errors).toEqual([]);
    expect(observation.downloads).toEqual([]);
}

async function refresh(page, id = 1, key) {
    const returned = page.waitForResponse(
        (response) =>
            new URL(response.url()).pathname === endpoint(id) &&
            response.request().method() === 'GET',
    );
    if (key) {
        await fetchButton(page).focus();
        await page.keyboard.press(key);
    } else await fetchButton(page).click();
    return returned;
}

async function capture(page, filename) {
    await mkdir(artifactDir, { recursive: true });
    await page.screenshot({ path: path.join(artifactDir, filename), animations: 'disabled' });
}

test('gallery keeps its plain empty default with fetch and manual demo controls and real GET refreshes, including Enter and Space', async ({
    page,
}) => {
    const observation = observe(page);
    await login(page);
    observation.mutations.length = 0;
    const before = await businessState(page);
    const returned = page.waitForResponse(
        (response) =>
            new URL(response.url()).pathname === endpoint() &&
            response.request().method() === 'GET',
    );
    await openGallery(page);
    const response = await returned;
    expect(response.status()).toBe(200);
    expect(await response.json()).toMatchObject({
        mode: 'preview',
        implemented: false,
        deviceId: 1,
        state: 'not_connected',
        section: { id: 'gallery' },
        items: [],
        total: 0,
    });
    await expectEmpty(page);
    await expect(gallery(page).locator('.gallery-feedback')).toHaveCount(0);
    await expect(fetchButton(page).locator('[aria-hidden="true"]')).toHaveCount(1);
    await page.waitForLoadState('networkidle');
    observation.requests.length = 0;
    for (const key of ['Enter', 'Space']) {
        expect((await refresh(page, 1, key)).status()).toBe(200);
        await expectEmpty(page);
        await expect(gallery(page).locator('.gallery-feedback')).toHaveText(refreshedText);
        await expect(gallery(page).locator('.gallery-feedback')).toHaveAttribute('role', 'status');
    }
    expect(observation.requests).toEqual([
        { method: 'GET', path: endpoint() },
        { method: 'GET', path: endpoint() },
    ]);
    expect(await businessState(page)).toEqual(before);
    expectNoExecution(observation);
    await capture(page, 'device-gallery-empty.png');
    console.log(
        'DEVICE_GALLERY_EMPTY PASS: real GET200 preview/not_connected/items[]/total0; one fetch button with hidden icon; selected ordinary gallery canvas/no card/heading/orbit/analysis/general popup; Enter/Space each GET only; device/events/snapshots unchanged; writes/external/WS commands/downloads=0',
    );
});

test('gallery rejects HTTP failures, null and malformed preview responses while preserving the same enabled retry button', async ({
    page,
}) => {
    const observation = observe(page);
    await login(page);
    observation.mutations.length = 0;
    const before = await businessState(page);
    const empty = await (await page.request.get(endpoint())).json();
    await page.route(
        `**${endpoint()}`,
        (route) => route.fulfill({ status: 500, json: { error: '合成相册预览读取失败' } }),
        { times: 1 },
    );
    await openGallery(page);
    await expect(gallery(page)).toHaveAttribute('data-state', 'error');
    await expect(gallery(page).getByRole('alert')).toContainText('合成相册预览读取失败');
    await expect(fetchButton(page)).toBeEnabled();
    expect((await refresh(page)).status()).toBe(200);
    await expectEmpty(page);
    for (const malformed of [
        null,
        {},
        { ...empty, mode: 'live' },
        { ...empty, deviceId: 2 },
        { ...empty, deviceId: '1' },
        { ...empty, section: { id: 'sms' } },
        { ...empty, section: null },
        { ...empty, implemented: true },
        { ...empty, implemented: null },
        { ...empty, state: 'connected' },
        { ...empty, items: [{ title: 'DEMO-GALLERY-MUST-NOT-RENDER' }], total: 1 },
        { ...empty, items: null },
        { ...empty, total: 1 },
        { ...empty, total: '0' },
    ]) {
        await page.route(
            `**${endpoint()}`,
            (route) =>
                route.fulfill({
                    status: 200,
                    contentType: 'application/json',
                    body: JSON.stringify(malformed),
                }),
            { times: 1 },
        );
        expect((await refresh(page)).status()).toBe(200);
        await expect(gallery(page)).toHaveAttribute('aria-busy', 'false');
        await expect(gallery(page)).toHaveAttribute('data-state', 'error');
        await expect(gallery(page).getByRole('alert')).toBeVisible();
        await expect(gallery(page).getByRole('alert')).not.toHaveText('');
        await expect(gallery(page).locator('.gallery-feedback')).toHaveAttribute('role', 'alert');
        await expect(gallery(page).getByRole('button')).toHaveCount(2);
        await expect(
            gallery(page).getByRole('button', { name: '测试数据', exact: true }),
        ).toBeDisabled();
        await expect(fetchButton(page)).toBeEnabled();
        await expect(gallery(page).locator('.gallery-empty')).toHaveText(emptyText);
        await expect(gallery(page)).not.toContainText('DEMO-GALLERY-MUST-NOT-RENDER');
        await expect(gallery(page).locator('img, video, canvas')).toHaveCount(0);
        expect((await refresh(page)).status()).toBe(200);
        await expectEmpty(page);
        await expect(gallery(page).locator('.gallery-feedback')).toHaveText(refreshedText);
    }
    expect(await businessState(page)).toEqual(before);
    expectNoExecution(observation);
    console.log(
        'DEVICE_GALLERY_RETRY PASS: GET500 plus14 null/malformed mode/deviceId/section/implemented/state/items/total variants rejected; alert and same single fetch button retry200; no fabricated photo items; device/events/snapshots unchanged; writes/external/WS commands/downloads=0',
    );
});

test('gallery disables the button while loading and aborts late responses on section and device changes, clearing feedback on reentry', async ({
    page,
}) => {
    const observation = observe(page);
    await login(page);
    observation.mutations.length = 0;
    const before = await businessState(page);
    await openGallery(page);
    await expectEmpty(page);
    expect((await refresh(page)).status()).toBe(200);
    await expect(gallery(page).locator('.gallery-feedback')).toHaveText(refreshedText);
    await choose(page, '设备信息');
    await expect(gallery(page)).toHaveCount(0);
    await choose(page, '相册图片');
    await expectEmpty(page);
    await expect(gallery(page).locator('.gallery-feedback')).toHaveCount(0);

    for (const change of ['section', 'device']) {
        let release;
        let started = 0;
        const gate = new Promise((resolve) => (release = resolve));
        const abortedBefore = observation.aborted.length;
        await page.route(
            `**${endpoint()}`,
            async (route) => {
                started++;
                await gate;
                await route
                    .fulfill({
                        status: 500,
                        json: { error: `DEMO-LATE-GALLERY-${change}` },
                    })
                    .catch(() => {});
            },
            { times: 1 },
        );
        try {
            await fetchButton(page).click();
            await expect.poll(() => started).toBe(1);
            await expect(gallery(page)).toHaveAttribute('aria-busy', 'true');
            await expect(fetchButton(page)).toBeDisabled();
            if (change === 'section') {
                await choose(page, '短信记录');
                await expect(gallery(page)).toHaveCount(0);
                await expect(page.locator('.sms-preview')).toBeVisible();
            } else {
                await page.locator('.device-back').click();
                await expect(page).toHaveURL('/');
                const deviceTwo = page.locator('.fleet-device-row[data-device-id="2"]');
                await expect(deviceTwo).toBeVisible();
                await deviceTwo.focus();
                await page.keyboard.press('Enter');
                await expect(page).toHaveURL('/devices/2');
                await expect(page.locator('.device-topbar h1')).toContainText('测试设备 2');
                await choose(page, '相册图片');
                await expectEmpty(page);
            }
            release();
            await expect.poll(() => observation.aborted.length).toBe(abortedBefore + 1);
            await expect(page.locator('.device-workbench')).not.toContainText(
                `DEMO-LATE-GALLERY-${change}`,
            );
            if (change === 'section') {
                await choose(page, '相册图片');
                await expectEmpty(page);
            }
            await expect(gallery(page).locator('.gallery-feedback')).toHaveCount(0);
        } finally {
            release();
            await page.unroute(`**${endpoint()}`);
        }
    }
    expect(await businessState(page)).toEqual(before);
    expectNoExecution(observation);
    console.log(
        'DEVICE_GALLERY_LIFECYCLE PASS: pending GET busy/disabled; section and SPA device changes abort2 old GET requests; late errors never appear in replacement section/device2; reentry restores empty preview with cleared feedback; device/events/snapshots unchanged; writes/external/WS commands/downloads=0',
    );
});

test('gallery preserves compact empty-canvas geometry, keyboard focus and independent desktop rails in both themes at 1440, 1280 and 800', async ({
    page,
}) => {
    const observation = observe(page);
    await login(page);
    observation.mutations.length = 0;
    const before = await businessState(page);
    const backgrounds = {};
    for (const theme of ['light', 'dark']) {
        await page.goto('/');
        if (theme === 'dark')
            await page.getByRole('button', { name: '切换明暗主题', exact: true }).click();
        await expect(page.locator('html')).toHaveAttribute('data-bs-theme', theme);
        for (const width of [1440, 1280, 800]) {
            await page.setViewportSize({ width, height: 900 });
            await openGallery(page);
            await expectEmpty(page);
            const top = await page.locator('.device-topbar').boundingBox();
            const left = await page.locator('.device-nav').boundingBox();
            const right = await page.locator('.device-tools').boundingBox();
            expect(top.height).toBe(44);
            expect(left.width).toBe(110);
            expect(left.x).toBe(0);
            expect(left.y).toBe(44);
            expect(right.width).toBe(176);
            expect(right.y).toBe(44);
            expect(right.x).toBeCloseTo(Math.max(1280, width) - 176, 0);
            await expect(gallery(page)).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
            const metrics = await gallery(page).evaluate((element) => {
                const toolbar = element.querySelector('.gallery-toolbar');
                const button = toolbar.querySelector('button');
                const empty = element.querySelector('.gallery-empty');
                const buttonStyle = getComputedStyle(button);
                const emptyStyle = getComputedStyle(empty);
                const toolbarBox = toolbar.getBoundingClientRect();
                const buttonBox = button.getBoundingClientRect();
                const emptyBox = empty.getBoundingClientRect();
                return {
                    toolbarHeight: toolbarBox.height,
                    buttonHeight: buttonBox.height,
                    buttonFont: buttonStyle.fontSize,
                    buttonWeight: buttonStyle.fontWeight,
                    buttonRadius: buttonStyle.borderRadius,
                    emptyPadding: emptyStyle.paddingTop,
                    emptyLine: emptyStyle.lineHeight,
                    emptyFont: emptyStyle.fontSize,
                    emptyWeight: emptyStyle.fontWeight,
                    emptyAlign: emptyStyle.textAlign,
                    emptyCenter: emptyBox.x + emptyBox.width / 2,
                    canvasCenter:
                        element.getBoundingClientRect().x +
                        element.getBoundingClientRect().width / 2,
                    noOverflow: element.scrollWidth <= element.clientWidth + 1,
                    background: getComputedStyle(element.parentElement).backgroundColor,
                    buttonColor: buttonStyle.color,
                    buttonBackground: buttonStyle.backgroundColor,
                };
            });
            expect(metrics.toolbarHeight).toBe(34);
            expect(metrics.buttonHeight).toBe(34);
            expect(metrics.buttonFont).toBe('11px');
            expect(metrics.buttonWeight).toBe('600');
            expect(metrics.buttonRadius).toBe('7px');
            expect(metrics.emptyPadding).toBe('88px');
            expect(metrics.emptyLine).toBe('18px');
            expect(metrics.emptyFont).toBe('11px');
            expect(metrics.emptyWeight).toBe('400');
            expect(metrics.emptyAlign).toBe('center');
            expect(metrics.emptyCenter).toBeCloseTo(metrics.canvasCenter, 0);
            expect(metrics.noOverflow).toBe(true);
            expect(metrics.buttonColor).not.toBe(metrics.buttonBackground);
            backgrounds[theme] = metrics.background;
            await page.keyboard.press('Tab');
            await fetchButton(page).focus();
            await expect(fetchButton(page)).toHaveCSS('outline-style', 'solid');
            await expect(fetchButton(page)).toHaveCSS('outline-width', '2px');
            expect((await refresh(page, 1, 'Enter')).status()).toBe(200);
            await expectEmpty(page);
            await expect(gallery(page).locator('.gallery-feedback')).toHaveText(refreshedText);
            expect(
                await page.evaluate(() => document.documentElement.scrollWidth),
            ).toBeGreaterThanOrEqual(1280);
            await capture(page, `device-gallery-${theme}-${width}.png`);
            if (width === 800) {
                await page.evaluate(() => window.scrollTo(360, 0));
                await expect.poll(() => page.evaluate(() => window.scrollX)).toBe(360);
                const scrolledLeft = await page.locator('.device-nav').boundingBox();
                const scrolledRight = await page.locator('.device-tools').boundingBox();
                expect(scrolledLeft.x).toBe(0);
                expect(scrolledLeft.y).toBe(44);
                expect(scrolledRight.width).toBe(176);
                expect(scrolledRight.y).toBe(44);
                expect(scrolledRight.x).toBeCloseTo(right.x - 360, 0);
                await capture(page, `device-gallery-scroll-${theme}-800.png`);
            }
        }
    }
    expect(backgrounds.dark).not.toBe(backgrounds.light);
    await page.setViewportSize({ width: 1440, height: 520 });
    await openGallery(page);
    await expectEmpty(page);
    const beforeScroll = await page.evaluate(() => ({
        x: window.scrollX,
        y: window.scrollY,
        canvas: document.querySelector('.device-canvas').scrollTop,
        left: document.querySelector('.device-nav').scrollTop,
    }));
    const tools = page.locator('.device-tools');
    expect(await tools.evaluate((element) => element.scrollHeight > element.clientHeight)).toBe(
        true,
    );
    await tools.evaluate((element) => {
        element.scrollTop = element.scrollHeight;
    });
    await expect.poll(() => tools.evaluate((element) => element.scrollTop)).toBeGreaterThan(0);
    expect(
        await page.evaluate(() => ({
            x: window.scrollX,
            y: window.scrollY,
            canvas: document.querySelector('.device-canvas').scrollTop,
            left: document.querySelector('.device-nav').scrollTop,
        })),
    ).toEqual(beforeScroll);
    await expectEmpty(page);
    expect(await businessState(page)).toEqual(before);
    expectNoExecution(observation);
    console.log(
        'DEVICE_GALLERY_GEOMETRY PASS: light/dark1440/1280/800; top44/left110/right176/min1280/xscroll360; transparent plain canvas/toolbar34/button34-font11-weight600-radius7; centered empty padding88/line18/font11-weight400; keyboard2px focus; independent right rail scroll; device/events/snapshots unchanged; writes/external/WS commands/downloads=0',
    );
});
