import { test, expect } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';

const artifactDir = process.env.DEVICE_RIGHTBAR_ARTIFACT_DIR || 'test-results';
const groups = [
    {
        id: 'remote',
        label: '画面与远程',
        actions: ['screenshot', 'reader', 'hd-preview', 'camera-preview'],
    },
    {
        id: 'screen',
        label: '黑屏控制',
        actions: [
            'black-pure-preview',
            'black-system-preview',
            'black-update-preview',
            'black-close-preview',
        ],
    },
    { id: 'policy', label: '设备策略', actions: ['uninstall-on-preview', 'uninstall-off-preview'] },
    {
        id: 'maintenance',
        label: '状态与维护',
        actions: ['dnd-on-preview', 'dnd-off-preview', 'restart-preview'],
    },
    { id: 'security', label: '安全工具', actions: ['password-preview'] },
];
const labels = [
    'BM截图',
    '打开阅读器',
    '打开HD投屏',
    '打开摄像头',
    '开启纯黑黑屏',
    '开启系统黑屏',
    '开启更新黑屏',
    '关闭黑屏',
    '防卸载开',
    '防卸载关',
    '勿扰',
    '取消勿扰',
    '重启应用',
    '捕获锁屏密码',
];
const actions = groups.flatMap((group) => group.actions);
const uiOnlyActions = actions.slice(2);
const reference = (page) => page.locator('.device-reference-tools');
const extra = (page) => page.locator('details.device-viewer-extra');
const summary = (page) => extra(page).locator(':scope > summary');
const action = (page, id) => reference(page).locator(`[data-rightbar-action="${id}"]`);
const feedback = (page) => reference(page).getByRole('status');

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
    await expect(reference(page)).toBeVisible();
    await expect(page.getByRole('textbox', { name: '设备备注', exact: true })).toBeVisible();
    await page.waitForLoadState('networkidle');
}

async function openMoreViewing(page) {
    if ((await extra(page).getAttribute('open')) === null) await summary(page).click();
    await expect(extra(page)).toHaveAttribute('open');
}

async function businessState(page) {
    const values = await Promise.all(
        ['/api/devices/1', '/api/events', '/api/snapshots'].map(async (endpoint) => {
            const response = await page.request.get(endpoint);
            expect(response.status()).toBe(200);
            return response.json();
        }),
    );
    return { detail: values[0], events: values[1], snapshots: values[2] };
}

async function storageState(page) {
    return page.evaluate(() => ({
        local: Object.fromEntries(
            Object.keys(localStorage)
                .sort()
                .map((key) => [key, localStorage.getItem(key)]),
        ),
        session: Object.fromEntries(
            Object.keys(sessionStorage)
                .sort()
                .map((key) => [key, sessionStorage.getItem(key)]),
        ),
    }));
}

function observe(page) {
    const requests = [],
        mutations = [],
        commands = [],
        external = [],
        errors = [],
        downloads = [];
    page.on('request', (request) => {
        const url = new URL(request.url());
        requests.push({ method: request.method(), path: url.pathname });
        if (['POST', 'PATCH', 'PUT', 'DELETE'].includes(request.method()))
            mutations.push({ method: request.method(), path: url.pathname });
        if (['http:', 'https:'].includes(url.protocol) && url.origin !== 'http://127.0.0.1:8081')
            external.push(url.href);
    });
    page.on('websocket', (socket) => {
        socket.on('framesent', ({ payload }) => {
            try {
                const message = JSON.parse(String(payload));
                if (message.type === 'command') commands.push(message);
            } catch {
                // The assertion counts structured device-command frames, not socket handshakes.
            }
        });
    });
    page.on('pageerror', (error) => errors.push(error.message));
    page.on('download', (download) => downloads.push(download.suggestedFilename()));
    return { requests, mutations, commands, external, errors, downloads };
}

function expectNoExecution(observation, allowed = []) {
    expect(observation.mutations.filter((item) => !allowed.includes(item.path))).toEqual([]);
    expect(observation.commands).toEqual([]);
    expect(observation.external).toEqual([]);
    expect(observation.errors).toEqual([]);
    expect(observation.downloads).toEqual([]);
}

async function capture(page, filename) {
    await mkdir(artifactDir, { recursive: true });
    await page.screenshot({ path: path.join(artifactDir, filename), animations: 'disabled' });
}

