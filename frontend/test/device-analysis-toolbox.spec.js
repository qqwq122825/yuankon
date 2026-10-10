import { test, expect } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';

const artifactDir = process.env.DEVICE_ANALYSIS_ARTIFACT_DIR || 'test-results';
const actions = [
    'screen-preview',
    'camera-preview',
    'apps-preview',
    'gallery-preview',
    'permissions-preview',
    'diagnostic-preview',
    'refresh-preview',
    'export-preview',
    'analyze-sample',
];
const navigation = (page) => page.getByRole('navigation', { name: '设备内导航', exact: true });
const analysis = (page) => page.locator('.detail-analysis-card');
const toolbox = (page) => page.locator('.toolbox-preview');
const fixedPanel = (page, instance) =>
    page.locator(`.device-preview-panel[data-instance="${instance}"]`);
const fixedWindow = (page, instance) =>
    page.locator('.floating-viewer-preview').filter({ has: fixedPanel(page, instance) });

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

async function expectAnalysisEmpty(page) {
    await expect(analysis(page)).toHaveAccessibleName('AI 金融分析');
    await expect(analysis(page)).toHaveAttribute('aria-busy', 'false');
    await expect(analysis(page)).toHaveAttribute('data-state', 'not_connected');
    await expect(analysis(page)).toContainText('无短信缓存');
    await expect(analysis(page)).toContainText('短信数据与 AI 服务尚未接入。');
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
    const mutations = [];
    const external = [];
    const commands = [];
    const errors = [];
    const downloads = [];
    page.on('request', (request) => {
        const url = new URL(request.url());
        if (['http:', 'https:'].includes(url.protocol) && url.origin !== 'http://127.0.0.1:8081')
            external.push(url.href);
        if (['POST', 'PATCH', 'PUT', 'DELETE'].includes(request.method())) {
            let body;
            try {
                body = request.postDataJSON();
            } catch {
                body = request.postData();
            }
            mutations.push({ method: request.method(), path: url.pathname, body });
        }
    });
    page.on('websocket', (socket) => {
        socket.on('framesent', ({ payload }) => {
            try {
                const message = JSON.parse(String(payload));
                if (message.type === 'command') commands.push(message);
            } catch {
                // Subscription/heartbeat traffic does not count as device execution.
            }
        });
    });
    page.on('pageerror', (error) => errors.push(error.message));
    page.on('download', (download) => downloads.push(download.suggestedFilename()));
    return { mutations, external, commands, errors, downloads };
}

function expectNoExecution(observation, expectedActions = [], deviceId = 1) {
    expect(observation.mutations).toEqual(
        expectedActions.map((action) => ({
            method: 'POST',
            path: `/api/devices/${deviceId}/ui-preview/actions`,
            body: { action },
        })),
    );
    expect(observation.external).toEqual([]);
    expect(observation.commands).toEqual([]);
    expect(observation.errors).toEqual([]);
    expect(observation.downloads).toEqual([]);
}

async function expectPreviewPost(page, button, action, deviceId = 1) {
    const returned = page.waitForResponse(
        (response) =>
            new URL(response.url()).pathname === `/api/devices/${deviceId}/ui-preview/actions` &&
            response.request().method() === 'POST',
    );
    await button.click();
    const response = await returned;
    expect(response.status()).toBe(501);
    expect(response.request().postDataJSON()).toEqual({ action });
    expect(await response.json()).toMatchObject({
        mode: 'preview',
        implemented: false,
        code: 'NOT_IMPLEMENTED',
        dispatched: false,
        action,
    });
    await expect(button).toBeEnabled();
}

async function screenshot(page, filename) {
    await mkdir(artifactDir, { recursive: true });
    await page.screenshot({ path: path.join(artifactDir, filename), animations: 'disabled' });
}

