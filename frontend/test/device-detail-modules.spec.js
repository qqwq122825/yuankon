import { test, expect } from '@playwright/test';
import { mkdir, readFile } from 'node:fs/promises';
import path from 'node:path';

const appsFixture = JSON.parse(
    await readFile(new URL('../src/fixtures/device-apps-demo.json', import.meta.url), 'utf8'),
);
const matchFixture = JSON.parse(
    await readFile(
        new URL('../src/fixtures/device-injection-match-demo.json', import.meta.url),
        'utf8',
    ),
);
const recordsFixture = JSON.parse(
    await readFile(new URL('../src/fixtures/device-records-demo.json', import.meta.url), 'utf8'),
);
const artifactDir = process.env.DEVICE_MODULE_ARTIFACT_DIR || 'test-results';
const headers = { 'X-Boundary-Request': '1' };
const navigation = (page) => page.getByRole('navigation', { name: '设备内导航', exact: true });
const apps = (page) => page.locator('.apps-preview');
const records = (page) => page.locator('.record-preview');
const memos = (page) => page.locator('.memos-panel');
const appSearch = (page) =>
    apps(page).getByRole('searchbox', { name: '搜索应用名称或包名', exact: true });
const systemFilter = (page) =>
    apps(page).getByRole('checkbox', { name: '显示系统应用', exact: true });
const recordKeyword = (page) =>
    records(page).getByRole('searchbox', { name: '记录关键词', exact: true });
const normalize = (value) => String(value).normalize('NFKC').toLowerCase();

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

async function expectAppsEmpty(page) {
    await expect(apps(page)).toHaveAccessibleName('应用列表');
    await expect(apps(page)).toHaveAttribute('aria-busy', 'false');
    await expect(apps(page)).toHaveAttribute('data-state', 'not_connected');
    await expect(apps(page)).toHaveAttribute('data-demo', 'false');
    await expect(apps(page).getByRole('button', { name: '测试数据', exact: true })).toHaveAttribute(
        'aria-pressed',
        'false',
    );
    await expect(apps(page).locator('.app-row')).toHaveCount(0);
    await expect(apps(page).locator('.app-configured-row')).toHaveCount(0);
    await expect(apps(page).locator('.apps-count')).toHaveText('共 0 个应用');
    await expect(appSearch(page)).toHaveValue('');
    await expect(systemFilter(page)).not.toBeChecked();
    await expect(apps(page)).toContainText('未接入');
}

async function expectAppsDefault(page) {
    await expect(apps(page)).toHaveAccessibleName('应用列表');
    await expect(apps(page)).toHaveAttribute('aria-busy', 'false');
    await expect(apps(page)).toHaveAttribute('data-state', 'not_connected');
    await expect(apps(page)).toHaveAttribute('data-demo', 'true');
    await expect(apps(page).getByRole('button', { name: '测试数据', exact: true })).toHaveAttribute(
        'aria-pressed',
        'true',
    );
    await expect(appSearch(page)).toHaveValue('');
    await expect(systemFilter(page)).not.toBeChecked();
    await expectAppRows(
        page,
        appsFixture.applications.filter((item) => !item.system),
    );
    await expect(apps(page).locator('.apps-demo-notice')).toContainText(
        '合成测试数据 · 非设备应用',
    );
    await expectStableAppTotals(page);
    await expect(apps(page).locator('[data-app-group="target"] .app-row')).toHaveCount(4);
    await expect(apps(page).locator('[data-app-group="ordinary"] .app-row')).toHaveCount(2);
    await expect(apps(page).locator('[data-app-group="system"]')).toHaveCount(0);
}

async function expectRecordsEmpty(page) {
    await expect(records(page)).toHaveAccessibleName('密码记录');
    await expect(records(page)).toHaveAttribute('aria-busy', 'false');
    await expect(records(page)).toHaveAttribute('data-state', 'not_connected');
    await expect(records(page)).toHaveAttribute('data-demo', 'false');
    await expect(
        records(page).getByRole('button', { name: '测试数据', exact: true }),
    ).toHaveAttribute('aria-pressed', 'false');
    await expect(records(page).locator('.record-table tbody .record-row')).toHaveCount(0);
    await expect(records(page).locator('.record-count')).toHaveText('共 0 条记录');
    await expect(records(page)).toContainText('暂无密码记录');
    await expect(
        records(page).getByRole('combobox', { name: '记录类型', exact: true }),
    ).toHaveValue('all');
    await expect(
        records(page).getByRole('combobox', { name: '记录应用', exact: true }),
    ).toHaveValue('all');
    await expect(recordKeyword(page)).toHaveValue('');
    await expect(records(page).locator('.record-filters .record-preview-status')).toHaveCount(1);
    await expect(records(page).locator(':scope > .record-preview-status')).toHaveCount(0);
    await expect(records(page).locator('.record-filters .record-preview-caption')).toContainText(
        '未接入',
    );
    await expect(records(page).locator('details.record-metadata')).not.toHaveAttribute('open');
    await expect(records(page).locator('.record-metadata-table')).not.toBeVisible();
}

async function expectRecordsDefault(page) {
    await expect(records(page)).toHaveAccessibleName('密码记录');
    await expect(records(page)).toHaveAttribute('aria-busy', 'false');
    await expect(records(page)).toHaveAttribute('data-state', 'not_connected');
    await expect(records(page)).toHaveAttribute('data-demo', 'true');
    await expect(
        records(page).getByRole('button', { name: '测试数据', exact: true }),
    ).toHaveAttribute('aria-pressed', 'true');
    await expect(records(page).locator('.record-demo-notice')).toContainText(
        '合成测试数据 · 非设备记录',
    );
    await expectRecordRows(page, recordsFixture.records);
    await expect(
        records(page).getByRole('combobox', { name: '记录类型', exact: true }),
    ).toHaveValue('all');
    await expect(
        records(page).getByRole('combobox', { name: '记录应用', exact: true }),
    ).toHaveValue('all');
    await expect(recordKeyword(page)).toHaveValue('');
    await expect(records(page).locator('details.record-metadata')).not.toHaveAttribute('open');
    await expect(records(page).locator('.record-metadata-table')).not.toBeVisible();
}

async function expectAppRows(page, expected) {
    await expect(apps(page).locator('.apps-count')).toHaveText(`共 ${expected.length} 个应用`);
    await expect(apps(page).locator('.app-row')).toHaveCount(expected.length);
    expect(
        await apps(page)
            .locator('.app-row')
            .evaluateAll((rows) =>
                rows.map((row) => ({
                    id: row.dataset.appId,
                    system: row.dataset.system,
                })),
            ),
    ).toEqual(expected.map((item) => ({ id: item.id, system: String(item.system) })));
    await expect(apps(page).locator('.app-row .app-package')).toHaveText(
        expected.map((item) => item.packageName),
    );
}

async function expectStableAppTotals(page) {
    await expect(apps(page).locator('.apps-demo-notice')).toContainText(
        '全局配置 6 · 已安装 8 · 注入目标 4',
    );
    await expect(apps(page).locator('.apps-demo-notice')).not.toContainText('匹配 6');
}

async function expectAppActions(page, application, labels) {
    const row = apps(page).locator(`.app-row[data-app-id="${application.id}"]`);
    await expect(row.locator('.app-actions button')).toHaveText(labels);
    for (const label of labels)
        await expect(
            row.getByRole('button', {
                name: `${label} ${application.name} 合成应用`,
                exact: true,
            }),
        ).toBeEnabled();
}