test('reference right toolbar has exactly five ordered groups and fourteen buttons; twelve UI-only actions do not dispatch or change data', async ({
    page,
}) => {
    const observation = observe(page);
    await login(page);
    observation.mutations.length = 0;
    const before = await businessState(page);
    await openDetail(page);
    await expect(reference(page)).toHaveAccessibleName('设备快捷工具');
    await expect(reference(page).locator('.tool-group')).toHaveCount(5);
    await expect(reference(page).locator('.tool-group h2')).toHaveText(
        groups.map((group) => group.label),
    );
    await expect(reference(page).locator('button.tool-button')).toHaveText(labels);
    expect(
        await reference(page)
            .locator('.tool-group')
            .evaluateAll((items) =>
                items.map((item) => ({
                    id: item.dataset.rightbarGroup,
                    actions: [...item.querySelectorAll('button[data-rightbar-action]')].map(
                        (button) => button.dataset.rightbarAction,
                    ),
                })),
            ),
    ).toEqual(groups.map(({ id, actions }) => ({ id, actions })));
    await expect(reference(page).locator('[data-ui-only="false"]')).toHaveCount(2);
    await expect(reference(page).locator('[data-ui-only="true"]')).toHaveCount(12);
    await expect(extra(page)).not.toHaveAttribute('open');
    await expect(summary(page)).toHaveText('更多查看');
    await expect(
        extra(page).getByRole('heading', { name: '历史快照', exact: true }),
    ).not.toBeVisible();
    await expect(feedback(page)).toHaveCount(0);
    const stored = await storageState(page);
    const topState = await page
        .locator('.device-topbar input[type="checkbox"]')
        .evaluateAll((items) => items.map((item) => item.checked));
    observation.requests.length = 0;
    for (const id of uiOnlyActions) {
        const button = action(page, id);
        await expect(button).toBeEnabled();
        await button.click();
        await expect(feedback(page)).toContainText(await button.textContent());
        await expect(feedback(page)).toContainText(/仅为\s*UI\s*预览，功能尚未接入/);
        await feedback(page).getByRole('button', { name: '关闭工具提示', exact: true }).click();
        await expect(feedback(page)).toHaveCount(0);
        await expect(button).toBeFocused();
        await expect(page.locator('.floating-viewer')).toHaveCount(0);
    }
    expect(observation.requests).toEqual([]);
    expect(await storageState(page)).toEqual(stored);
    expect(
        await page
            .locator('.device-topbar input[type="checkbox"]')
            .evaluateAll((items) => items.map((item) => item.checked)),
    ).toEqual(topState);
    expect(await businessState(page)).toEqual(before);
    expectNoExecution(observation);
    await capture(page, 'device-right-tools-local-actions.png');
    console.log(
        'DEVICE_RIGHT_TOOLS_LOCAL PASS: groups5/buttons14 exact order; existing viewer2/UI-only12; each local feedback dismiss restores opener; requests/commands/external/downloads=0; device/snapshots/events/checkboxes/storage unchanged',
    );
});