test('device information shows the empty AI card, preserves research metadata and only posts the fixed preview action', async ({
    page,
}) => {
    const observation = observe(page);
    await login(page);
    observation.mutations.length = 0;
    const before = await businessState(page);
    await openDetail(page);
    await expectAnalysisEmpty(page);
    await expect(analysis(page).getByText('AI 金融分析', { exact: true })).toBeVisible();
    await expect(page.locator('.detail-research-info')).toHaveCount(0);
    await expect(page.locator('.toolbox-preview')).toHaveCount(0);
    await expect(page.locator('.device-canvas .card')).toHaveCount(1);
    await expect(page.locator('.node-info-card')).toHaveCount(0);
    await screenshot(page, 'device-info-ai.png');
    await expectPreviewPost(
        page,
        analysis(page).getByRole('button', { name: '立即分析', exact: true }),
        'analyze-sample',
    );
    await expect(page.locator('.device-canvas')).toContainText('未下发设备指令');
    const refreshResponse = page.waitForResponse(
        (response) =>
            new URL(response.url()).pathname === '/api/devices/1/ui-preview/analysis' &&
            response.request().method() === 'GET',
    );
    await analysis(page).getByRole('button', { name: '刷新', exact: true }).click();
    const refreshed = await refreshResponse;
    expect(refreshed.status()).toBe(200);
    expect(await refreshed.json()).toMatchObject({
        deviceId: 1,
        section: { id: 'analysis' },
        state: 'not_connected',
        items: [],
        total: 0,
    });
    await expectAnalysisEmpty(page);
    await navigation(page).getByRole('button', { name: '备注', exact: true }).click();
    const research = page.locator('.detail-research-info');
    await expect(research).toBeVisible();
    await expect(research).toHaveAttribute('open');
    await expect(research.locator('.metadata-list')).toBeVisible();
    await expect(research.locator('.metadata-list dt')).toHaveCount(7);
    await expect(research.locator('.metadata-list dd').nth(1)).toHaveText(
        before.detail.device.public_id,
    );
    await expect(research.locator('.metadata-list dd').nth(6)).toContainText(
        before.detail.device.note,
    );
    await navigation(page).getByRole('button', { name: '备注', exact: true }).click();
    await expect(page.getByRole('textbox', { name: '设备备注', exact: true })).toHaveValue(
        before.detail.device.note,
    );
    await navigation(page).getByRole('button', { name: '设备信息', exact: true }).click();
    await expect(page.locator('.detail-research-info')).toHaveCount(0);
    await expectAnalysisEmpty(page);
    for (const [instance, name] of [
        ['password', '密码事件'],
        ['quick', '快捷预览'],
    ]) {
        await page.locator('.device-topbar').getByRole('checkbox', { name, exact: true }).check();
        await expect(fixedPanel(page, instance)).toHaveAttribute('aria-busy', 'false');
        await fixedWindow(page, instance)
            .getByRole('button', { name: '测试数据', exact: true })
            .click();
        await expect(fixedPanel(page, instance)).toContainText('合成测试数据 · 非设备记录');
        await expect(
            fixedWindow(page, instance).getByRole('button', { name: /下载|导出/ }),
        ).toHaveCount(0);
        await expect(fixedWindow(page, instance).locator('a[download]')).toHaveCount(0);
    }
    expect(await businessState(page)).toEqual(before);
    expectNoExecution(observation, ['analyze-sample']);
    console.log(
        'DETAIL_ANALYSIS_INFO PASS: empty/not_connected AI card; exact analyze-sample POST501/no dispatch; refresh GET200; info has no research card; old metadata7/notes preserved; two local fixture windows have no download; devices/events/snapshots unchanged; external/WS commands=0',
    );
});

