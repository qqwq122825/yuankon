import { test, expect } from '@playwright/test';

async function openMoreViewing(page) {
    const extra = page.locator('details.device-viewer-extra');
    await expect(extra).toBeAttached();
    if ((await extra.getAttribute('open')) === null)
        await extra.locator(':scope > summary').click();
    await expect(extra).toHaveAttribute('open');
}

const previewSections = [
    'analysis',
    'tools',
    'sms',
    'apps',
    'gallery',
    'password',
    'payments',
    'templates',
    'input-events',
    'diagnostic',
];
const previewActions = [
    'analyze-sample',
    'screen-preview',
    'camera-preview',
    'permissions-preview',
    'diagnostic-preview',
    'export-preview',
    'apps-preview',
    'gallery-preview',
    'refresh-preview',
];
const topToggles = ['截图', '阅读器', '密码事件', '快捷预览', '诊断预览'];
const headers = { 'X-Boundary-Request': '1' };
const releaseDir = process.env.DEVICE_PREVIEW_ARTIFACT_DIR || 'test-results';
const panel = (page, instance = 'general') =>
    page.locator(`.device-preview-panel[data-instance="${instance}"]`);
const previewWindow = (page, instance = 'general') =>
    page.locator('.floating-viewer').filter({ has: panel(page, instance) });

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

async function openTools(page) {
    const entry = page
        .getByRole('navigation', { name: '设备内导航', exact: true })
        .getByRole('button', {
            name: '工具箱',
            exact: true,
        });
    await entry.click();
    await expect(page.locator('.toolbox-preview')).toBeVisible();
    const status = page.locator('.toolbox-preview').getByRole('button', {
        name: '模块状态',
        exact: true,
    });
    await status.click();
    await expect(panel(page)).toBeVisible();
    return status;
}

async function expectEmptyPreview(page, instance = 'general') {
    await expect(panel(page, instance)).toHaveAttribute('aria-busy', 'false');
    await expect(panel(page, instance)).toContainText('未接入');
    await expect(panel(page, instance).locator('.device-preview-count')).toHaveText(/共\s*0\s*项/);
}

function observe(page) {
    const commands = [];
    const requests = [];
    const errors = [];
    page.on('websocket', (socket) => {
        socket.on('framesent', ({ payload }) => {
            try {
                const message = JSON.parse(String(payload));
                if (message.type === 'command') commands.push(message);
            } catch {
                // The observation only counts structured device-command frames.
            }
        });
    });
    page.on('request', (request) => {
        const url = new URL(request.url());
        if (url.origin !== 'http://127.0.0.1:8081')
            requests.push({ method: request.method(), path: url.href });
        else if (['POST', 'PATCH', 'PUT', 'DELETE'].includes(request.method()))
            requests.push({
                method: request.method(),
                path: url.pathname,
                body: request.postDataJSON(),
            });
    });
    page.on('pageerror', (error) => errors.push(error.message));
    return { commands, requests, errors };
}

async function geometry(locator) {
    const box = await locator.boundingBox();
    expect(box).not.toBeNull();
    return { ...box, right: box.x + box.width, bottom: box.y + box.height };
}

function intersects(a, b) {
    return a.x < b.right && b.x < a.right && a.y < b.bottom && b.y < a.bottom;
}

async function scrollOffsets(locator) {
    return locator.evaluate((element) => {
        const offsets = [{ key: 'window', x: window.scrollX, y: window.scrollY }];
        let parent = element.parentElement;
        while (parent) {
            if (parent !== document.scrollingElement)
                offsets.push({
                    key: `${parent.tagName.toLowerCase()}${parent.id ? `#${parent.id}` : ''}${parent.className ? `.${String(parent.className).trim().replace(/\s+/g, '.')}` : ''}`,
                    x: parent.scrollLeft,
                    y: parent.scrollTop,
                });
            parent = parent.parentElement;
        }
        const { x, y, width, height } = element.getBoundingClientRect();
        return {
            box: { x, y, width, height, right: x + width, bottom: y + height },
            offsets,
            totalX: offsets.reduce((sum, offset) => sum + offset.x, 0),
        };
    });
}