async function expectAppPresentation(page) {
    const groups = ['target', 'ordinary', 'system', 'configured'];
    expect(
        await apps(page)
            .locator('.apps-group')
            .evaluateAll((items) => items.map((item) => item.dataset.appGroup)),
    ).toEqual(groups);
    for (const [group, count] of [
        ['target', 4],
        ['ordinary', 2],
        ['system', 2],
    ])
        await expect(apps(page).locator(`[data-app-group="${group}"] .app-row`)).toHaveCount(count);
    await expect(
        apps(page).locator('[data-app-group="configured"] .app-configured-row'),
    ).toHaveCount(1);
    const statuses = [
        'submitted',
        'skipped',
        'skipped',
        'injected',
        'sample',
        'sample',
        'sample',
        'sample',
    ];
    const labels = [
        '已提交 (示例)',
        '注入目标 (示例)',
        '注入目标 (示例)',
        '已注入 (示例)',
        '已安装 (示例)',
        '已安装 (示例)',
        '系统应用',
        '系统应用',
    ];
    for (const [index, application] of appsFixture.applications.entries()) {
        const row = apps(page).locator(`.app-row[data-app-id="${application.id}"]`);
        await expect(row).toHaveAttribute('data-match-status', statuses[index]);
        await expect(row.locator('.app-status')).toHaveText(labels[index]);
        await expectAppActions(
            page,
            application,
            index < 4
                ? [
                      '打开',
                      '弹窗',
                      '横幅',
                      '注入',
                      ...([0, 3].includes(index) ? ['重注'] : []),
                      '卸载',
                  ]
                : application.system
                  ? ['打开']
                  : ['打开', '卸载'],
        );
    }
    await expect(
        apps(page).locator(
            '.app-configured-row button, .app-configured-row input, .app-configured-row a',
        ),
    ).toHaveCount(0);
    await expect(apps(page).getByRole('button', { name: /^预览 .* 合成应用$/ })).toHaveCount(0);
    await expect(apps(page).getByRole('button', { name: /^模板 .* 合成应用$/ })).toHaveCount(0);
    await expect(apps(page).getByRole('button', { name: /^重置 .* 合成应用$/ })).toHaveCount(0);
    await expectStableAppTotals(page);
}