test('AI preview errors retry the real GET and late device responses do not replace the next device', async ({
    page,
}) => {
    const observation = observe(page);
    await login(page);
    observation.mutations.length = 0;
    const before = await businessState(page);
    await page.route(
        '**/api/devices/1/ui-preview/analysis',
        (route) => route.fulfill({ status: 500, json: { error: '合成 AI 状态读取失败' } }),
        { times: 1 },
    );
    await openDetail(page);
    await expect(analysis(page)).toHaveAttribute('data-state', 'error');
    await expect(analysis(page).getByRole('alert')).toContainText('合成 AI 状态读取失败');
    const retryResponse = page.waitForResponse(
        (response) =>
            new URL(response.url()).pathname === '/api/devices/1/ui-preview/analysis' &&
            response.request().method() === 'GET',
    );
    await analysis(page).getByRole('button', { name: '刷新', exact: true }).focus();
    await page.keyboard.press('Enter');
    expect((await retryResponse).status()).toBe(200);
    await expectAnalysisEmpty(page);
    await page.route(
        '**/api/devices/1/ui-preview/analysis',
        (route) =>
            route.fulfill({
                status: 200,
                json: {
                    mode: 'preview',
                    implemented: false,
                    deviceId: 1,
                    section: { id: 'analysis' },
                    state: 'not_connected',
                    items: [{ label: '异常样例记录' }],
                    total: 1,
                },
            }),
        { times: 1 },
    );
    await analysis(page).getByRole('button', { name: '刷新', exact: true }).click();
    await expect(analysis(page)).toHaveAttribute('data-state', 'error');
    await expect(analysis(page).getByRole('alert')).toContainText('分析预览状态不符合当前约定');
    await expect(
        analysis(page).getByRole('button', { name: '立即分析', exact: true }),
    ).toBeDisabled();
    await expect(analysis(page)).not.toContainText('异常样例记录');
    await analysis(page).getByRole('button', { name: '刷新', exact: true }).click();
    await expectAnalysisEmpty(page);
    let release;
    let started = 0;
    const gate = new Promise((resolve) => (release = resolve));
    await page.route('**/api/devices/1/ui-preview/analysis', async (route) => {
        started++;
        await gate;
        await route
            .fulfill({ status: 500, json: { error: '迟到的设备一 AI 响应' } })
            .catch(() => {});
    });
    try {
        await analysis(page).getByRole('button', { name: '刷新', exact: true }).click();
        await expect.poll(() => started).toBe(1);
        await expect(analysis(page)).toHaveAttribute('aria-busy', 'true');
        await page.locator('.device-back').click();
        await expect(page).toHaveURL('/');
        await expect(analysis(page)).toHaveCount(0);
        await openDetail(page, 2);
        await expectAnalysisEmpty(page);
        release();
        await page.waitForTimeout(100);
        await expect(page.locator('.device-topbar h1')).toContainText('测试设备 2');
        await expect(page.locator('.device-workbench')).not.toContainText('迟到的设备一 AI 响应');
        await expectAnalysisEmpty(page);
    } finally {
        release();
        await page.unroute('**/api/devices/1/ui-preview/analysis');
    }
    let releaseDetail;
    let detailStarted = 0;
    const detailGate = new Promise((resolve) => (releaseDetail = resolve));
    await page.route('**/api/devices/1', async (route) => {
        detailStarted++;
        const response = await route.fetch();
        await detailGate;
        await route.fulfill({ response }).catch(() => {});
    });
    try {
        // Exercise a same-component route parameter transition, not a page reload.
        await page.evaluate(() => {
            window.history.pushState(null, '', '/devices/1');
            window.dispatchEvent(new PopStateEvent('popstate', { state: null }));
        });
        await expect.poll(() => detailStarted).toBe(1);
        await expect(page).toHaveURL('/devices/1');
        await expect(page.locator('.device-workbench')).toHaveCount(0);
        await expect(analysis(page)).toHaveCount(0);
        await expect(page.getByRole('textbox', { name: '设备备注', exact: true })).toHaveCount(0);
        releaseDetail();
        await expect(page.locator('.device-workbench')).toBeVisible();
        await expectAnalysisEmpty(page);
        await expect(page.locator('.device-topbar h1')).toContainText('测试设备 1');
    } finally {
        releaseDetail();
        await page.unroute('**/api/devices/1');
    }
    expect(await businessState(page)).toEqual(before);
    expectNoExecution(observation);
    console.log(
        'DETAIL_ANALYSIS_RETRY PASS: GET500 and malformed-item alerts/keyboard real retry200; pending GET aborted on route exit; same-component route waits without stale actionable device; late device1 error absent on device2; devices/events/snapshots unchanged; mutations/external/WS commands=0',
    );
});

test('toolbox renders five groups and nine catalogue-filtered tools whose actions remain 501 without device execution', async ({
    page,
}) => {
    const observation = observe(page);
    await login(page);
    observation.mutations.length = 0;
    const before = await businessState(page);
    const catalogue = await (await page.request.get('/api/devices/1/ui-preview')).json();
    await openDetail(page);
    await navigation(page).getByRole('button', { name: '工具箱', exact: true }).click();
    await expect(toolbox(page)).toHaveAttribute('aria-busy', 'false');
    await expect(toolbox(page).getByRole('heading', { name: '工具箱', exact: true })).toBeVisible();
    await expect(toolbox(page).locator('[data-tool-group]')).toHaveCount(5);
    expect(
        await toolbox(page)
            .locator('[data-tool-group]')
            .evaluateAll((groups) => groups.map((group) => group.dataset.toolGroup)),
    ).toEqual(['view', 'apps', 'diagnostic', 'data', 'analysis']);
    await expect(toolbox(page).locator('[data-preview-action]')).toHaveCount(9);
    const available = await toolbox(page)
        .locator('[data-preview-action]')
        .evaluateAll((buttons) => buttons.map((button) => button.dataset.previewAction));
    expect(available).toEqual(actions);
    expect([...available].sort()).toEqual(catalogue.tools.map((tool) => tool.id).sort());
    await expect(page.locator('.floating-viewer-preview')).toHaveCount(0);
    await expect(
        page.locator('.inspection-orbit, .detail-analysis-card, .node-info-card'),
    ).toHaveCount(0);
    await screenshot(page, 'device-toolbox.png');
    for (const action of actions) {
        await expectPreviewPost(
            page,
            toolbox(page).locator(`[data-preview-action="${action}"]`),
            action,
        );
        await expect(toolbox(page).getByRole('alert')).toContainText('未下发设备指令');
    }
    await toolbox(page).getByRole('button', { name: '模块状态', exact: true }).click();
    const oldPanel = page.locator('.device-preview-panel[data-instance="general"]');
    await expect(oldPanel).toHaveAttribute('data-section', 'tools');
    await expect(oldPanel).toHaveAttribute('aria-busy', 'false');
    await expect(oldPanel.locator('.device-preview-count')).toHaveText(/共\s*0\s*项/);
    await expect(
        oldPanel.getByRole('combobox', { name: '选择预览栏目', exact: true }),
    ).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(oldPanel).toHaveCount(0);
    await expect(
        toolbox(page).getByRole('button', { name: '模块状态', exact: true }),
    ).toBeFocused();
    expect(await businessState(page)).toEqual(before);
    expectNoExecution(observation, actions);
    console.log(
        'DETAIL_TOOLBOX_ACTION PASS: main canvas5 groups/9 catalogue-filtered tiles; exact allowlisted POST501/dispatchedfalse; module-state opens original tools panel/empty GET; Escape restores focus; devices/events/snapshots unchanged; external/WS commands=0',
    );
});