test('authenticated detail preview catalog and all sections return honest empty states with strict validation and no device commands', async ({
    page,
    browser,
}) => {
    const observation = observe(page);
    await login(page);
    observation.requests.length = 0;
    const catalogResponse = await page.request.get('/api/devices/1/ui-preview');
    expect(catalogResponse.status()).toBe(200);
    const catalog = await catalogResponse.json();
    expect(catalog).toMatchObject({
        mode: 'preview',
        deviceId: 1,
        implemented: false,
        state: 'not_connected',
    });
    expect(catalog.sections.map((section) => section.id)).toEqual(previewSections);
    expect(catalog.tools.map((tool) => tool.id)).toEqual(previewActions);
    for (const section of previewSections) {
        const response = await page.request.get(`/api/devices/1/ui-preview/${section}`);
        expect(response.status()).toBe(200);
        expect(await response.json()).toMatchObject({
            items: [],
            total: 0,
            implemented: false,
            state: 'not_connected',
        });
    }
    expect((await page.request.get('/api/devices/1/ui-preview/unknown')).status()).toBe(400);
    expect((await page.request.get('/api/devices/1/ui-preview?extra=1')).status()).toBe(400);
    expect((await page.request.get('/api/devices/999999/ui-preview')).status()).toBe(404);
    expect((await page.request.get('/api/devices/not-a-number/ui-preview')).status()).toBe(400);
    expect(
        (
            await page.request.post('/api/devices/1/ui-preview/actions', {
                headers,
                data: { action: 'unknown-action' },
            })
        ).status(),
    ).toBe(400);
    expect(
        (
            await page.request.post('/api/devices/1/ui-preview/actions', {
                headers,
                data: { action: 'screen-preview', extra: 'invalid-fixture' },
            })
        ).status(),
    ).toBe(400);
    const anonymous = await browser.newContext();
    try {
        expect(
            (
                await anonymous.request.get('http://127.0.0.1:8081/api/devices/1/ui-preview')
            ).status(),
        ).toBe(401);
    } finally {
        await anonymous.close();
    }
    await openDetail(page);
    await expect(page.locator('.device-topbar').getByRole('checkbox')).toHaveCount(5);
    for (const label of topToggles)
        await expect(
            page.locator('.device-topbar').getByRole('checkbox', { name: label, exact: true }),
        ).not.toBeChecked();
    await openTools(page);
    await expectEmptyPreview(page);
    const chooser = panel(page).getByRole('combobox', { name: '选择预览栏目', exact: true });
    await expect(chooser.locator('option')).toHaveCount(10);
    for (const section of previewSections) {
        await chooser.selectOption(section);
        await expectEmptyPreview(page);
        await expect(chooser).toHaveValue(section);
    }
    await expect(panel(page)).not.toContainText(
        /凭证捕获|黑屏隐蔽|防卸载|自毁|密码绕过|注入执行|任意\s*ADB/,
    );
    await expect(page.locator('.device-reference-tools [data-ui-only="true"]')).toHaveCount(12);
    await expect(panel(page)).not.toContainText(/sk-|CVV|真实验证码|真实密码/);
    expect(observation.commands).toEqual([]);
    expect(observation.requests).toEqual([]);
    expect(observation.errors).toEqual([]);
    await page.screenshot({ path: 'test-results/device-detail-preview-empty.png' });
    console.log(
        'DETAIL_PREVIEW_CONTRACT PASS: catalog10/9; sections empty/not_connected; invalid input=400; missing=404; anonymous=401; UI five unchecked toggles; commands/external/mutations=0',
    );
});