async function expectRecordRows(page, expected) {
    await expect(records(page).locator('.record-count')).toHaveText(`共 ${expected.length} 条记录`);
    await expect(records(page).locator('.record-table tbody .record-row')).toHaveCount(
        expected.length,
    );
    expect(
        await records(page)
            .locator('.record-row')
            .evaluateAll((rows) =>
                rows.map((row) => ({
                    id: row.dataset.recordId,
                    synthetic: row.dataset.synthetic,
                })),
            ),
    ).toEqual(expected.map((item) => ({ id: item.id, synthetic: 'true' })));
    await expect(records(page).locator('.record-row td:nth-child(2)')).toHaveText(
        expected.map((item) => item.content),
    );
    await expect(records(page).locator('.record-row .record-type')).toHaveText(
        expected.map((item) => item.typeLabel),
    );
    await expect(records(page).locator('.record-row .record-app')).toHaveText(
        expected.map((item) => item.appName),
    );
    await expect(records(page).locator('.record-row .record-type-label')).toHaveText(
        expected.map((item) => item.typeLabel),
    );
    expect(
        await records(page)
            .locator('.record-type-label')
            .evaluateAll((labels) => labels.map((label) => label.dataset.type)),
    ).toEqual(expected.map((item) => item.type));
    expect(
        await records(page)
            .locator('.record-row')
            .evaluateAll((rows) =>
                rows.map((row) => ({
                    columns: row.cells.length,
                    packageName: row.querySelector('.record-app').title,
                    time: row.querySelector('time').dateTime,
                })),
            ),
    ).toEqual(
        expected.map((item) => ({
            columns: 4,
            packageName: item.packageName,
            time: item.occurredAt,
        })),
    );
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

function observe(page) {
    const requests = [];
    const mutations = [];
    const external = [];
    const commands = [];
    const errors = [];
    const downloads = [];
    page.on('request', (request) => {
        const url = new URL(request.url());
        const observed = { method: request.method(), path: url.pathname };
        requests.push(observed);
        if (['POST', 'PATCH', 'PUT', 'DELETE'].includes(request.method())) mutations.push(observed);
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

function expectNoExecution(observation, allowed = []) {
    expect(
        observation.mutations.filter((request) => !allowed.some((permit) => permit(request))),
    ).toEqual([]);
    expect(observation.external).toEqual([]);
    expect(observation.commands).toEqual([]);
    expect(observation.errors).toEqual([]);
    expect(observation.downloads).toEqual([]);
}

async function screenshot(page, filename) {
    await mkdir(artifactDir, { recursive: true });
    await page.screenshot({ path: path.join(artifactDir, filename), animations: 'disabled' });
}

test('application list derives target, ordinary and system action sets from verified synthetic data and keeps all actions local', async ({
    page,
}) => {
    const observation = observe(page);
    await login(page);
    observation.mutations.length = 0;
    const before = await businessState(page);
    const responseEvent = page.waitForResponse(
        (response) =>
            new URL(response.url()).pathname === '/api/devices/1/ui-preview/apps' &&
            response.request().method() === 'GET',
    );
    await openDetail(page);
    await choose(page, '应用列表');
    const response = await responseEvent;
    expect(response.status()).toBe(200);
    expect(await response.json()).toMatchObject({
        mode: 'preview',
        deviceId: 1,
        implemented: false,
        section: { id: 'apps' },
        state: 'not_connected',
        items: [],
        total: 0,
    });
    await expectAppsDefault(page);
    await expect(page.locator('.device-preview-panel[data-instance="general"]')).toHaveCount(0);
    const requestCount = observation.requests.length;
    await expect(apps(page)).toHaveAttribute('data-demo', 'true');
    await expect(apps(page).locator('.apps-demo-notice')).toContainText(
        '合成测试数据 · 非设备应用',
    );
    expect(appsFixture).toMatchObject({
        schemaVersion: 1,
        source: 'synthetic-ui-fixture',
        fixtureOnly: true,
    });
    expect(appsFixture.applications).toHaveLength(8);
    const ordinary = appsFixture.applications.filter((item) => !item.system);
    expect(ordinary).toHaveLength(6);
    await expectAppRows(page, ordinary);
    await systemFilter(page).check();
    await expectAppRows(page, appsFixture.applications);
    await expectAppPresentation(page);
    for (const query of [
        appsFixture.applications[0].name,
        appsFixture.applications[1].packageName.toUpperCase(),
        'ｄｅｖ．ｍｔｘ．ｄｅｍｏ',
    ]) {
        await appSearch(page).fill(query);
        const expected = appsFixture.applications.filter((item) =>
            [item.name, item.packageName].some((value) =>
                normalize(value).includes(normalize(query.trim())),
            ),
        );
        expect(expected.length).toBeGreaterThan(0);
        await expectAppRows(page, expected);
        await expectStableAppTotals(page);
    }
    await appSearch(page).fill('DEMO-NO-APP-9999');
    await expectAppRows(page, []);
    await expectStableAppTotals(page);
    const configuredSample = matchFixture.globalInjectionList.find(
        (item) =>
            item.enabled &&
            !appsFixture.applications.some((app) => app.packageName === item.packageName),
    );
    await appSearch(page).fill(configuredSample.packageName.toUpperCase());
    await expectAppRows(page, []);
    await expect(apps(page).locator('.app-configured-row')).toHaveCount(1);
    await expect(apps(page).locator('.app-configured-row')).toHaveAttribute(
        'data-package',
        configuredSample.packageName,
    );
    await expect(apps(page).locator('.apps-empty')).not.toBeVisible();
    await expectStableAppTotals(page);
    await appSearch(page).fill('');
    await systemFilter(page).uncheck();
    await expectAppRows(page, ordinary);
    const firstApp = apps(page).locator(`.app-row[data-app-id="${ordinary[0].id}"]`);
    const modes = ['打开', '弹窗', '横幅', '注入', '重注', '卸载'];
    await expect(firstApp.locator('.app-actions button')).toHaveText(modes);
    for (const [index, mode] of modes.entries()) {
        await firstApp
            .getByRole('button', { name: `${mode} ${ordinary[0].name} 合成应用`, exact: true })
            .focus();
        await page.keyboard.press(index % 2 === 0 ? 'Enter' : 'Space');
        await expect(apps(page).locator('.apps-preview-feedback')).toHaveText(
            `「${ordinary[0].name}」${mode}仅为本地合成预览；未打开、注入或卸载设备应用。`,
        );
        await expectAppRows(page, ordinary);
        await expectStableAppTotals(page);
        await expect(firstApp).toHaveAttribute('data-match-status', 'submitted');
        await expectAppActions(page, ordinary[0], modes);
    }
    for (const [application, label] of [
        [ordinary[3], '重注'],
        [ordinary[4], '卸载'],
    ]) {
        await apps(page)
            .getByRole('button', {
                name: `${label} ${application.name} 合成应用`,
                exact: true,
            })
            .click();
        await expect(apps(page).locator('.apps-preview-feedback')).toHaveText(
            `「${application.name}」${label}仅为本地合成预览；未打开、注入或卸载设备应用。`,
        );
        await expectAppRows(page, ordinary);
    }
    await systemFilter(page).check();
    const systemApplication = appsFixture.applications.find((item) => item.system);
    await apps(page)
        .getByRole('button', {
            name: `打开 ${systemApplication.name} 合成应用`,
            exact: true,
        })
        .click();
    await expect(apps(page).locator('.apps-preview-feedback')).toHaveText(
        `「${systemApplication.name}」打开仅为本地合成预览；未打开、注入或卸载设备应用。`,
    );
    await expectAppPresentation(page);
    expect(observation.requests).toHaveLength(requestCount);
    await apps(page).getByRole('button', { name: '测试数据', exact: true }).click();
    await expectAppsEmpty(page);
    expect(await businessState(page)).toEqual(before);
    expectNoExecution(observation);
    console.log(
        'DEVICE_MODULE_APPS PASS: real empty GET/not_connected gates default6/system8 synthetic apps; target4/ordinary2/system2/configured1; fixed registry6/installed8/target4 totals during normalized search/filtering; conditional open/popup/banner/inject/reinject/uninstall buttons, Enter/Space feedback and unchanged states; no general float/device mutations/WS commands/external/downloads',
    );
});

test('sample password record list defaults to 24 synthetic rows after verified empty GET and keeps metadata and local filters', async ({
    page,
}) => {
    const observation = observe(page);
    await login(page);
    observation.mutations.length = 0;
    const before = await businessState(page);
    const responseEvent = page.waitForResponse(
        (response) =>
            new URL(response.url()).pathname === '/api/devices/1/ui-preview/password' &&
            response.request().method() === 'GET',
    );
    await openDetail(page);
    await choose(page, '密码记录');
    const response = await responseEvent;
    expect(response.status()).toBe(200);
    expect(await response.json()).toMatchObject({
        mode: 'preview',
        deviceId: 1,
        implemented: false,
        section: { id: 'password' },
        state: 'not_connected',
        items: [],
        total: 0,
    });
    await expectRecordsDefault(page);
    await expect(records(page).locator('.record-table thead th')).toHaveText([
        '类型',
        '内容',
        '应用',
        '时间',
    ]);
    const metadata = records(page).locator('details.record-metadata');
    await expect(metadata).not.toHaveAttribute('open');
    await expect(metadata.locator('table')).not.toBeVisible();
    await metadata.locator(':scope > summary').focus();
    await page.keyboard.press('Enter');
    await expect(metadata).toHaveAttribute('open');
    await expect(metadata.locator('table')).toBeVisible();
    await expect(metadata.locator('thead th')).toHaveText([
        '场景',
        '通道',
        '测试编号',
        '是否返回文本',
        '合成值匹配',
    ]);
    const expectedMetadata = before.detail.snapshot.payload.observations.filter(
        (item) => item.scenario === 'password_field',
    );
    await expect(metadata.locator('tbody tr')).toHaveCount(expectedMetadata.length);
    for (const [index, item] of expectedMetadata.entries())
        await expect(metadata.locator('tbody tr').nth(index).locator('td')).toHaveText([
            item.scenario,
            item.channel,
            item.case_id,
            String(item.text_returned ?? '—'),
            item.synthetic_match,
        ]);
    await metadata.locator(':scope > summary').focus();
    await page.keyboard.press('Space');
    await expect(metadata).not.toHaveAttribute('open');
    await expect(metadata.locator('table')).not.toBeVisible();
    await expect(metadata.locator('tbody tr')).toHaveCount(expectedMetadata.length);
    await page.waitForLoadState('networkidle');
    const requestCount = observation.requests.length;
    await expect(records(page).locator('.record-demo-notice')).toContainText(
        '合成测试数据 · 非设备记录',
    );
    expect(recordsFixture).toMatchObject({
        schemaVersion: 1,
        source: 'synthetic-ui-fixture',
        fixtureOnly: true,
    });
    expect(recordsFixture.records).toHaveLength(24);
    await expectRecordRows(page, recordsFixture.records);
    const type = records(page).getByRole('combobox', { name: '记录类型', exact: true });
    const app = records(page).getByRole('combobox', { name: '记录应用', exact: true });
    await expect(type.locator('option')).toHaveText(['全部类型', 'APP', '键盘', 'PIN']);
    const expectedTypes = [
        'app',
        'app',
        'keyboard',
        'keyboard',
        'keyboard',
        'app',
        'app',
        'app',
        'app',
        'app',
        'app',
        'app',
        'app',
        'app',
        'app',
        'app',
        'keyboard',
        'pin',
        'app',
        'keyboard',
        'keyboard',
        'keyboard',
        'keyboard',
        'keyboard',
    ];
    const labels = { app: 'APP', keyboard: '键盘', pin: 'PIN' };
    expect(recordsFixture.records.map((item) => item.type)).toEqual(expectedTypes);
    await expect(records(page).locator('.record-type-label')).toHaveText(
        expectedTypes.map((value) => labels[value]),
    );
    for (const [value, count] of [
        ['app', 14],
        ['keyboard', 9],
        ['pin', 1],
    ]) {
        expect(recordsFixture.records.filter((item) => item.type === value)).toHaveLength(count);
        await type.selectOption(value);
        await expectRecordRows(
            page,
            recordsFixture.records.filter((item) => item.type === value),
        );
    }
    await type.selectOption('all');
    for (const value of [...new Set(recordsFixture.records.map((item) => item.packageName))]) {
        await app.selectOption(value);
        await expectRecordRows(
            page,
            recordsFixture.records.filter((item) => item.packageName === value),
        );
    }
    await app.selectOption('all');
    const keyword = recordsFixture.records[0].content;
    await recordKeyword(page).fill(keyword);
    await records(page).getByRole('button', { name: '搜索', exact: true }).click();
    await expectRecordRows(
        page,
        recordsFixture.records.filter((item) =>
            [item.content, item.appName, item.packageName, item.typeLabel].some((value) =>
                normalize(value).includes(normalize(keyword.trim())),
            ),
        ),
    );
    const markupRecord = recordsFixture.records.find((item) => item.content.includes('<b>'));
    expect(markupRecord).toBeTruthy();
    await recordKeyword(page).fill(markupRecord.content);
    await records(page).getByRole('button', { name: '搜索', exact: true }).click();
    await expectRecordRows(page, [markupRecord]);
    await expect(
        records(page).locator(
            '.record-row td:nth-child(2) b, .record-row script, .record-row iframe',
        ),
    ).toHaveCount(0);
    await recordKeyword(page).fill('DEMO-NO-RECORD-9999');
    await records(page).getByRole('button', { name: '搜索', exact: true }).click();
    await expectRecordRows(page, []);
    await expect(records(page)).toContainText('没有匹配的合成记录');
    expect(observation.requests).toHaveLength(requestCount);
    await records(page).getByRole('button', { name: '测试数据', exact: true }).click();
    await expectRecordsEmpty(page);
    await records(page).getByRole('button', { name: '测试数据', exact: true }).click();
    await expect(recordKeyword(page)).toHaveValue('');
    await expect(type).toHaveValue('all');
    await expect(app).toHaveValue('all');
    await expectRecordRows(page, recordsFixture.records);
    expect(await businessState(page)).toEqual(before);
    expectNoExecution(observation);
    console.log(
        'DEVICE_MODULE_RECORDS PASS: honest password GET empty; five-field metadata default folded/Enter opens/Space closes/DOM retained; inline filter count/caption; 24 automatic sample-only synthetic records/reference APP14 keyboard9 PIN1 labels and ordered fixture enums; local type/app/keyword filters; text rendering/filter reset; no device mutations/WS commands/external/downloads',
    );
});

test('sample defaults are source-specific and refresh preserves manual demo choices and filters without persisting records', async ({
    page,
}) => {
    const observation = observe(page);
    let source = 'api';
    const sourceUpdates = [];
    // Detail state also arrives over the authenticated subscription: both fixture
    // channels must agree, otherwise the real sample device overwrites HTTP mocks.
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
                ) {
                    sourceUpdates.push(source);
                    socket.send(JSON.stringify({ ...message, data: { ...message.data, source } }));
                } else socket.send(raw);
            });
        },
    );
    await login(page);
    observation.mutations.length = 0;
    const before = await businessState(page);
    const detailEndpoint = '**/api/devices/1';
    await page.route(detailEndpoint, (route) =>
        route.fulfill({
            status: 200,
            json: { ...before.detail, device: { ...before.detail.device, source } },
        }),
    );
    const refresh = async () => {
        const responseEvent = page.waitForResponse(
            (response) =>
                new URL(response.url()).pathname === '/api/devices/1/ui-preview/password' &&
                response.request().method() === 'GET',
        );
        await records(page).getByRole('button', { name: '刷新', exact: true }).click();
        const response = await responseEvent;
        expect(response.status()).toBe(200);
        expect(await response.json()).toMatchObject({ items: [], total: 0, implemented: false });
        await expect(records(page)).toHaveAttribute('aria-busy', 'false');
    };
    try {
        await openDetail(page);
        await choose(page, '应用列表');
        await expectAppsEmpty(page);
        await apps(page).getByRole('button', { name: '测试数据', exact: true }).click();
        await expectAppsDefault(page);
        await choose(page, '密码记录');
        await expectRecordsEmpty(page);
        await expect.poll(() => sourceUpdates.includes('api')).toBe(true);
        await records(page).getByRole('button', { name: '测试数据', exact: true }).click();
        await expectRecordsDefault(page);
        const selected = recordsFixture.records[0];
        await records(page)
            .getByRole('combobox', { name: '记录应用', exact: true })
            .selectOption(selected.packageName);
        await records(page)
            .getByRole('combobox', { name: '记录类型', exact: true })
            .selectOption(selected.type);
        await recordKeyword(page).fill(selected.content);
        await records(page).getByRole('button', { name: '搜索', exact: true }).click();
        await expectRecordRows(page, [selected]);
        await refresh();
        await expect(records(page)).toHaveAttribute('data-demo', 'true');
        await expect(recordKeyword(page)).toHaveValue(selected.content);
        await expect(
            records(page).getByRole('combobox', { name: '记录应用', exact: true }),
        ).toHaveValue(selected.packageName);
        await expect(
            records(page).getByRole('combobox', { name: '记录类型', exact: true }),
        ).toHaveValue(selected.type);
        await expectRecordRows(page, [selected]);

        source = 'sample';
        await openDetail(page);
        await choose(page, '应用列表');
        await expectAppsDefault(page);
        await choose(page, '密码记录');
        await expectRecordsDefault(page);
        await records(page).getByRole('button', { name: '测试数据', exact: true }).click();
        await expectRecordsEmpty(page);
        await recordKeyword(page).fill('DEMO-MANUAL-OFF');
        await records(page).getByRole('button', { name: '搜索', exact: true }).click();
        await refresh();
        await expect(records(page)).toHaveAttribute('data-demo', 'false');
        await expect(records(page).locator('.record-row')).toHaveCount(0);
        await expect(recordKeyword(page)).toHaveValue('DEMO-MANUAL-OFF');
        await page.reload();
        await expect(page.getByRole('textbox', { name: '设备备注', exact: true })).toBeVisible();
        await choose(page, '密码记录');
        await expectRecordsDefault(page);

        await recordKeyword(page).fill('DEMO-PREVIOUS-DEVICE');
        await records(page).getByRole('button', { name: '搜索', exact: true }).click();
        await openDetail(page, 2);
        await choose(page, '密码记录');
        await expectRecordsDefault(page);
        for (const nonSample of ['import', 'unknown', '']) {
            source = nonSample;
            await openDetail(page);
            await choose(page, '应用列表');
            await expectAppsEmpty(page);
            await choose(page, '密码记录');
            await expectRecordsEmpty(page);
        }
        source = 'sample';
        await openDetail(page);
        await choose(page, '应用列表');
        await expectAppsDefault(page);
        await choose(page, '密码记录');
        await expectRecordsDefault(page);
    } finally {
        await page.unroute(detailEndpoint);
    }
    expect(await businessState(page)).toEqual(before);
    expectNoExecution(observation);
    console.log(
        'DEVICE_RECORD_DEFAULTS PASS: only sample source auto-displays24 records and6 user apps after verified GET; api/import/unknown/empty HTTP+WS sources start empty; explicit on/off and app/type/keyword filters survive GET refresh; page reload/source/device switch recompute defaults and clear prior choices/filters; no device mutations/WS commands/external/downloads',
    );
});