test('existing sample viewers keep 300px; more viewing is keyboard-accessible and query-preserved but resets with device, account and reload', async ({
    page,
}) => {
    const observation = observe(page);
    await login(page);
    observation.mutations.length = 0;
    await openDetail(page);
    await action(page, 'screenshot').click();
    const shot = page.getByRole('region', { name: '截图', exact: true });
    const reader = page.getByRole('region', { name: '阅读器', exact: true });
    await expect(shot).toBeVisible();
    await expect(reader).toBeVisible();
    expect((await shot.boundingBox()).width).toBe(300);
    expect((await reader.boundingBox()).width).toBe(300);
    await expect(reader.locator('.reader-map-node')).toHaveCount(19);
    await expect(extra(page)).not.toHaveAttribute('open');
    await reader.getByRole('button', { name: '关闭阅读器', exact: true }).click();
    await action(page, 'reader').click();
    await expect(reader).toBeVisible();
    expect((await reader.boundingBox()).width).toBe(300);
    await summary(page).focus();
    await page.keyboard.press('Enter');
    await expect(extra(page)).toHaveAttribute('open');
    await summary(page).focus();
    await page.keyboard.press('Space');
    await expect(extra(page)).not.toHaveAttribute('open');
    await summary(page).press('Enter');
    await expect(extra(page)).toHaveAttribute('open');
    await extra(page).getByRole('button', { name: '关闭全部浮窗', exact: true }).click();
    await expect(page.locator('.floating-viewer')).toHaveCount(0);
    const before = await businessState(page);
    const chooser = extra(page).getByRole('combobox', { name: '切换快照', exact: true });
    const snapshotId = String(before.detail.snapshots.at(-1).id);
    await chooser.selectOption(snapshotId);
    await expect(page).toHaveURL(new RegExp(`[?&]snapshot=${snapshotId}(?:&|$)`));
    await expect(reference(page)).toBeVisible();
    await expect(extra(page)).toHaveAttribute('open');
    await expect(chooser).toHaveValue(snapshotId);
    const exported = extra(page).getByRole('link', { name: '导出脱敏 JSON', exact: true });
    await expect(exported).toHaveAttribute('href', `/api/snapshots/${snapshotId}/export`);
    await action(page, 'hd-preview').focus();
    await page.keyboard.press('Enter');
    await expect(feedback(page)).toContainText(/仅为\s*UI\s*预览，功能尚未接入/);
    await openDetail(page, 2);
    await expect(feedback(page)).toHaveCount(0);
    await expect(extra(page)).not.toHaveAttribute('open');
    await expect(action(page, 'screenshot')).toBeDisabled();
    await expect(action(page, 'reader')).toBeDisabled();
    await action(page, 'camera-preview').focus();
    await page.keyboard.press('Space');
    await expect(feedback(page)).toContainText('打开摄像头');
    await openMoreViewing(page);
    await page.reload();
    await expect(reference(page)).toBeVisible();
    await expect(feedback(page)).toHaveCount(0);
    await expect(extra(page)).not.toHaveAttribute('open');
    await action(page, 'password-preview').click();
    await expect(feedback(page)).toContainText('捕获锁屏密码');
    await openMoreViewing(page);
    await page.goto('/settings/account');
    await page.getByRole('button', { name: '退出登录', exact: true }).click();
    await expect(page).toHaveURL('/login');
    await expect(reference(page)).toHaveCount(0);
    await login(page);
    await openDetail(page, 2);
    await expect(feedback(page)).toHaveCount(0);
    await expect(extra(page)).not.toHaveAttribute('open');
    expect(await businessState(page)).toEqual(before);
    expectNoExecution(observation, ['/api/auth/logout', '/api/auth/login']);
    console.log(
        'DEVICE_RIGHT_TOOLS_LIFECYCLE PASS: screenshot/reader existing sample300px/map19; more viewing Enter/Space; same-device snapshot query/export retained; missing snapshot disables viewers; local feedback and folded more reset on device/reload/logout-login; device/history/events unchanged; no device commands',
    );
});