test('every allowed toolbox action calls only the authenticated fixed preview endpoint and receives 501 without dispatch', async ({
    page,
}) => {
    const observation = observe(page);
    await login(page);
    observation.requests.length = 0;
    const catalog = await (await page.request.get('/api/devices/1/ui-preview')).json();
    await openDetail(page);
    await openTools(page);
    await expectEmptyPreview(page);
    for (const tool of catalog.tools) {
        const endpoint = '/api/devices/1/ui-preview/actions';
        const returned = page.waitForResponse(
            (response) =>
                new URL(response.url()).pathname === endpoint &&
                response.request().method() === 'POST',
        );
        await panel(page).getByRole('button', { name: tool.label, exact: true }).click();
        const response = await returned;
        expect(response.status()).toBe(501);
        expect(response.request().postDataJSON()).toEqual({ action: tool.id });
        expect(await response.json()).toMatchObject({ code: 'NOT_IMPLEMENTED', dispatched: false });
        await expect(panel(page)).toContainText('未接入');
        await expect(panel(page)).toContainText('未下发');
        await expect(
            panel(page).getByRole('button', { name: tool.label, exact: true }),
        ).toBeEnabled();
    }
    expect(observation.requests).toHaveLength(9);
    expect(
        observation.requests.every(
            (request) =>
                request.method === 'POST' && request.path === '/api/devices/1/ui-preview/actions',
        ),
    ).toBe(true);
    expect(observation.requests.map((request) => request.body.action)).toEqual(previewActions);
    expect(observation.commands).toEqual([]);
    expect(observation.errors).toEqual([]);
    await page.screenshot({ path: 'test-results/device-detail-preview-501-actions.png' });
    console.log(
        'DETAIL_PREVIEW_ACTION PASS: nine allowlisted POST actions; exact action-only bodies; HTTP501 NOT_IMPLEMENTED/dispatched=false; no added device commands/external calls',
    );
});

test('catalog and section failures have explicit retry, recover to real empty data and keep the parent detail intact', async ({
    page,
}) => {
    const observation = observe(page);
    await login(page);
    observation.requests.length = 0;
    await page.route(
        '**/api/devices/1/ui-preview',
        (route) => route.fulfill({ status: 500, json: { error: '合成目录读取失败' } }),
        { times: 1 },
    );
    await openDetail(page);
    await openMoreViewing(page);
    const catalogError = page.locator('.device-preview-catalog-error');
    await expect(catalogError).toContainText('合成目录读取失败');
    await openTools(page);
    const catalogRetry = catalogError.getByRole('button', { name: '重试预览目录', exact: true });
    await catalogRetry.focus();
    await page.keyboard.press('Enter');
    await expect(catalogError).toHaveCount(0);
    await expectEmptyPreview(page);
    await expect(panel(page).locator('.device-preview-action')).toHaveCount(9);
    const retry = panel(page).getByRole('button', { name: '重试预览', exact: true });
    await page.route(
        '**/api/devices/1/ui-preview/gallery',
        (route) => route.fulfill({ status: 500, json: { error: '合成栏目读取失败' } }),
        { times: 1 },
    );
    const chooser = panel(page).getByRole('combobox', { name: '选择预览栏目', exact: true });
    await chooser.selectOption('gallery');
    await expect(panel(page).getByRole('alert')).toContainText('合成栏目读取失败');
    await retry.click();
    await expectEmptyPreview(page);
    await expect(chooser).toHaveValue('gallery');
    await expect(panel(page).getByRole('alert')).toHaveCount(0);
    await expect(page.getByRole('textbox', { name: '设备备注', exact: true })).toBeVisible();
    await expect(page).toHaveURL('/devices/1');
    expect(observation.requests).toEqual([]);
    expect(observation.commands).toEqual([]);
    expect(observation.errors).toEqual([]);
    await page.screenshot({ path: 'test-results/device-detail-preview-retry.png' });
    console.log(
        'DETAIL_PREVIEW_RETRY PASS: catalog500 and section500 alerts; keyboard/click GET retry200 empty; parent detail/route retained; commands/mutations/external=0',
    );
});