test('pending and unauthenticated password preview reads never automatically reveal the synthetic fixture', async ({
    page,
}) => {
    const observation = observe(page);
    await login(page);
    observation.mutations.length = 0;
    let release;
    let started = 0;
    const gate = new Promise((resolve) => {
        release = resolve;
    });
    const endpoint = '**/api/devices/1/ui-preview/password';
    await page.route(
        endpoint,
        async (route) => {
            started++;
            await gate;
            await route
                .fulfill({ status: 401, json: { error: 'DEMO-AUTH-EXPIRED' } })
                .catch(() => {});
        },
        { times: 1 },
    );
    try {
        await openDetail(page);
        await choose(page, '密码记录');
        await expect.poll(() => started).toBe(1);
        await expect(records(page)).toHaveAttribute('aria-busy', 'true');
        await expect(records(page)).toHaveAttribute('data-demo', 'false');
        await expect(records(page).locator('.record-row')).toHaveCount(0);
        await expect(records(page).locator('.record-demo-notice')).toHaveCount(0);
        const responseEvent = page.waitForResponse(
            (response) =>
                new URL(response.url()).pathname === '/api/devices/1/ui-preview/password' &&
                response.status() === 401,
        );
        release();
        await responseEvent;
        await expect(page).toHaveURL('/login');
        await expect(records(page)).toHaveCount(0);
        // A mocked 401 expires the client session only. Explicitly revoke the
        // still-valid server cookie before a fresh document restores that session.
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
        await choose(page, '密码记录');
        await expectRecordsDefault(page);
    } finally {
        release();
        await page.unroute(endpoint);
    }
    expect(observation.mutations).toEqual([
        { method: 'POST', path: '/api/auth/logout' },
        { method: 'POST', path: '/api/auth/login' },
    ]);
    expectNoExecution(observation, [
        (request) => ['/api/auth/logout', '/api/auth/login'].includes(request.path),
    ]);
    console.log(
        'DEVICE_RECORD_AUTH_GATE PASS: pending sample GET leaves demo false/rows0; GET401 ends session with no fixture auto-selection; real logout200 clears original cookie; next login and verified GET shows24; no device mutations/WS commands/external/downloads',
    );
});