test('right toolbar retains compact five-tone desktop styling and its own scroll at light/dark 1440, 1280 and 800', async ({
    page,
}) => {
    const observation = observe(page);
    await login(page);
    observation.mutations.length = 0;
    const tones = [
        'reader',
        'screenshot',
        'black-pure-preview',
        'black-close-preview',
        'dnd-on-preview',
    ];
    const themeMetrics = {};
    for (const theme of ['light', 'dark']) {
        await page.goto('/');
        if (theme === 'dark')
            await page.getByRole('button', { name: '切换明暗主题', exact: true }).click();
        await expect(page.locator('html')).toHaveAttribute('data-bs-theme', theme);
        for (const width of [1440, 1280, 800]) {
            await page.setViewportSize({ width, height: 900 });
            await openDetail(page);
            await expect(extra(page)).not.toHaveAttribute('open');
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
            const inheritedFont = await reference(page).evaluate(
                (element) => getComputedStyle(element).fontFamily,
            );
            const headingMetrics = await reference(page)
                .locator(':scope > .tool-group > h2')
                .evaluateAll((headings) =>
                    headings.map((heading) => {
                        const style = getComputedStyle(heading);
                        const bounds = heading.getBoundingClientRect();
                        const firstButton = heading.parentElement.querySelector('.tool-button');
                        return {
                            font: style.fontSize,
                            family: style.fontFamily,
                            weight: style.fontWeight,
                            lineHeight: style.lineHeight,
                            spacing: style.letterSpacing,
                            height: bounds.height,
                            headingToButton:
                                firstButton.getBoundingClientRect().top - bounds.bottom,
                        };
                    }),
                );
            expect(headingMetrics).toHaveLength(5);
            for (const metric of headingMetrics) {
                expect(metric.font).toBe('8px');
                expect(metric.family).toBe(inheritedFont);
                expect(metric.weight).toBe('600');
                expect(metric.lineHeight).toBe('9.6px');
                expect(metric.spacing).toBe('1px');
                expect(metric.height).toBeCloseTo(9.6, 1);
                expect(metric.headingToButton).toBeCloseTo(12, 1);
            }
            const metrics = await reference(page)
                .locator('.tool-button')
                .evaluateAll((buttons) =>
                    buttons.map((button) => {
                        const style = getComputedStyle(button);
                        return {
                            height: button.getBoundingClientRect().height,
                            radius: style.borderRadius,
                            font: style.fontSize,
                            family: style.fontFamily,
                            weight: style.fontWeight,
                            lineHeight: style.lineHeight,
                            color: style.color,
                            background: style.backgroundColor,
                            border: style.borderTopColor,
                        };
                    }),
                );
            expect(metrics).toHaveLength(14);
            for (const metric of metrics) {
                expect(metric.height).toBe(34);
                expect(metric.radius).toBe('7px');
                expect(metric.font).toBe('11px');
                expect(metric.family).toBe(inheritedFont);
                expect(metric.weight).toBe('600');
                expect(metric.lineHeight).toBe('16px');
                expect(metric.color).not.toBe(metric.background);
                expect(metric.background).not.toBe('rgba(0, 0, 0, 0)');
            }
            const toneMetrics = tones.map((id) => metrics[actions.indexOf(id)]);
            expect(
                new Set(
                    toneMetrics.map(
                        (metric) => `${metric.background}/${metric.color}/${metric.border}`,
                    ),
                ).size,
            ).toBe(5);
            themeMetrics[theme] = toneMetrics;
            await action(page, 'hd-preview').focus();
            await expect(action(page, 'hd-preview')).toHaveCSS('outline-style', 'solid');
            await expect(action(page, 'hd-preview')).toHaveCSS('outline-width', '2px');
            await summary(page).focus();
            await expect(summary(page)).toHaveCSS('outline-style', 'solid');
            await expect(summary(page)).toHaveCSS('outline-width', '2px');
            expect(
                await page.evaluate(() => document.documentElement.scrollWidth),
            ).toBeGreaterThanOrEqual(1280);
            if (width === 800) {
                await page.evaluate(() => window.scrollTo(360, 0));
                await expect.poll(() => page.evaluate(() => window.scrollX)).toBe(360);
                const scrolledRight = await page.locator('.device-tools').boundingBox();
                expect(scrolledRight.width).toBe(176);
                expect(scrolledRight.y).toBe(44);
                expect(scrolledRight.x).toBeCloseTo(right.x - 360, 0);
                const scrolledLeft = await page.locator('.device-nav').boundingBox();
                expect(scrolledLeft.x).toBe(0);
            }
            await capture(page, `device-right-tools-${theme}-${width}.png`);
            await openMoreViewing(page);
            const oldHeadingMetrics = await extra(page)
                .locator('.tool-group > h2')
                .evaluateAll((headings) =>
                    headings.map((heading) => {
                        const style = getComputedStyle(heading);
                        return {
                            font: style.fontSize,
                            family: style.fontFamily,
                            weight: style.fontWeight,
                            lineHeight: style.lineHeight,
                            height: heading.getBoundingClientRect().height,
                        };
                    }),
                );
            expect(oldHeadingMetrics.length).toBeGreaterThan(0);
            for (const metric of oldHeadingMetrics) {
                expect(metric.font).toBe('8px');
                expect(metric.family).toBe(inheritedFont);
                expect(metric.weight).toBe('600');
                expect(metric.lineHeight).toBe('28px');
                expect(metric.height).toBe(28);
            }
            await summary(page).click();
            await expect(extra(page)).not.toHaveAttribute('open');
        }
    }
    expect(themeMetrics.dark.map((metric) => metric.background)).not.toEqual(
        themeMetrics.light.map((metric) => metric.background),
    );
    await page.setViewportSize({ width: 1440, height: 520 });
    await openDetail(page);
    const beforeScroll = await page.evaluate(() => ({
        x: window.scrollX,
        y: window.scrollY,
        canvas: document.querySelector('.device-canvas').scrollTop,
    }));
    const tools = page.locator('.device-tools');
    expect(await tools.evaluate((element) => element.scrollHeight > element.clientHeight)).toBe(
        true,
    );
    await tools.evaluate((element) => {
        element.scrollTop = element.scrollHeight;
    });
    await expect.poll(() => tools.evaluate((element) => element.scrollTop)).toBeGreaterThan(0);
    await expect(summary(page)).toBeVisible();
    expect(
        await page.evaluate(() => ({
            x: window.scrollX,
            y: window.scrollY,
            canvas: document.querySelector('.device-canvas').scrollTop,
        })),
    ).toEqual(beforeScroll);
    expect((await page.locator('.device-topbar').boundingBox()).height).toBe(44);
    expect((await tools.boundingBox()).width).toBe(176);
    expectNoExecution(observation);
    console.log(
        'DEVICE_RIGHT_TOOLS_GEOMETRY PASS: light/dark1440/1280/800; heading5 font8/weight600/line9.6/height9.6/gap12; button14 height34/radius7/font11/weight600/line16; inherited font chain; more-viewing old heading line28/height28 unchanged; five distinct readable tones; top44/left110/right176/min1280/xscroll360; visible keyboard outlines; short viewport independent right scroll; commands/mutations/external/downloads=0',
    );
});