test('closing or changing devices aborts in-flight preview reads and late responses never populate the next device', async ({
    page,
}) => {
    const observation = observe(page);
    await login(page);
    observation.requests.length = 0;
    await openDetail(page);
    let finishTools;
    const toolsGate = new Promise((resolve) => (finishTools = resolve));
    let toolRequests = 0;
    await page.route('**/api/devices/1/ui-preview/tools', async (route) => {
        toolRequests++;
        await toolsGate;
        await route.fulfill({ status: 500, json: { error: '迟到的合成工具响应' } }).catch(() => {});
    });
    const entry = await openTools(page);
    await expect.poll(() => toolRequests).toBe(1);
    await expect(panel(page)).toHaveAttribute('aria-busy', 'true');
    await previewWindow(page).getByRole('button', { name: /^关闭/ }).click();
    await expect(panel(page)).toHaveCount(0);
    await expect(entry).toBeFocused();
    finishTools();
    await page.waitForTimeout(100);
    await expect(page.getByText('迟到的合成工具响应', { exact: false })).toHaveCount(0);
    await page.unroute('**/api/devices/1/ui-preview/tools');
    let finishApps;
    const appsGate = new Promise((resolve) => (finishApps = resolve));
    let appsRequests = 0;
    await page.route('**/api/devices/1/ui-preview/apps', async (route) => {
        appsRequests++;
        await appsGate;
        await route
            .fulfill({ status: 500, json: { error: '迟到的设备一栏目响应' } })
            .catch(() => {});
    });
    await page
        .getByRole('navigation', { name: '设备内导航', exact: true })
        .getByRole('button', { name: '应用列表', exact: true })
        .click();
    await expect.poll(() => appsRequests).toBe(1);
    await page.locator('.device-back').click();
    await expect(page).toHaveURL('/');
    await expect(panel(page)).toHaveCount(0);
    await openDetail(page, 2);
    await openTools(page);
    await expectEmptyPreview(page);
    finishApps();
    await page.waitForTimeout(100);
    await expect(panel(page)).not.toContainText('迟到的设备一栏目响应');
    await expect(page.locator('.device-topbar h1')).toContainText('测试设备 2');
    await expect(page).toHaveURL('/devices/2');
    expect(observation.requests).toEqual([]);
    expect(observation.commands).toEqual([]);
    expect(observation.errors).toEqual([]);
    console.log(
        'DETAIL_PREVIEW_CANCEL PASS: close and route change abort pending GET; focus restored; late device1 error absent on device2; commands/mutations/external=0',
    );
});