test('preview failures retry real empty GETs, old device responses are cancelled and account replacement clears local demonstrations', async ({
    page,
}) => {
    const observation = observe(page);
    await login(page);
    observation.mutations.length = 0;
    const before = await businessState(page);
    for (const module of [
        {
            label: '应用列表',
            section: 'apps',
            root: apps,
            refresh: '获取应用列表',
            initial: expectAppsDefault,
            rows: '.app-row',
        },
        {
            label: '密码记录',
            section: 'password',
            root: records,
            refresh: '刷新',
            initial: expectRecordsDefault,
            rows: '.record-row',
        },
    ]) {
        const endpoint = `/api/devices/1/ui-preview/${module.section}`;
        const empty = await (await page.request.get(endpoint)).json();
        await page.route(
            `**${endpoint}`,
            (route) =>
                route.fulfill({
                    status: 500,
                    json: { error: `DEMO-${module.section}-READ-FAILED` },
                }),
            { times: 1 },
        );
        await openDetail(page);
        await choose(page, module.label);
        await expect(module.root(page)).toHaveAttribute('data-state', 'error');
        await expect(module.root(page).getByRole('alert')).toContainText(
            `DEMO-${module.section}-READ-FAILED`,
        );
        await expect(module.root(page)).toHaveAttribute('data-demo', 'false');
        await expect(module.root(page).locator(module.rows)).toHaveCount(0);
        await module.root(page).getByRole('button', { name: '重试预览', exact: true }).click();
        await module.initial(page);
        await page.route(
            `**${endpoint}`,
            (route) =>
                route.fulfill({
                    status: 200,
                    json: {
                        ...empty,
                        deviceId: 2,
                        items: [{ content: 'DEMO-SHOULD-NOT-RENDER' }],
                        total: 1,
                    },
                }),
            { times: 1 },
        );
        await module.root(page).getByRole('button', { name: module.refresh, exact: true }).click();
        await expect(module.root(page)).toHaveAttribute('data-state', 'error');
        await expect(module.root(page).locator(module.rows)).toHaveCount(0);
        await expect(module.root(page)).toHaveAttribute('data-demo', 'false');
        await expect(
            module.root(page).getByRole('button', { name: '测试数据', exact: true }),
        ).toBeDisabled();
        await expect(module.root(page)).not.toContainText('DEMO-SHOULD-NOT-RENDER');
        await module.root(page).getByRole('button', { name: '重试预览', exact: true }).click();
        await module.initial(page);
        let release;
        let started = 0;
        const gate = new Promise((resolve) => {
            release = resolve;
        });
        await page.route(`**${endpoint}`, async (route) => {
            started++;
            await gate;
            await route
                .fulfill({ status: 500, json: { error: `DEMO-LATE-${module.section}` } })
                .catch(() => {});
        });
        try {
            await module
                .root(page)
                .getByRole('button', { name: module.refresh, exact: true })
                .click();
            await expect.poll(() => started).toBe(1);
            await expect(module.root(page)).toHaveAttribute('aria-busy', 'true');
            await expect(module.root(page)).toHaveAttribute('data-demo', 'false');
            await expect(module.root(page).locator(module.rows)).toHaveCount(0);
            await expect(
                module.root(page).getByRole('button', { name: module.refresh, exact: true }),
            ).toBeDisabled();
            await page.locator('.device-back').click();
            await expect(page).toHaveURL('/');
            await expect(module.root(page)).toHaveCount(0);
            await openDetail(page, 2);
            await choose(page, module.label);
            await module.initial(page);
            release();
            await page.waitForTimeout(100);
            await expect(module.root(page)).not.toContainText(`DEMO-LATE-${module.section}`);
            await expect(page.locator('.device-topbar h1')).toContainText('测试设备 2');
        } finally {
            release();
            await page.unroute(`**${endpoint}`);
        }
    }
    const memoEndpoint = '/api/devices/12/memos';
    let releaseMemos;
    let memoReads = 0;
    const memoGate = new Promise((resolve) => {
        releaseMemos = resolve;
    });
    await page.route(`**${memoEndpoint}`, async (route) => {
        memoReads++;
        await memoGate;
        await route.fulfill({ status: 500, json: { error: 'DEMO-LATE-MEMOS' } }).catch(() => {});
    });
    try {
        await openDetail(page, 12);
        await choose(page, '备忘录');
        await expect.poll(() => memoReads).toBe(1);
        await expect(memos(page)).toHaveAttribute('aria-busy', 'true');
        await openDetail(page, 2);
        await choose(page, '备忘录');
        await expect(memos(page)).toHaveAttribute('aria-busy', 'false');
        releaseMemos();
        await page.waitForTimeout(100);
        await expect(memos(page)).not.toContainText('DEMO-LATE-MEMOS');
        await expect(memos(page).locator('.memos-empty')).toBeVisible();
    } finally {
        releaseMemos();
        await page.unroute(`**${memoEndpoint}`);
    }
    await choose(page, '密码记录');
    await expectRecordsDefault(page);
    await records(page).getByRole('button', { name: '测试数据', exact: true }).click();
    await expectRecordsEmpty(page);
    await recordKeyword(page).fill('DEMO-ACCOUNT-LOCAL');
    await choose(page, '备忘录');
    await expect(memos(page)).toHaveAttribute('aria-busy', 'false');
    await memos(page).getByRole('button', { name: '＋ 添加', exact: true }).click();
    await memos(page).getByRole('textbox', { name: '备忘内容', exact: true }).fill('DEMO-UNSAVED');
    await page.goto('/settings/account');
    await page.getByRole('button', { name: '退出登录', exact: true }).click();
    await expect(page).toHaveURL('/login');
    await expect(records(page)).toHaveCount(0);
    await login(page);
    await openDetail(page, 2);
    await choose(page, '备忘录');
    await expect(memos(page)).toHaveAttribute('aria-busy', 'false');
    await expect(memos(page).locator('.memos-editor')).toHaveCount(0);
    await expect(memos(page)).not.toContainText('DEMO-UNSAVED');
    await choose(page, '应用列表');
    await expectAppsDefault(page);
    await choose(page, '密码记录');
    await expectRecordsDefault(page);
    expect(observation.mutations).toEqual([
        { method: 'POST', path: '/api/auth/logout' },
        { method: 'POST', path: '/api/auth/login' },
    ]);
    expect(await businessState(page)).toEqual(before);
    expectNoExecution(observation, [(request) => request.path.startsWith('/api/auth/')]);
    console.log(
        'DEVICE_MODULE_CANCEL PASS: apps/records GET500 retry200; wrong-device/nonempty response rejected; apps/records/memos pending reads aborted and stale results absent on next device; logout-login recomputes sample default and clears prior off choice/filters/unsaved memo; only explicit auth POSTs, no device mutations/WS commands/external/downloads',
    );
});

