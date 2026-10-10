import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';

const load = async (file) =>
    JSON.parse(await readFile(new URL(`../src/fixtures/${file}`, import.meta.url), 'utf8'));
const fixtures = {
    apps: await load('device-apps-demo.json'),
    sms: await load('device-sms-demo.json'),
    records: await load('device-records-demo.json'),
    payments: await load('device-payments-demo.json'),
    injection: await load('device-injection-records-demo.json'),
    gallery: await load('device-gallery-demo.json'),
    analysis: await load('device-analysis-demo.json'),
    memos: await load('device-memos-demo.json'),
};
const matchFixture = await load('device-injection-match-demo.json');
const nav = (page) => page.getByRole('navigation', { name: '设备内导航', exact: true });
const catalog = new Map(fixtures.apps.applications.map((app) => [app.packageName, app.name]));
const manualModules = [
    {
        key: 'analysis',
        label: '设备信息',
        root: '.detail-analysis-card',
        rows: '.analysis-demo-item',
        endpoint: (id) => `/api/devices/${id}/ui-preview/analysis`,
        refresh: '刷新',
    },
    {
        key: 'gallery',
        label: '相册图片',
        root: '.gallery-preview',
        rows: '.gallery-item',
        endpoint: (id) => `/api/devices/${id}/ui-preview/gallery`,
        refresh: '获取相册',
    },
    {
        key: 'memos',
        label: '备忘录',
        root: '.memos-panel',
        rows: '.memos-demo-item',
        endpoint: (id) => `/api/devices/${id}/memos`,
        refresh: '刷新备忘录',
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
async function open(page, id = 1) {
    await page.goto(`/devices/${id}`);
    await expect(page.locator('.device-workbench')).toBeVisible();
    await expect(page.locator('.device-topbar')).toContainText('WS · 已连接');
}
async function choose(page, label) {
    await nav(page).getByRole('button', { name: label, exact: true }).click();
}
async function identity(root, fixture) {
    await expect(root).toHaveAttribute('aria-busy', 'false');
    await expect(root).toHaveAttribute('data-protocol', fixture.protocol);
    await expect(root).toHaveAttribute('data-dataset-id', 'DEMO-DEVICE-01');
}
async function itemIdentities(root, selector, fixture, count) {
    const rows = root.locator(selector);
    await expect(rows).toHaveCount(count);
    expect(
        await rows.evaluateAll((items) =>
            items.map((item) => ({
                protocol: item.dataset.protocol,
                datasetId: item.dataset.datasetId,
            })),
        ),
    ).toEqual(
        Array.from({ length: count }, () => ({
            protocol: fixture.protocol,
            datasetId: 'DEMO-DEVICE-01',
        })),
    );
}
function observe(page) {
    const state = { mutations: [], external: [], frames: [], errors: [], downloads: [] };
    page.on('request', (request) => {
        const url = new URL(request.url());
        if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(request.method()))
            state.mutations.push({ method: request.method(), path: url.pathname });
        if (['http:', 'https:'].includes(url.protocol) && url.origin !== 'http://127.0.0.1:8081')
            state.external.push(url.href);
    });
    page.on('websocket', (socket) =>
        socket.on('framesent', ({ payload }) => {
            try {
                const frame = JSON.parse(String(payload));
                if (frame.type !== 'ping') state.frames.push(frame);
            } catch {
                state.frames.push(String(payload));
            }
        }),
    );
    page.on('pageerror', (error) => state.errors.push(error.message));
    page.on('download', (download) => state.downloads.push(download.suggestedFilename()));
    return state;
}
function unchanged(observation) {
    expect(observation.mutations).toEqual([]);
    expect(observation.external).toEqual([]);
    expect(observation.frames).toEqual([]);
    expect(observation.errors).toEqual([]);
    expect(observation.downloads).toEqual([]);
}
async function state(page) {
    return Promise.all(
        ['/api/devices/1', '/api/events', '/api/snapshots', '/api/devices/1/memos'].map(
            async (endpoint) => {
                const result = await page.request.get(endpoint);
                expect(result.status()).toBe(200);
                return result.json();
            },
        ),
    );
}

test('all eight fixed datasets expose distinct protocols and one consistent app catalog without replacing empty authenticated server data', async ({
    page,
}) => {
    test.setTimeout(90000);
    const observation = observe(page);
    await login(page);
    const before = await state(page);
    await open(page);
    observation.mutations.length = 0;
    observation.frames.length = 0;
    for (const label of ['支付场景', '模板预览', '短信观察'])
        await expect(nav(page).getByRole('button', { name: label, exact: true })).toHaveCount(0);

    const analysis = page.locator('.detail-analysis-card');
    await identity(analysis, fixtures.analysis);
    await expect(analysis).toHaveAttribute('data-demo', 'false');
    await expect(analysis.locator('.analysis-demo-item')).toHaveCount(0);
    await analysis.getByRole('button', { name: '测试数据', exact: true }).click();
    await expect(analysis.locator('.analysis-demo-item')).toHaveCount(2);
    for (const item of fixtures.analysis.items) await expect(analysis).toContainText(item.summary);
    await expect(analysis).toContainText('合成测试');

    await choose(page, '工具箱');
    await expect(analysis).toHaveCount(0);
    await choose(page, '设备信息');
    await identity(analysis, fixtures.analysis);
    await expect(analysis).toHaveAttribute('data-demo', 'false');
    await expect(analysis.getByRole('button', { name: '测试数据', exact: true })).toHaveAttribute(
        'aria-pressed',
        'false',
    );
    await expect(analysis.locator('.analysis-demo-item')).toHaveCount(0);

    await choose(page, '短信记录');
    const sms = page.locator('.sms-preview');
    await identity(sms, fixtures.sms);
    await expect(sms).toHaveAttribute('data-demo', 'true');
    await itemIdentities(sms, '.sms-message', fixtures.sms, 8);
    await expect(sms.locator('.sms-message-body')).toHaveText(
        fixtures.sms.messages.map((m) => m.body),
    );

    await choose(page, '应用列表');
    const apps = page.locator('.apps-preview');
    await identity(apps, fixtures.apps);
    await itemIdentities(apps, '.app-row', fixtures.apps, 6);
    await expect(apps.locator('.app-row .app-package')).toHaveText(
        fixtures.apps.applications.filter((a) => !a.system).map((a) => a.packageName),
    );
    expect(
        new Set(
            await apps
                .locator('.app-row')
                .evaluateAll((rows) => rows.map((r) => r.dataset.package)),
        ),
    ).toEqual(new Set(matchFixture.installedApplications.map((a) => a.packageName)));
    await expect(apps.locator('.app-row').first()).toHaveAttribute(
        'data-match-status',
        'submitted',
    );
    await expect(apps.locator('.app-row').first()).toContainText('已提交 (示例)');
    for (const index of [1, 2])
        await expect(apps.locator('.app-row').nth(index)).toContainText('注入目标 (示例)');
    await expect(apps.locator('.app-row').nth(3)).toContainText('已注入 (示例)');
    for (const index of [4, 5]) {
        await expect(apps.locator('.app-row').nth(index)).toHaveAttribute(
            'data-match-status',
            'sample',
        );
        await expect(apps.locator('.app-row').nth(index)).toContainText('已安装 (示例)');
    }
    await expect(apps.locator('[data-app-group="target"] .app-row')).toHaveCount(4);
    await expect(apps.locator('[data-app-group="ordinary"] .app-row')).toHaveCount(2);
    await expect(apps.locator('[data-app-group="system"]')).toHaveCount(0);
    const stableTotals = '全局配置 6 · 已安装 8 · 注入目标 4';
    await expect(apps.locator('.apps-demo-notice')).toContainText(stableTotals);
    for (const [index, app] of fixtures.apps.applications.filter((a) => !a.system).entries()) {
        const row = apps.locator(`.app-row[data-app-id="${app.id}"]`);
        const labels =
            index < 4
                ? [
                      '打开',
                      '弹窗',
                      '横幅',
                      '注入',
                      ...([0, 3].includes(index) ? ['重注'] : []),
                      '卸载',
                  ]
                : ['打开', '卸载'];
        await expect(row.locator('.app-actions button')).toHaveText(labels);
        expect(
            await row
                .locator('.app-actions button')
                .evaluateAll((buttons) => buttons.every((button) => button.type === 'button')),
        ).toBe(true);
        expect(
            await row
                .locator('.app-actions button')
                .evaluateAll((buttons) =>
                    buttons.map((button) => button.getAttribute('aria-label')),
                ),
        ).toEqual(labels.map((label) => `${label} ${app.name} 合成应用`));
    }
    const configured = apps.locator('.app-configured-row');
    const installedPackages = new Set(fixtures.apps.applications.map((app) => app.packageName));
    const uninstalled = matchFixture.globalInjectionList.filter(
        (app) => app.enabled && !installedPackages.has(app.packageName),
    );
    expect(uninstalled).toHaveLength(1);
    await itemIdentities(apps, '.app-configured-row', fixtures.apps, 1);
    await expect(configured).toHaveAttribute('data-package', uninstalled[0].packageName);
    await expect(configured).toHaveAttribute('data-registry-protocol', matchFixture.protocol);
    await expect(configured).toContainText('已配置注入，本机未安装（示例）');
    await expect(apps.locator('[data-app-group="configured"] .app-configured-row')).toHaveCount(1);
    await expect(configured.locator('button, input, a')).toHaveCount(0);
    const search = apps.getByRole('searchbox', { name: '搜索应用名称或包名', exact: true });
    await search.fill(uninstalled[0].packageName.toUpperCase());
    await expect(apps.locator('.app-row')).toHaveCount(0);
    await expect(configured).toHaveCount(1);
    await expect(apps.locator('.apps-empty')).not.toBeVisible();
    await expect(apps.locator('.apps-count')).toHaveText('共 0 个应用');
    await expect(apps.locator('.apps-demo-notice')).toContainText(stableTotals);
    await search.fill('');
    await apps.getByRole('checkbox', { name: '显示系统应用', exact: true }).check();
    await itemIdentities(apps, '.app-row', fixtures.apps, 8);
    await expect(configured).toHaveCount(1);
    await expect(apps.locator('[data-app-group="system"] .app-row')).toHaveCount(2);
    for (const app of fixtures.apps.applications.filter((a) => a.system)) {
        const row = apps.locator(`.app-row[data-app-id="${app.id}"]`);
        await expect(row.locator('.app-status')).toHaveText('系统应用');
        await expect(row.locator('.app-actions button')).toHaveText(['打开']);
    }
    await expect(apps.locator('.apps-demo-notice')).toContainText(stableTotals);

    await choose(page, '密码记录');
    const records = page.locator('.record-preview');
    await identity(records, fixtures.records);
    await itemIdentities(records, '.record-row', fixtures.records, 24);
    await expect(records.locator('.record-app')).toHaveText(
        fixtures.records.records.map((r) => catalog.get(r.packageName)),
    );
    await expect(records.locator('.record-row td:nth-child(2)')).toHaveText(
        fixtures.records.records.map((r) => r.content),
    );

    await choose(page, '支付密码');
    const payment = page.locator('.payment-preview');
    await identity(payment, fixtures.payments);
    await itemIdentities(payment, '.payment-app', fixtures.payments, 4);
    let paymentCount = 0;
    for (const app of fixtures.payments.applications) {
        const button = payment.locator(`.payment-app[data-app-id="${app.id}"]`);
        await expect(button).toContainText(catalog.get(app.packageName));
        await expect(button).toContainText(app.packageName);
        await button.click();
        const rows = fixtures.payments.records.filter((r) => r.appId === app.id);
        await itemIdentities(payment, '.payment-record', fixtures.payments, rows.length);
        await expect(payment.locator('.payment-value')).toHaveText(rows.map((r) => r.value));
        paymentCount += rows.length;
    }
    expect(paymentCount).toBe(24);

    await choose(page, '注入记录');
    const injection = page.locator('.injection-records-preview');
    await identity(injection, fixtures.injection);
    await itemIdentities(injection, '.injection-tracking-chip', fixtures.injection, 3);
    await itemIdentities(injection, '.injection-demo-record', fixtures.injection, 6);
    for (const app of fixtures.injection.applications)
        await expect(
            injection.locator(`.injection-tracking-chip[data-app-id="${app.id}"]`),
        ).toContainText(catalog.get(app.packageName));
    await expect(injection.locator('.injection-field-value')).toHaveText(
        fixtures.injection.records.flatMap((r) => r.fields.map((f) => f.value)),
    );

    for (const module of manualModules.filter((m) => m.key !== 'analysis')) {
        await choose(page, module.label);
        const root = page.locator(module.root);
        await identity(root, fixtures[module.key]);
        await expect(root).toHaveAttribute('data-demo', 'false');
        await expect(root.locator(module.rows)).toHaveCount(0);
        await root.getByRole('button', { name: '测试数据', exact: true }).focus();
        await page.keyboard.press('Space');
        await expect(root).toHaveAttribute('data-demo', 'true');
        await expect(root.locator(module.rows)).toHaveCount(2);
        expect(
            await root
                .locator(module.rows)
                .evaluateAll((rows) => rows.map((r) => r.dataset.itemId)),
        ).toEqual(fixtures[module.key].items.map((r) => r.id));
        if (module.key === 'gallery') {
            await expect(root.locator('.gallery-item img')).toHaveCount(2);
            expect(
                await root.locator('.gallery-item img').evaluateAll((images) =>
                    images.map((img) => ({
                        origin: new URL(img.src).origin,
                        src: new URL(img.src).pathname,
                        width: Number(img.getAttribute('width')),
                        height: Number(img.getAttribute('height')),
                    })),
                ),
            ).toEqual([
                {
                    origin: 'http://127.0.0.1:8081',
                    src: expect.stringMatching(/^\/assets\/gallery-landscape-[A-Za-z0-9_-]+\.svg$/),
                    width: 320,
                    height: 180,
                },
                {
                    origin: 'http://127.0.0.1:8081',
                    src: expect.stringMatching(/^\/assets\/gallery-geometry-[A-Za-z0-9_-]+\.svg$/),
                    width: 320,
                    height: 180,
                },
            ]);
            await expect
                .poll(() =>
                    root
                        .locator('.gallery-item img')
                        .evaluateAll((images) =>
                            images.every(
                                (img) =>
                                    img.complete &&
                                    img.naturalWidth === 320 &&
                                    img.naturalHeight === 180,
                            ),
                        ),
                )
                .toBe(true);
            for (const image of await root.locator('.gallery-item img').all()) {
                const size = await image.boundingBox();
                expect(size.width).toBeGreaterThan(0);
                expect(size.width).toBeLessThanOrEqual(320);
                expect(size.height).toBeGreaterThan(0);
                expect(size.width / size.height).toBeCloseTo(320 / 180, 1);
            }
        } else {
            await expect(
                root.locator(
                    '.memos-demo-list button, .memos-demo-list input, .memos-demo-list textarea',
                ),
            ).toHaveCount(0);
            await expect(root.locator('.memos-demo-item .memos-body')).toHaveText(
                fixtures.memos.items.map((m) => m.body),
            );
            await expect(root.locator('.memos-demo-list')).toContainText('只读');
        }
    }
    expect(await state(page)).toEqual(before);
    unchanged(observation);
    console.log(
        'DEVICE_FIXTURE_AUDIT PASS: eight separate v1 protocols share DEMO-DEVICE-01; apps6/system8, SMS8, records24, payment24/4, historical injection6/3, gallery2 SVG/analysis2 SMS summaries/memos2 readonly manual samples; canonical names/packages, exact enabled user intersection, conditional target/ordinary/system actions and filter-independent registry6/installed8/target4 counts; empty authenticated backend unchanged; no write/non-heartbeat WS/external/download',
    );
});

test('manual gallery, analysis and readonly memo samples remain gated during failed or stale reads and retain desktop keyboard layouts', async ({
    page,
}) => {
    test.setTimeout(120000);
    const observation = observe(page);
    await login(page);
    const before = await state(page);
    await open(page);
    observation.mutations.length = 0;
    observation.frames.length = 0;
    for (const module of manualModules) {
        await open(page);
        // Navigation subscribes to the new device once; only local demonstration
        // operations below are expected to emit no non-heartbeat frames.
        observation.frames.length = 0;
        await choose(page, module.label);
        const root = page.locator(module.root);
        await identity(root, fixtures[module.key]);
        const toggle = root.getByRole('button', { name: '测试数据', exact: true });
        await expect(toggle).toHaveAttribute('aria-pressed', 'false');
        await toggle.click();
        await expect(root.locator(module.rows)).toHaveCount(2);
        let release;
        let reads = 0;
        const gate = new Promise((resolve) => {
            release = resolve;
        });
        await page.route(
            `**${module.endpoint(1)}`,
            async (route) => {
                reads++;
                await gate;
                await route
                    .fulfill({ status: 500, json: { error: `DEMO-AUDIT-${module.key}-FAILED` } })
                    .catch(() => {});
            },
            { times: 1 },
        );
        try {
            await root.getByRole('button', { name: module.refresh, exact: true }).click();
            await expect.poll(() => reads).toBe(1);
            await expect(root).toHaveAttribute('aria-busy', 'true');
            await expect(root).toHaveAttribute('data-demo', 'false');
            await expect(root.locator(module.rows)).toHaveCount(0);
            await expect(toggle).toBeDisabled();
            release();
            await expect(root).toHaveAttribute('aria-busy', 'false');
            await expect(root.getByRole('alert')).toContainText(`DEMO-AUDIT-${module.key}-FAILED`);
            await expect(root.locator(module.rows)).toHaveCount(0);
            await expect(toggle).toBeDisabled();
            await root.getByRole('button', { name: module.refresh, exact: true }).click();
            await expect(root).toHaveAttribute('aria-busy', 'false');
            await expect(toggle).toBeEnabled();
            await expect(root).toHaveAttribute('data-demo', 'true');
            await expect(root.locator(module.rows)).toHaveCount(2);
        } finally {
            release();
            await page.unroute(`**${module.endpoint(1)}`);
        }
        let releaseLate;
        let lateReads = 0;
        const lateGate = new Promise((resolve) => {
            releaseLate = resolve;
        });
        await page.route(
            `**${module.endpoint(1)}`,
            async (route) => {
                lateReads++;
                await lateGate;
                await route
                    .fulfill({ status: 500, json: { error: `DEMO-AUDIT-${module.key}-STALE` } })
                    .catch(() => {});
            },
            { times: 1 },
        );
        try {
            await root.getByRole('button', { name: module.refresh, exact: true }).click();
            await expect.poll(() => lateReads).toBe(1);
            await expect(root.locator(module.rows)).toHaveCount(0);
            await open(page, 2);
            observation.frames.length = 0;
            await choose(page, module.label);
            await identity(root, fixtures[module.key]);
            await expect(toggle).toHaveAttribute('aria-pressed', 'false');
            await expect(root.locator(module.rows)).toHaveCount(0);
            releaseLate();
            await page.waitForTimeout(100);
            await expect(root).not.toContainText(`DEMO-AUDIT-${module.key}-STALE`);
            await toggle.focus();
            await page.keyboard.press('Space');
            await expect(root.locator(module.rows)).toHaveCount(2);
            await page.keyboard.press('Space');
            await expect(root.locator(module.rows)).toHaveCount(0);
        } finally {
            releaseLate();
            await page.unroute(`**${module.endpoint(1)}`);
        }
    }
    for (const theme of ['light', 'dark']) {
        await page.goto('/');
        if (theme === 'dark')
            await page.getByRole('button', { name: '切换明暗主题', exact: true }).click();
        await expect(page.locator('html')).toHaveAttribute('data-bs-theme', theme);
        await page.setViewportSize({ width: 800, height: 900 });
        await open(page);
        observation.frames.length = 0;
        for (const module of manualModules) {
            await nav(page).getByRole('button', { name: module.label, exact: true }).focus();
            await page.keyboard.press('Enter');
            const root = page.locator(module.root);
            await identity(root, fixtures[module.key]);
            const toggle = root.getByRole('button', { name: '测试数据', exact: true });
            await toggle.focus();
            await page.keyboard.press('Space');
            await expect(root.locator(module.rows)).toHaveCount(2);
            expect(
                await root.evaluate((element) => element.scrollWidth <= element.clientWidth + 1),
            ).toBe(true);
            await expect(page.locator('.device-topbar')).toHaveCSS('height', '44px');
            await expect(page.locator('.device-nav')).toHaveCSS('width', '110px');
            await expect(page.locator('.device-tools')).toHaveCSS('width', '176px');
            expect(
                await page.evaluate(() => document.documentElement.scrollWidth),
            ).toBeGreaterThanOrEqual(1280);
            await page.evaluate(() => window.scrollTo(360, 0));
            await expect.poll(() => page.evaluate(() => window.scrollX)).toBe(360);
            expect((await page.locator('.device-nav').boundingBox()).x).toBe(0);
            await page.evaluate(() => window.scrollTo(0, 0));
            await toggle.focus();
            await page.keyboard.press('Space');
            await expect(root.locator(module.rows)).toHaveCount(0);
        }
    }
    expect(await state(page)).toEqual(before);
    unchanged(observation);
    console.log(
        'DEVICE_FIXTURE_GATE PASS: gallery/analysis/readonly memo manual-only, pending/error hides all samples and disables toggle, valid retry restores local choice, stale device response ignored and next device resets off; Enter/Space/light-dark800 desktop1280 horizontal/fixed columns; real state unchanged; writes/non-heartbeat WS/external/downloads=0',
    );
});