test('independent password and shortcut preview windows preserve keyboard focus, folded research metadata and saved device data', async ({
    page,
}) => {
    const observation = observe(page);
    await login(page);
    observation.requests.length = 0;
    const before = await (await page.request.get('/api/devices/1')).json();
    await openDetail(page);
    const research = page.locator('details.detail-research-info');
    const summary = research.locator(':scope > summary');
    const navigation = page.getByRole('navigation', { name: '设备内导航', exact: true });
    await expect(research).toHaveCount(0);
    for (const name of ['设备研究信息', '历史快照', '观察记录'])
        await expect(navigation.getByRole('button', { name, exact: true })).toHaveCount(0);
    await expect(navigation.locator('.device-research-menu button')).toHaveText([
        '节点信息',
        'API调试',
        '备注',
    ]);
    const tools = page.locator('.device-tools');
    await openMoreViewing(page);
    await expect(tools.getByRole('heading', { name: '历史快照', exact: true })).toBeVisible();
    const snapshotChooser = tools.getByRole('combobox', { name: '切换快照', exact: true });
    await expect(snapshotChooser).toBeVisible();
    expect(before.snapshots.length).toBeGreaterThan(0);
    const selectedSnapshot = before.snapshots.at(-1);
    await snapshotChooser.selectOption(String(selectedSnapshot.id));
    await expect(page).toHaveURL(new RegExp(`[?&]snapshot=${selectedSnapshot.id}(?:&|$)`));
    await expect(snapshotChooser).toHaveValue(String(selectedSnapshot.id));
    const snapshotExport = tools.getByRole('link', { name: '导出脱敏 JSON', exact: true });
    await expect(snapshotExport).toBeVisible();
    await expect(snapshotExport).toHaveAttribute(
        'href',
        `/api/snapshots/${selectedSnapshot.id}/export`,
    );
    const exported = await page.request.get(await snapshotExport.getAttribute('href'));
    expect(exported.status()).toBe(200);
    expect(exported.headers()['content-disposition']).toContain(
        `snapshot-${selectedSnapshot.id}.json`,
    );
    const selectedDetail = await (
        await page.request.get(`/api/devices/1?snapshot=${selectedSnapshot.id}`)
    ).json();
    expect(await exported.json()).toEqual(selectedDetail.snapshot.payload);
    expect(selectedDetail.snapshots).toEqual(before.snapshots);
    expect(selectedDetail.events).toEqual(before.events);
    expect(selectedDetail.device.note).toBe(before.device.note);
    await navigation.getByRole('button', { name: '备注', exact: true }).click();
    await expect(summary).toHaveText('设备研究信息');
    await expect(research).toHaveAttribute('open');
    await summary.focus();
    await page.keyboard.press('Space');
    await expect(research).not.toHaveAttribute('open');
    await expect(research.locator('.metadata-list')).not.toBeVisible();
    await summary.focus();
    await page.keyboard.press('Enter');
    await expect(research).toHaveAttribute('open');
    await expect(research.locator('.metadata-list')).toBeVisible();
    await expect(research.locator('.metadata-list dt')).toHaveText([
        '设备 ID',
        '设备标识',
        'APK ID / 归属',
        '品牌 / Android',
        '电量 / 无障碍',
        '最近入库',
        '备注',
    ]);
    const values = research.locator('.metadata-list dd');
    await expect(values).toHaveCount(7);
    await expect(values.nth(0)).toHaveText(String(before.device.id));
    await expect(values.nth(1)).toHaveText(before.device.public_id);
    await expect(values.nth(3)).toContainText(before.device.brand);
    await expect(values.nth(3)).toContainText(before.device.android_version);
    await expect(values.nth(4)).toContainText(String(before.device.battery));
    await expect(values.nth(6)).toContainText(before.device.note || '暂无备注');
    await expect(research.getByRole('button', { name: '查询状态', exact: true })).toBeVisible();
    await summary.focus();
    await page.keyboard.press('Space');
    await expect(research).not.toHaveAttribute('open');
    await expect(research.locator('.metadata-list')).not.toBeVisible();
    await navigation.getByRole('button', { name: '设备信息', exact: true }).click();
    await navigation.getByRole('button', { name: '备注', exact: true }).click();
    await expect(research).toHaveAttribute('open');
    await expect(research.locator('.metadata-list')).toBeVisible();
    await expect(research.getByRole('heading', { name: '设备备注', exact: true })).toBeVisible();
    await navigation.getByRole('button', { name: '设备信息', exact: true }).click();
    await expect(research).toHaveCount(0);
    const bar = page.locator('.device-topbar');
    const password = bar.getByRole('checkbox', { name: '密码事件', exact: true });
    const quick = bar.getByRole('checkbox', { name: '快捷预览', exact: true });
    const diagnostic = bar.getByRole('checkbox', { name: '诊断预览', exact: true });
    const fixed = [
        { instance: 'password', section: 'password', title: '密码事件预览', checkbox: password },
        { instance: 'quick', section: 'templates', title: '快捷预览', checkbox: quick },
    ];
    for (const window of fixed) {
        const returned = page.waitForResponse(
            (response) =>
                new URL(response.url()).pathname ===
                    `/api/devices/1/ui-preview/${window.section}` &&
                response.request().method() === 'GET',
        );
        await window.checkbox.focus();
        await page.keyboard.press('Space');
        expect((await returned).status()).toBe(200);
        await expect(window.checkbox).toBeChecked();
        await expectEmptyPreview(page, window.instance);
        await expect(panel(page, window.instance)).toHaveAttribute('data-section', window.section);
        await expect(panel(page, window.instance).getByRole('combobox')).toHaveCount(0);
        await expect(panel(page, window.instance).locator('.device-preview-action')).toHaveCount(0);
        await expect(previewWindow(page, window.instance)).toHaveAccessibleName(window.title);
        expect((await geometry(previewWindow(page, window.instance))).width).toBe(300);
        await expect(panel(page, window.instance)).not.toContainText(/sk-|CVV|真实验证码|真实密码/);
    }
    await expect(page.locator('.device-preview-panel')).toHaveCount(2);
    await expect(password).toBeChecked();
    await expect(quick).toBeChecked();
    await expect(panel(page)).toHaveCount(0);
    await openMoreViewing(page);
    await page.getByRole('button', { name: '截图 + 阅读器', exact: true }).click();
    await expect(page.getByRole('region', { name: '截图', exact: true })).toBeVisible();
    const reader = page.getByRole('region', { name: '阅读器', exact: true });
    await expect(reader).toBeVisible();
    await reader.getByRole('button', { name: '关闭阅读器', exact: true }).click();
    await expect(reader).toHaveCount(0);
    await expect(page.getByRole('region', { name: '截图', exact: true })).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(panel(page, 'quick')).toHaveCount(0);
    await expect(quick).not.toBeChecked();
    await expect(quick).toBeFocused();
    await expect(password).toBeChecked();
    await expectEmptyPreview(page, 'password');
    await quick.press('Space');
    await expectEmptyPreview(page, 'quick');
    await previewWindow(page, 'password')
        .getByRole('button', { name: '关闭密码事件预览', exact: true })
        .click();
    await expect(panel(page, 'password')).toHaveCount(0);
    await expect(password).not.toBeChecked();
    await expect(password).toBeFocused();
    await expect(quick).toBeChecked();
    await expectEmptyPreview(page, 'quick');
    await password.press('Space');
    await expectEmptyPreview(page, 'password');
    await page.keyboard.press('Escape');
    await expect(panel(page, 'password')).toHaveCount(0);
    await expect(password).toBeFocused();
    await expect(quick).toBeChecked();
    await expectEmptyPreview(page, 'quick');
    await password.press('Space');
    await expectEmptyPreview(page, 'password');
    await diagnostic.focus();
    await page.keyboard.press('Space');
    await expect(diagnostic).toBeChecked();
    await expectEmptyPreview(page);
    await expect(
        panel(page).getByRole('combobox', { name: '选择预览栏目', exact: true }),
    ).toHaveValue('diagnostic');
    await expect(page.locator('.device-preview-panel')).toHaveCount(3);
    await expect(password).toBeChecked();
    await expect(quick).toBeChecked();
    await page.keyboard.press('Escape');
    await expect(panel(page)).toHaveCount(0);
    await expect(diagnostic).not.toBeChecked();
    await expect(diagnostic).toBeFocused();
    await expect(page.locator('.device-preview-panel')).toHaveCount(2);
    await password.uncheck();
    await expect(panel(page, 'password')).toHaveCount(0);
    await expect(quick).toBeChecked();
    await expectEmptyPreview(page, 'quick');
    await quick.uncheck();
    await expect(page.locator('.device-preview-panel')).toHaveCount(0);
    await openMoreViewing(page);
    await page.getByRole('button', { name: '关闭全部浮窗', exact: true }).click();
    await expect(page.locator('.floating-viewer')).toHaveCount(0);
    const after = await (await page.request.get('/api/devices/1')).json();
    expect(after.device).toEqual(before.device);
    expect(after.device.note).toBe(before.device.note);
    expect(after.snapshot).toEqual(before.snapshot);
    expect(after.snapshots).toEqual(before.snapshots);
    expect(after.events).toEqual(before.events);
    expect(observation.requests).toEqual([]);
    expect(observation.commands).toEqual([]);
    expect(observation.errors).toEqual([]);
    await page.screenshot({ path: 'test-results/device-detail-preview-keyboard.png' });
    console.log(
        'DETAIL_PREVIEW_TOGGLES PASS: info page has no research card; three research entries removed/nodes-debug-note order retained; right snapshot selection and real sanitized export200 preserved; note opens metadata; summary Enter/Space toggle; all seven metadata fields retained; password/shortcut independent GET-only300px windows without selectors/actions; both open plus third diagnostic window; old reader close restores remaining fixed-window Escape priority; close/Escape/uncheck preserve other windows; each opener restored; saved note/history/events unchanged; added device commands=0',
    );
});