test('detail memo panel reuses real scoped CRUD, four labels and 500-character validation without replacing the device remark', async ({
    page,
}) => {
    const observation = observe(page);
    await login(page);
    observation.mutations.length = 0;
    const deviceId = 12;
    const endpoint = `/api/devices/${deviceId}/memos`;
    const beforeList = await (await page.request.get(endpoint)).json();
    const beforeDetail = await (await page.request.get(`/api/devices/${deviceId}`)).json();
    expect(beforeList.total).toBe(0);
    await page.route(
        `**${endpoint}`,
        (route) => route.fulfill({ status: 500, json: { error: 'DEMO-MEMO-READ-FAILED' } }),
        { times: 1 },
    );
    await openDetail(page, deviceId);
    await choose(page, '备忘录');
    await expect(memos(page).getByRole('alert')).toContainText('DEMO-MEMO-READ-FAILED');
    await expect(memos(page).locator('.memos-empty')).not.toBeVisible();
    await memos(page).getByRole('button', { name: '刷新备忘录', exact: true }).click();
    await expect(memos(page)).toHaveAttribute('aria-busy', 'false');
    await expect(memos(page).locator('.memos-empty')).toHaveText(
        '暂无备忘录，点击“＋ 添加”开始记录',
    );
    await page.route(
        `**${endpoint}`,
        (route) =>
            route.fulfill({
                status: 200,
                json: { data: [{ id: -1, body: 'DEMO-MALFORMED-MEMO', label: 'none' }], total: 1 },
            }),
        { times: 1 },
    );
    await memos(page).getByRole('button', { name: '刷新备忘录', exact: true }).click();
    await expect(memos(page).getByRole('alert')).toContainText('备忘录响应格式不符，请重试。');
    await expect(memos(page).locator('.memos-item')).toHaveCount(0);
    await expect(memos(page)).not.toContainText('DEMO-MALFORMED-MEMO');
    await memos(page).getByRole('button', { name: '重试备忘录', exact: true }).click();
    await expect(memos(page).locator('.memos-empty')).toBeVisible();
    await page.route(`**${endpoint}`, (route) => route.fulfill({ status: 200, json: null }), {
        times: 1,
    });
    await memos(page).getByRole('button', { name: '刷新备忘录', exact: true }).click();
    await expect(memos(page).getByRole('alert')).toContainText('备忘录响应格式不符，请重试。');
    await memos(page).getByRole('button', { name: '重试备忘录', exact: true }).click();
    await expect(memos(page).locator('.memos-empty')).toBeVisible();
    await expect(
        memos(page).getByRole('button', { name: '测试数据', exact: true }),
    ).toHaveAttribute('aria-pressed', 'false');
    await memos(page).getByRole('button', { name: '＋ 添加', exact: true }).click();
    const content = memos(page).getByRole('textbox', { name: '备忘内容', exact: true });
    await expect(content).toHaveAttribute('maxlength', '500');
    await expect(content).toHaveAttribute('required', '');
    await expect(memos(page).getByRole('button', { name: '保存', exact: true })).toBeDisabled();
    const body = '<b>DEMO-MODULE-MEMO</b> 本地记录';
    await content.fill(body);
    const createResponse = page.waitForResponse(
        (response) =>
            new URL(response.url()).pathname === endpoint && response.request().method() === 'POST',
    );
    await memos(page).getByRole('button', { name: '保存', exact: true }).click();
    const createdResponse = await createResponse;
    expect(createdResponse.status()).toBe(201);
    expect(createdResponse.request().postDataJSON()).toEqual({ body, label: 'none' });
    const created = await createdResponse.json();
    const item = memos(page).locator(`.memos-item[data-memo-id="${created.id}"]`);
    let removed = false;
    try {
        expect(created).toMatchObject({ body, label: 'none', author: 'mtx' });
        expect(Number.isSafeInteger(created.id)).toBe(true);
        expect(created.createdAt).toBeGreaterThan(0);
        await expect(item.locator('.memos-body')).toHaveText(body);
        await expect(item.locator('b, script, iframe')).toHaveCount(0);
        await expect(memos(page).locator('.memos-count')).toHaveText('共 1 条');
        await expect(
            memos(page).getByRole('button', { name: '＋ 添加', exact: true }),
        ).toBeFocused();
        const labelNames = { important: '重要', follow_up: '待跟进', handled: '已处理' };
        for (const [label, name] of Object.entries(labelNames)) {
            await item.getByRole('button', { name: '编辑', exact: true }).click();
            await expect(content).toBeVisible();
            const nextBody =
                label === 'handled' ? `DEMO-MEMO-${'x'.repeat(490)}` : `DEMO-MODULE-${label}`;
            await content.fill(nextBody);
            const labelButton = memos(page)
                .getByRole('group', { name: '备忘标签', exact: true })
                .getByRole('button', { name, exact: true });
            await labelButton.click();
            await expect(labelButton).toHaveAttribute('aria-pressed', 'true');
            const updateResponse = page.waitForResponse(
                (response) =>
                    new URL(response.url()).pathname === `${endpoint}/${created.id}` &&
                    response.request().method() === 'PATCH',
            );
            await memos(page).getByRole('button', { name: '更新', exact: true }).click();
            const updatedResponse = await updateResponse;
            expect(updatedResponse.status()).toBe(200);
            expect(updatedResponse.request().postDataJSON()).toEqual({ body: nextBody, label });
            expect(await updatedResponse.json()).toMatchObject({
                id: created.id,
                body: nextBody,
                label,
                author: 'mtx',
            });
            await expect(item.locator('.memos-body')).toHaveText(nextBody);
            await expect(item.getByRole('button', { name: '编辑', exact: true })).toBeFocused();
        }
        const invalid = await page.request.post(endpoint, {
            headers,
            data: { body: 'x'.repeat(501), label: 'none' },
        });
        expect(invalid.status()).toBe(422);
        expect((await (await page.request.get(endpoint)).json()).total).toBe(1);
        const deletionsBeforeCancel = observation.mutations.filter(
            (request) => request.method === 'DELETE',
        ).length;
        page.once('dialog', (dialog) => dialog.dismiss());
        await item.getByRole('button', { name: '删除', exact: true }).click();
        await expect(item).toBeVisible();
        expect(observation.mutations.filter((request) => request.method === 'DELETE')).toHaveLength(
            deletionsBeforeCancel,
        );
        page.once('dialog', (dialog) => dialog.accept());
        const deleteResponse = page.waitForResponse(
            (response) =>
                new URL(response.url()).pathname === `${endpoint}/${created.id}` &&
                response.request().method() === 'DELETE',
        );
        await item.getByRole('button', { name: '删除', exact: true }).click();
        const deletedResponse = await deleteResponse;
        expect(deletedResponse.status()).toBe(200);
        expect(deletedResponse.request().postDataJSON()).toEqual({});
        expect(await deletedResponse.json()).toEqual({ ok: true });
        removed = true;
        await expect(item).toHaveCount(0);
        await expect(memos(page).locator('.memos-empty')).toBeVisible();
        await expect(
            memos(page).getByRole('button', { name: '＋ 添加', exact: true }),
        ).toBeFocused();
        expect(await (await page.request.get(endpoint)).json()).toEqual(beforeList);
        const afterDetail = await (await page.request.get(`/api/devices/${deviceId}`)).json();
        expect(afterDetail.device.note).toBe(beforeDetail.device.note);
        expect(afterDetail.snapshots).toEqual(beforeDetail.snapshots);
        expect(afterDetail.events).toEqual(beforeDetail.events);
        expect(observation.mutations).toEqual([
            { method: 'POST', path: endpoint },
            { method: 'PATCH', path: `${endpoint}/${created.id}` },
            { method: 'PATCH', path: `${endpoint}/${created.id}` },
            { method: 'PATCH', path: `${endpoint}/${created.id}` },
            { method: 'DELETE', path: `${endpoint}/${created.id}` },
        ]);
        expectNoExecution(observation, [
            (request) => request.path === endpoint || request.path === `${endpoint}/${created.id}`,
        ]);
    } finally {
        if (!removed) await page.request.delete(`${endpoint}/${created.id}`, { headers, data: {} });
    }
    console.log(
        'DEVICE_MODULE_MEMOS PASS: GET500/malformed/null retry; real POST201/PATCH200/DELETE200; none/important/follow_up/handled; max500 and server501-length422; plaintext body and focus restoration; cancelled delete0; confirmed delete restores initial memo list; remark/history unchanged; no device commands/external/downloads',
    );
});