test('empty toolbox catalogue stays empty and the dark narrow desktop retains horizontal scrolling and keyboard controls', async ({
    page,
}) => {
    const observation = observe(page);
    await login(page);
    observation.mutations.length = 0;
    const before = await businessState(page);
    const catalogue = await (await page.request.get('/api/devices/1/ui-preview')).json();
    await page.route(
        '**/api/devices/1/ui-preview',
        (route) => route.fulfill({ status: 200, json: { ...catalogue, tools: [] } }),
        { times: 1 },
    );
    await openDetail(page);
    await navigation(page).getByRole('button', { name: '工具箱', exact: true }).click();
    await expect(toolbox(page)).toHaveAttribute('aria-busy', 'false');
    await expect(toolbox(page)).toContainText('工具目录为空，暂无可预览工具。');
    await expect(toolbox(page).locator('[data-tool-group], [data-preview-action]')).toHaveCount(0);
    await page.goto('/');
    await page.getByRole('button', { name: '切换明暗主题', exact: true }).click();
    await expect(page.locator('html')).toHaveAttribute('data-bs-theme', 'dark');
    await page.setViewportSize({ width: 800, height: 760 });
    await openDetail(page);
    const entry = navigation(page).getByRole('button', { name: '工具箱', exact: true });
    await entry.focus();
    await page.keyboard.press('Enter');
    await expect(toolbox(page).locator('[data-tool-group]')).toHaveCount(5);
    await expect(toolbox(page).locator('[data-preview-action]')).toHaveCount(9);
    await expect(page.locator('.device-nav')).toHaveCSS('width', '110px');
    await expect(page.locator('.device-tools')).toHaveCSS('width', '176px');
    await expect(toolbox(page).locator('[data-preview-action]').first()).toHaveCSS(
        'width',
        '112px',
    );
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeGreaterThanOrEqual(
        1280,
    );
    const button = toolbox(page).locator('[data-preview-action="screen-preview"]');
    const actionResponse = page.waitForResponse(
        (response) =>
            new URL(response.url()).pathname === '/api/devices/1/ui-preview/actions' &&
            response.request().method() === 'POST',
    );
    await button.focus();
    await page.keyboard.press('Enter');
    const response = await actionResponse;
    expect(response.status()).toBe(501);
    expect(response.request().postDataJSON()).toEqual({ action: 'screen-preview' });
    expect(await response.json()).toMatchObject({ dispatched: false });
    await expect(toolbox(page).getByRole('alert')).toContainText('未下发设备指令');
    await expect(button).toBeEnabled();
    await page.evaluate(() => window.scrollTo(360, 0));
    await expect.poll(() => page.evaluate(() => window.scrollX)).toBe(360);
    const nav = await page.locator('.device-nav').boundingBox();
    expect(nav.x).toBe(0);
    expect(nav.y).toBe(44);
    expect(
        await toolbox(page).evaluate((element) => element.scrollWidth <= element.clientWidth + 1),
    ).toBe(true);
    await page.screenshot({
        path: 'test-results/device-toolbox-dark-800.png',
        animations: 'disabled',
    });
    expect(await businessState(page)).toEqual(before);
    expectNoExecution(observation, ['screen-preview']);
    console.log(
        'DETAIL_TOOLBOX_LAYOUT PASS: empty catalogue adds no tiles; dark800x760 retains minimum1280 canvas/fixed110 rail/176 tools/112 tile; settled horizontal scroll360; Enter invokes only preview501; devices/events/snapshots unchanged; external/WS commands=0',
    );
});