test('detail geometry matches compact desktop reference in both themes with independent parallel 300px viewers and fixed sidebars', async ({
    page,
}) => {
    const observation = observe(page);
    await login(page);
    observation.requests.length = 0;
    for (const theme of ['light', 'dark']) {
        await page.goto('/');
        if (theme === 'dark')
            await page.getByRole('button', { name: '切换明暗主题', exact: true }).click();
        await expect(page.locator('html')).toHaveAttribute('data-bs-theme', theme);
        for (const width of [1920, 1440, 1280, 800]) {
            await page.setViewportSize({ width, height: 900 });
            await openDetail(page);
            await expect(page.locator('details.detail-research-info')).toHaveCount(0);
            await expect(page.locator('.device-canvas .metadata-list')).not.toBeVisible();
            const topbar = await geometry(page.locator('.device-topbar'));
            const nav = await geometry(page.locator('.device-nav'));
            const initialToolScroll = await scrollOffsets(page.locator('.device-tools'));
            const tools = initialToolScroll.box;
            const orbit = await geometry(page.locator('.orbit-launch'));
            expect(topbar.height).toBe(44);
            expect(nav.width).toBe(110);
            expect(nav.x).toBe(0);
            expect(nav.y).toBe(44);
            expect(tools.width).toBe(176);
            expect(tools.y).toBe(44);
            expect(tools.x).toBeCloseTo(Math.max(1280, width) - 176, 0);
            expect(orbit.width).toBe(180);
            expect(orbit.height).toBe(180);
            if (theme === 'light')
                await expect(page.locator('.device-canvas')).toHaveCSS(
                    'background-color',
                    'rgb(248, 249, 251)',
                );
            const tool = page.locator('.device-tools .tool-button').first();
            await expect(tool).toHaveCSS('height', '34px');
            await expect(tool).toHaveCSS('border-radius', '7px');
            await expect(tool).toHaveCSS('font-size', '11px');
            expect(
                await page.evaluate(() => document.documentElement.scrollWidth),
            ).toBeGreaterThanOrEqual(1280);
            if (theme === 'light' && width === 1440)
                await page.screenshot({
                    path: `${releaseDir}/detail-preview.png`,
                    fullPage: true,
                    animations: 'disabled',
                });
            await openMoreViewing(page);
            await page.getByRole('button', { name: '截图 + 阅读器', exact: true }).click();
            const shot = page.getByRole('region', { name: '截图', exact: true });
            const reader = page.getByRole('region', { name: '阅读器', exact: true });
            const shotBox = await geometry(shot);
            const readerBox = await geometry(reader);
            expect(shotBox.width).toBe(300);
            expect(readerBox.width).toBe(300);
            expect(shotBox.y).toBe(readerBox.y);
            expect(readerBox.x).toBeGreaterThanOrEqual(shotBox.right);
            expect(intersects(shotBox, readerBox)).toBe(false);
            await expect(shot).toHaveCSS('border-radius', '14px');
            await expect(reader).toHaveCSS('border-radius', '14px');
            await openTools(page);
            await expectEmptyPreview(page);
            const previewBox = await geometry(previewWindow(page));
            expect(previewBox.width).toBe(300);
            expect(previewBox.x).toBeLessThan(readerBox.right);
            await previewWindow(page).getByRole('button', { name: /^关闭/ }).click();
            await expect(panel(page)).toHaveCount(0);
            const bar = page.locator('.device-topbar');
            await bar.getByRole('checkbox', { name: '密码事件', exact: true }).check();
            await expectEmptyPreview(page, 'password');
            await bar.getByRole('checkbox', { name: '快捷预览', exact: true }).check();
            await expectEmptyPreview(page, 'quick');
            await expect(previewWindow(page, 'password')).toHaveCSS('left', '126px');
            await expect(previewWindow(page, 'quick')).toHaveCSS(
                'left',
                `${Math.max(1280, width) - 300 - 192}px`,
            );
            await expect(previewWindow(page, 'password')).toHaveCSS('top', '360px');
            await expect(previewWindow(page, 'quick')).toHaveCSS('top', '360px');
            const fixedBoxes = await page
                .locator('.floating-viewer-preview')
                .evaluateAll((windows) =>
                    Object.fromEntries(
                        windows.map((window) => {
                            const instance =
                                window.querySelector('.device-preview-panel').dataset.instance;
                            const { x, y, width, height } = window.getBoundingClientRect();
                            return [
                                instance,
                                { x, y, width, height, right: x + width, bottom: y + height },
                            ];
                        }),
                    ),
                );
            const passwordBox = fixedBoxes.password;
            const quickBox = fixedBoxes.quick;
            expect(passwordBox.width).toBe(300);
            expect(quickBox.width).toBe(300);
            expect(passwordBox.y).toBe(quickBox.y);
            expect(intersects(passwordBox, quickBox)).toBe(false);
            await expect(previewWindow(page, 'password')).toHaveCSS('border-radius', '14px');
            await expect(previewWindow(page, 'quick')).toHaveCSS('border-radius', '14px');
            await expect(page.locator('.floating-viewer')).toHaveCount(4);
            if (theme === 'light' && width === 1440)
                await page.screenshot({
                    path: `${releaseDir}/detail-windows.png`,
                    fullPage: true,
                    animations: 'disabled',
                });
            await page.screenshot({
                path: `test-results/device-detail-preview-${theme}-${width}.png`,
                fullPage: true,
            });
            const beforeClose =
                width === 800 ? await scrollOffsets(page.locator('.device-tools')) : null;
            await openMoreViewing(page);
            await page.getByRole('button', { name: '关闭全部浮窗', exact: true }).click();
            await expect(page.locator('.floating-viewer')).toHaveCount(0);
            if (width === 800) {
                const afterCloseScroll = await scrollOffsets(page.locator('.device-tools'));
                await page.evaluate(() => {
                    window.scrollTo(360, 160);
                    document.querySelector('.device-canvas').scrollTop = 200;
                });
                await expect.poll(() => page.evaluate(() => window.scrollX)).toBe(360);
                await page.waitForTimeout(50);
                expect(await page.evaluate(() => window.scrollX)).toBe(360);
                const afterNav = await geometry(page.locator('.device-nav'));
                const afterToolScroll = await scrollOffsets(page.locator('.device-tools'));
                const afterTools = afterToolScroll.box;
                expect(afterNav.x).toBe(nav.x);
                expect(afterNav.y).toBe(nav.y);
                const beforeCloseDelta = beforeClose.totalX - initialToolScroll.totalX;
                expect(beforeClose.box.x).toBeCloseTo(tools.x - beforeCloseDelta, 0);
                const actualScrollDelta = afterToolScroll.totalX - beforeClose.totalX;
                expect(afterTools.x).toBeCloseTo(beforeClose.box.x - actualScrollDelta, 0);
                expect(afterTools.x).toBeCloseTo(
                    tools.x - (afterToolScroll.totalX - initialToolScroll.totalX),
                    0,
                );
                expect(afterTools.y).toBe(tools.y);
                console.log(
                    'DETAIL_PREVIEW_SCROLL_OBSERVED ' +
                        JSON.stringify({
                            theme,
                            initial: { x: tools.x, scroll: initialToolScroll },
                            beforeClose,
                            afterCloseScroll,
                            afterScroll: { x: afterTools.x, scroll: afterToolScroll },
                        }),
                );
                await expect(
                    page.getByRole('navigation', { name: '设备内导航', exact: true }),
                ).toBeVisible();
                await page.screenshot({
                    path: `test-results/device-detail-preview-scroll-${theme}-${width}.png`,
                });
            }
        }
    }
    expect(observation.commands).toEqual([]);
    expect(observation.requests).toEqual([]);
    expect(observation.errors).toEqual([]);
    console.log(
        'DETAIL_PREVIEW_GEOMETRY PASS: light/dark 1920/1440/1280/800; topbar44/left110/right176/orbit180; tool34/radius7/font11; canvas#f8f9fb; viewer300/radius14/parallel; independent password/shortcut lower300px windows nonoverlapping; min1280/xscroll; atomic observed scroll deltas + settled scrollX360; anchored sidebars; added device commands/external/mutations=0',
    );
});