async function expectCompactRecords(page, theme, width, expectedMetadata, observation) {
    await expectRecordRows(page, recordsFixture.records);
    const form = records(page).locator('form.record-filters');
    const app = records(page).getByRole('combobox', { name: '记录应用', exact: true });
    const type = records(page).getByRole('combobox', { name: '记录类型', exact: true });
    const search = records(page).getByRole('button', { name: '搜索', exact: true });
    const refresh = records(page).getByRole('button', { name: '刷新', exact: true });
    const demo = records(page).getByRole('button', { name: '测试数据', exact: true });
    const metadata = records(page).locator('details.record-metadata');
    const summary = metadata.locator(':scope > summary');
    await expect(form.locator('.record-preview-status')).toHaveCount(1);
    await expect(form.locator('.record-demo-notice')).toContainText('合成测试数据 · 非设备记录');
    await expect(form.locator('.record-count')).toHaveText(
        `共 ${recordsFixture.records.length} 条记录`,
    );
    await expect(records(page).locator(':scope > .record-preview-status')).toHaveCount(0);
    await expect(metadata).not.toHaveAttribute('open');
    await expect(metadata.locator('table')).not.toBeVisible();
    await expect(metadata).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
    expect((await metadata.boundingBox()).height).toBeLessThanOrEqual(29);
    const metrics = await records(page).evaluate((element) => {
        const form = element.querySelector('.record-filters');
        const formBox = form.getBoundingClientRect();
        const status = form.querySelector('.record-preview-status');
        const statusBox = status.getBoundingClientRect();
        const table = element.querySelector('.record-table');
        const tableBox = table.getBoundingClientRect();
        const controls = [
            '.record-app-filter',
            '.record-type-filter',
            '.record-keyword',
            '.record-search-button',
        ].map((selector) => {
            const control = form.querySelector(selector);
            const box = control.getBoundingClientRect();
            return { x: box.x, y: box.y, width: box.width, height: box.height };
        });
        const labels = ['app', 'keyboard', 'pin'].map((type) => {
            const label = element.querySelector(`.record-type-label[data-type="${type}"]`);
            const style = getComputedStyle(label);
            return {
                type,
                text: label.textContent.trim(),
                fontSize: style.fontSize,
                fontWeight: style.fontWeight,
                background: style.backgroundColor,
                color: style.color,
                radius: Number.parseFloat(style.borderRadius),
            };
        });
        return {
            controls,
            gap: getComputedStyle(form).columnGap,
            formHeight: formBox.height,
            statusInForm: status.closest('form') === form,
            statusMiddle: statusBox.y + statusBox.height / 2,
            controlMiddle: controls[0].y + controls[0].height / 2,
            tableGap: tableBox.y - formBox.bottom,
            header: [...table.querySelectorAll('thead th')].map((cell) => ({
                text: cell.textContent.trim(),
                widthPercent: (cell.getBoundingClientRect().width / tableBox.width) * 100,
                height: cell.getBoundingClientRect().height,
            })),
            rows: [...table.querySelectorAll('tbody .record-row')].map((row) => ({
                height: row.getBoundingClientRect().height,
                columns: row.cells.length,
            })),
            labels,
            localOverflow: element.scrollWidth > element.clientWidth + 1,
        };
    });
    expect(metrics.controls).toHaveLength(4);
    const expectedWidths = [160, 90, 165, 52];
    for (const [index, control] of metrics.controls.entries()) {
        expect(control.width).toBeCloseTo(expectedWidths[index], 1);
        expect(control.height).toBe(29);
        expect(control.y).toBeCloseTo(metrics.controls[0].y, 1);
        if (index > 0)
            expect(
                control.x - metrics.controls[index - 1].x - metrics.controls[index - 1].width,
            ).toBeCloseTo(8, 1);
    }
    expect(metrics.gap).toBe('8px');
    expect(metrics.formHeight).toBe(29);
    expect(metrics.statusInForm).toBe(true);
    expect(metrics.statusMiddle).toBeCloseTo(metrics.controlMiddle, 1);
    expect(metrics.tableGap).toBeCloseTo(10, 1);
    expect(metrics.header.map((cell) => cell.text)).toEqual(['类型', '内容', '应用', '时间']);
    for (const [index, cell] of metrics.header.entries()) {
        expect(cell.widthPercent).toBeCloseTo([9, 42, 15, 34][index], 1);
        expect(cell.height).toBe(34);
    }
    expect(metrics.rows).toHaveLength(recordsFixture.records.length);
    expect(metrics.rows.every((row) => row.height === 34 && row.columns === 4)).toBe(true);
    expect(metrics.localOverflow).toBe(false);
    const [amber, ordinary, blue] = metrics.labels;
    expect(metrics.labels.map((label) => label.text)).toEqual(['APP', '键盘', 'PIN']);
    expect(ordinary.background).toBe('rgba(0, 0, 0, 0)');
    expect(ordinary.radius).toBe(0);
    expect(ordinary.fontSize).toBe('11px');
    expect(ordinary.fontWeight).toBe('600');
    for (const label of [amber, blue]) {
        expect(label.fontSize).toBe('10px');
        expect(label.fontWeight).toBe('500');
        expect(label.background).not.toBe('rgba(0, 0, 0, 0)');
        expect(label.radius).toBeGreaterThanOrEqual(8);
        expect(label.background).not.toBe(label.color);
    }
    expect(amber.background).not.toBe(blue.background);
    expect([amber.background, amber.color, blue.background, blue.color]).toEqual(
        theme === 'dark'
            ? ['rgb(62, 52, 34)', 'rgb(239, 189, 100)', 'rgb(40, 52, 81)', 'rgb(173, 185, 255)']
            : [
                  'rgb(255, 249, 233)',
                  'rgb(245, 158, 11)',
                  'rgb(238, 241, 255)',
                  'rgb(83, 102, 255)',
              ],
    );
    await expect(records(page).getByRole('button', { name: /解锁|捕获|密码提交/ })).toHaveCount(0);

    await page.waitForLoadState('networkidle');
    const requestCount = observation.requests.length;
    await page.keyboard.press('Tab');
    await app.focus();
    for (const control of [app, type, recordKeyword(page), search, refresh, demo]) {
        await expect(control).toBeFocused();
        await expect(control).toHaveCSS('outline-style', 'solid');
        await expect(control).toHaveCSS('outline-width', '2px');
        if (control !== demo) await page.keyboard.press('Tab');
    }
    const keyword = recordsFixture.records[0].content;
    await recordKeyword(page).fill(keyword);
    await recordKeyword(page).focus();
    await page.keyboard.press('Enter');
    await expectRecordRows(
        page,
        recordsFixture.records.filter((item) =>
            [item.content, item.appName, item.packageName, item.typeLabel].some((value) =>
                normalize(value).includes(normalize(keyword.trim())),
            ),
        ),
    );
    await recordKeyword(page).fill('');
    await page.keyboard.press('Enter');
    await expectRecordRows(page, recordsFixture.records);
    await summary.focus();
    await expect(summary).toHaveCSS('outline-style', 'solid');
    await expect(summary).toHaveCSS('outline-width', '2px');
    await page.keyboard.press('Enter');
    await expect(metadata).toHaveAttribute('open');
    await expect(metadata.locator('table')).toBeVisible();
    await expect(metadata.locator('thead th')).toHaveText([
        '场景',
        '通道',
        '测试编号',
        '是否返回文本',
        '合成值匹配',
    ]);
    await expect(metadata.locator('tbody tr')).toHaveCount(expectedMetadata.length);
    for (const [index, item] of expectedMetadata.entries())
        await expect(metadata.locator('tbody tr').nth(index).locator('td')).toHaveText([
            item.scenario,
            item.channel,
            item.case_id,
            String(item.text_returned ?? '—'),
            item.synthetic_match,
        ]);
    await summary.focus();
    await page.keyboard.press('Space');
    await expect(metadata).not.toHaveAttribute('open');
    await expect(metadata.locator('table')).not.toBeVisible();
    await expect(metadata.locator('tbody tr')).toHaveCount(expectedMetadata.length);
    await demo.focus();
    await page.keyboard.press('Space');
    await expectRecordsEmpty(page);
    await demo.focus();
    await page.keyboard.press('Space');
    await expectRecordRows(page, recordsFixture.records);
    expect(observation.requests).toHaveLength(requestCount);
    await screenshot(page, `device-records-reference-${theme}-${width}.png`);
    if (width === 800) {
        await page.evaluate(() => window.scrollTo(0, 0));
        await expect.poll(() => page.evaluate(() => window.scrollX)).toBe(0);
        const right = await page.locator('.device-tools').boundingBox();
        await page.evaluate(() => window.scrollTo(360, 0));
        await expect.poll(() => page.evaluate(() => window.scrollX)).toBe(360);
        const left = await page.locator('.device-nav').boundingBox();
        const scrolledRight = await page.locator('.device-tools').boundingBox();
        expect(left.x).toBe(0);
        expect(left.y).toBe(44);
        expect(scrolledRight.width).toBe(176);
        expect(scrolledRight.y).toBe(44);
        expect(scrolledRight.x).toBeCloseTo(right.x - 360, 0);
        await expect(form).toHaveCSS('height', '29px');
        await screenshot(page, `device-records-reference-scroll-${theme}-800.png`);
        await page.evaluate(() => window.scrollTo(0, 0));
    }
}

test('detail modules retain compact desktop columns, keyboard controls and exact dark surfaces at 1440, 1280 and 800px', async ({
    page,
}) => {
    test.setTimeout(60000);
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
            await openDetail(page);
            for (const module of [
                { label: '应用列表', root: apps, empty: expectAppsDefault },
                { label: '密码记录', root: records, empty: expectRecordsDefault },
                { label: '备忘录', root: memos },
            ]) {
                await navigation(page)
                    .getByRole('button', { name: module.label, exact: true })
                    .focus();
                await page.keyboard.press('Enter');
                await expect(module.root(page)).toHaveAttribute('aria-busy', 'false');
                if (module.empty) {
                    await module.empty(page);
                    if (module.label === '应用列表') {
                        await module
                            .root(page)
                            .getByRole('button', { name: '测试数据', exact: true })
                            .focus();
                        await page.keyboard.press('Space');
                        await expectAppsEmpty(page);
                        await page.keyboard.press('Space');
                    }
                    await expect(module.root(page)).toHaveAttribute('data-demo', 'true');
                    if (theme === 'dark' && module.label === '应用列表')
                        await expect(apps(page).locator('.apps-list').first()).toHaveCSS(
                            'background-color',
                            'rgb(31, 41, 56)',
                        );
                    if (module.label === '密码记录')
                        await expectCompactRecords(
                            page,
                            theme,
                            width,
                            before.detail.snapshot.payload.observations.filter(
                                (item) => item.scenario === 'password_field',
                            ),
                            observation,
                        );
                    if (theme === 'dark' && module.label === '密码记录') {
                        await expect(records(page).locator('.record-table th').first()).toHaveCSS(
                            'background-color',
                            'rgb(34, 45, 64)',
                        );
                        await expect(recordKeyword(page)).toHaveCSS(
                            'background-color',
                            'rgb(31, 41, 56)',
                        );
                    }
                } else {
                    await memos(page).getByRole('button', { name: '＋ 添加', exact: true }).focus();
                    await page.keyboard.press('Enter');
                    await expect(
                        memos(page).getByRole('textbox', { name: '备忘内容', exact: true }),
                    ).toBeVisible();
                    if (theme === 'dark')
                        await expect(
                            memos(page).getByRole('textbox', { name: '备忘内容', exact: true }),
                        ).toHaveCSS('background-color', 'rgb(31, 41, 56)');
                    await page.keyboard.press('Escape');
                    await expect(memos(page).locator('.memos-editor')).toHaveCount(0);
                    await expect(
                        memos(page).getByRole('button', { name: '＋ 添加', exact: true }),
                    ).toBeFocused();
                }
                await expect(page.locator('.device-topbar')).toHaveCSS('height', '44px');
                await expect(page.locator('.device-nav')).toHaveCSS('width', '110px');
                await expect(page.locator('.device-tools')).toHaveCSS('width', '176px');
                if (theme === 'dark')
                    await expect(page.locator('.device-canvas')).toHaveCSS(
                        'background-color',
                        'rgb(20, 25, 34)',
                    );
                expect(
                    await page.evaluate(() => document.documentElement.scrollWidth),
                ).toBeGreaterThanOrEqual(1280);
                expect(
                    await module
                        .root(page)
                        .evaluate((element) => element.scrollWidth <= element.clientWidth + 1),
                ).toBe(true);
                await screenshot(page, `device-modules-${module.label}-${theme}-${width}.png`);
            }
            if (width === 800) {
                await page.evaluate(() => window.scrollTo(360, 0));
                await expect.poll(() => page.evaluate(() => window.scrollX)).toBe(360);
                const nav = await page.locator('.device-nav').boundingBox();
                expect(nav.x).toBe(0);
                expect(nav.y).toBe(44);
            }
        }
    }
    expect(await businessState(page)).toEqual(before);
    expectNoExecution(observation);
    console.log(
        'DEVICE_MODULE_GEOMETRY PASS: apps/records/memos light-dark1440/1280/800; record filters160/90/165/52 gap8/height29/status inline/table gap10; four columns9/42/15/34% and24 synthetic rows34; keyboard plain600/APP amber500/PIN blue500 fixture type labels; default folded transparent metadata/Enter-Space/five attributes preserved; keyboard Tab order/keyword Enter/2px focus; record800 scroll360 with fixed left and176 right; top44/left110/right176/min1280; dark canvas20,25,34/apps-memo31,41,56/recordheader34,45,64; no device mutations/WS commands/external/downloads',
    );
});
