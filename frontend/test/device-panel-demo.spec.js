import { test, expect } from '@playwright/test';
import { mkdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { matchInjectionDemo } from '../src/fixtures/injection-demo-match.js';
import { attachInjectionSubmissions } from '../src/fixtures/injection-submission-demo.js';

const fixture = JSON.parse(
    await readFile(new URL('../src/fixtures/device-ui-demo.json', import.meta.url), 'utf8'),
);
const matchFixture = JSON.parse(
    await readFile(
        new URL('../src/fixtures/device-injection-match-demo.json', import.meta.url),
        'utf8',
    ),
);
const submissionFixture = JSON.parse(
    await readFile(
        new URL('../src/fixtures/device-injection-submission-demo.json', import.meta.url),
        'utf8',
    ),
);
const submissionResult = attachInjectionSubmissions(
    matchInjectionDemo(matchFixture),
    submissionFixture,
);
const matchedApplications = submissionResult.applications;
const copyEnvelope = (record) => ({
    protocol: 'mtx-ui-demo/v1',
    schemaVersion: 1,
    fixtureOnly: true,
    synthetic: true,
    ...record,
    pattern: record.pattern || [],
});
const titles = { password: '锁屏密码', quick: '注入应用快捷' };
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

async function expectDefault(page, instance, demo = true) {
    if (demo) {
        await expect(panel(page, instance)).toHaveAttribute('aria-busy', 'false');
        await expect(panel(page, instance)).toHaveAttribute('data-demo', 'true');
        await expect(demoToggle(page, instance)).toHaveAttribute('aria-pressed', 'true');
        if (instance === 'password')
            await expect(panel(page, instance).locator('.lock-event-demo-record')).toHaveCount(16);
        else {
            await expect(panel(page, instance).locator('.template-demo-card')).toHaveCount(4);
            await expect(previewWindow(page, instance).locator('.device-demo-count')).toHaveText(
                '已提交 1/4',
            );
            await expect(panel(page, instance).locator('.template-demo-details')).toHaveCount(1);
            await expect(
                panel(page, instance).locator('[data-demo-app="DEMO-TEMPLATE-A"]'),
            ).toHaveAttribute('data-status', 'submitted');
            await expect(
                panel(page, instance).locator('.template-demo-submission-field'),
            ).toHaveCount(2);
        }
        await expect(panel(page, instance)).toContainText('合成测试数据 · 非设备记录');
        await expectNoDownload(page, instance);
        return;
    }
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
    if ((await demoToggle(page, instance).getAttribute('aria-pressed')) !== 'true') {
        // Real focusin raises the right-aligned window before a pointer action.
        await demoToggle(page, instance).focus();
        await demoToggle(page, instance).click();
    }
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
    const requests = [];
    const frames = [];
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
                if (message.type !== 'ping') frames.push(message);
                if (message.type === 'command') commands.push(message);
            } catch {
                // Non-JSON heartbeat frames are not device commands.
            }
        });
    });
    page.on('pageerror', (error) => errors.push(error.message));
    page.on('download', (download) => downloads.push(download.suggestedFilename()));
    return { mutations, external, commands, errors, downloads, requests, frames };
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

test('fixed panels keep honest empty API data while sample lock and injection-match shortcuts default to synthetic fixtures', async ({
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
        '已提交 1/4',
    );
    await expect(panel(page, 'quick').locator('.template-demo-card')).toHaveCount(4);
    await demoToggle(page, 'password').click();
    await expectDefault(page, 'password', false);
    await expect(panel(page, 'quick').locator('.template-demo')).toBeVisible();
    await demoToggle(page, 'quick').click();
    await expectDefault(page, 'quick', false);
    const after = await (await page.request.get('/api/devices/1/ui-preview/password')).json();
    expect(after.items).toEqual([]);
    expect(after.total).toBe(0);
    expectNoExecution(observation);
    console.log(
        'DEVICE_PANEL_DEMO_DEFAULT PASS: real GET empty/not_connected; sample password16/quick4 matchedregistry rows afterverifiedGET; 16 events/match4-of-6 samples; no download button/anchor in either mode; POST/WS commands/external/downloads=0',
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
    const actions = ['一键解锁', 'V2解锁'];
    const description = '固定假数据 · 仅本地界面演示';
    const actionDescriptionIds = [];
    for (const action of actions) {
        const button = demo.getByRole('button', { name: action, exact: true });
        await expect(button).toHaveText(action);
        await expect(button).toHaveAttribute('aria-label', action);
        await expect(button).toHaveAccessibleDescription(description);
        const describedBy = await button.getAttribute('aria-describedby');
        expect(describedBy).toBeTruthy();
        const descriptionIds = describedBy.trim().split(/\s+/);
        expect(descriptionIds).toHaveLength(1);
        actionDescriptionIds.push(descriptionIds[0]);
        const descriptionNode = page.locator(`[id="${descriptionIds[0]}"]`);
        await expect(descriptionNode).toHaveCount(1);
        await expect(descriptionNode).toHaveClass(/lock-event-demo-footnote/);
        await expect(descriptionNode).toHaveText(description);
    }
    expect(new Set(actionDescriptionIds).size).toBe(1);
    await expect(page.locator('.device-topbar')).toContainText('WS · 已连接');
    const requestsBeforeActions = observation.requests.slice();
    const framesBeforeActions = observation.frames.slice();
    const expectSelectedActionFeedback = async (record) => {
        const displayValue = record.pattern?.length
            ? record.pattern.join(' → ')
            : record.sampleValue;
        await expect(row(record.id)).toHaveAttribute('aria-pressed', 'true');
        for (const action of actions) {
            const button = demo.getByRole('button', { name: action, exact: true });
            await button.focus();
            await page.keyboard.press('Enter');
            await expect(demo.getByRole('status')).toHaveText(
                `${action}：已选中「${record.label} · ${displayValue}」合成样例；仅本地演示，未下发设备指令。`,
            );
            expect(observation.requests).toEqual(requestsBeforeActions);
            expect(observation.frames).toEqual(framesBeforeActions);
        }
    };
    expect(fixture.lockEvents[0].sampleValue).toBe('000000');
    await expectSelectedActionFeedback(fixture.lockEvents[0]);
    for (const [category, label, count, selectedId] of [
        ['all', '全部', 16, 'DEMO-EVENT-01'],
        ['system', '系统', 12, 'DEMO-EVENT-01'],
        ['scenario', '假锁', 1, 'DEMO-EVENT-13'],
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
    await expect(row(selected.id).locator('.lock-event-demo-value strong')).toHaveText(
        selected.pattern?.length ? selected.pattern.join(' → ') : selected.sampleValue,
    );
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
    expect(JSON.parse(copied[0])).toEqual(copyEnvelope(selected));
    await expect(demo.getByRole('textbox', { name: '样例复制内容', exact: true })).toHaveCount(0);
    await expectSelectedActionFeedback(selected);
    await tab('app').click();
    await expect(demo.getByRole('status')).toHaveCount(0);
    await expectSelectedActionFeedback(
        fixture.lockEvents.find((record) => record.id === 'DEMO-EVENT-14'),
    );
    await tab('scenario').click();
    await expect(demo.getByRole('status')).toHaveCount(0);
    await expectSelectedActionFeedback(
        fixture.lockEvents.find((record) => record.id === 'DEMO-EVENT-13'),
    );
    await tab('all').click();
    await expect(demo.getByRole('status')).toHaveCount(0);
    await expect(demo.locator('.lock-event-demo-record')).toHaveCount(16);
    expect(observation.requests).toEqual(requestsBeforeActions);
    expect(observation.frames).toEqual(framesBeforeActions);
    expectNoExecution(observation);
    console.log(
        'DEVICE_PANEL_DEMO_LOCK PASS: tabs16/12/1/3; single keyboard selection; exact nine-point fixture; clipboard writeText probe receives synthetic-only JSON; exact一键解锁/V2解锁 visible+aria names/describedfixedfakeUI; selected000000/patternsequence/APP111111/DEMO-sample localfeedback; actionHTTP/nonheartbeatWSframes=0; POST/WS commands/external=0',
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
    expect(JSON.parse(await fallback.inputValue())).toEqual(copyEnvelope(fixture.lockEvents[0]));
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

test('matched injection submissions render only fixed typed password and PIN fake data and keep all shortcut actions local', async ({
    page,
}) => {
    const observation = observe(page);
    await login(page);
    observation.mutations.length = 0;
    const before = await (await page.request.get('/api/devices/1')).json();
    await openDetail(page);
    await openPanel(page, 'quick');
    await expectDefault(page, 'quick');
    const demo = panel(page, 'quick').locator('.template-demo');
    const app = (id) => demo.locator(`.template-demo-card[data-demo-app="${id}"]`);
    const count = previewWindow(page, 'quick').locator('.device-demo-count');
    expect(submissionResult).toMatchObject({
        valid: true,
        protocol: 'mtx-injection-match-demo/v1',
        registryCount: 6,
        installedCount: 6,
        matchedCount: 4,
        submissionProtocol: 'mtx-injection-submission-demo/v1',
        submittedCount: 1,
    });
    expect(matchedApplications.map((item) => item.id)).toEqual([
        'DEMO-TEMPLATE-A',
        'DEMO-TEMPLATE-B',
        'DEMO-TEMPLATE-C',
        'DEMO-TEMPLATE-D',
    ]);
    await expect(demo).toHaveAttribute('data-protocol', 'mtx-injection-match-demo/v1');
    await expect(demo).toHaveAttribute(
        'data-submission-protocol',
        'mtx-injection-submission-demo/v1',
    );
    await expect(demo.locator('.template-demo-match-summary')).toHaveText(
        '全局 6 · 已安装 6 · 匹配 4',
    );
    expect(
        await demo
            .locator('.template-demo-card')
            .evaluateAll((cards) => cards.map((card) => card.dataset.demoApp)),
    ).toEqual(matchedApplications.map((item) => item.id));
    for (const item of matchedApplications) {
        await expect(app(item.id)).toHaveAttribute('data-package', item.packageName);
        await expect(app(item.id)).toHaveAttribute('data-synthetic', 'true');
        await expect(app(item.id)).toHaveAttribute('data-status', item.status);
        await expect(app(item.id).locator('.template-demo-badge')).toHaveText(
            item.status === 'submitted'
                ? '已提交 (示例)'
                : item.skip
                  ? '已跳过 (示例)'
                  : '已注入 (示例)',
        );
        const submitted = item.status === 'submitted';
        await expect(app(item.id).locator('.template-demo-details')).toHaveCount(submitted ? 1 : 0);
        await expect(
            app(item.id).getByRole('button', { name: `打开 ${item.name} 合成详情`, exact: true }),
        ).toHaveAttribute('aria-expanded', String(submitted));
        const checkbox = app(item.id).getByRole('checkbox', {
            name: `跳过 ${item.name} 本地示例`,
            exact: true,
        });
        if (item.skip) await expect(checkbox).toBeChecked();
        else await expect(checkbox).not.toBeChecked();
    }
    for (const excluded of ['DEMO-TEMPLATE-E', 'DEMO-TEMPLATE-F'])
        await expect(app(excluded)).toHaveCount(0);
    await expect(demo.locator('[data-package="dev.mtx.demo.unlisted.g"]')).toHaveCount(0);
    const [first, , , fourth] = matchedApplications;
    const firstCard = app(first.id);
    const firstSkip = firstCard.getByRole('checkbox', {
        name: `跳过 ${first.name} 本地示例`,
        exact: true,
    });
    const firstOpen = firstCard.getByRole('button', {
        name: `打开 ${first.name} 合成详情`,
        exact: true,
    });
    const assertSubmission = async () => {
        await expect(firstCard).toHaveAttribute('data-status', 'submitted');
        await expect(firstCard).toHaveAttribute('data-submission-id', 'DEMO-SUBMISSION-A');
        await expect(firstCard).toHaveClass(/is-submitted/);
        await expect(firstCard.locator('.template-demo-details')).toBeVisible();
        await expect(firstCard.locator('.template-demo-submission-details')).toHaveAccessibleName(
            '注入内容（合成示例）',
        );
        await expect(firstCard.locator('.template-demo-submission-details')).toHaveAttribute(
            'data-submission',
            'true',
        );
        await expect(firstCard.locator('.template-demo-submission-field')).toHaveCount(2);
        for (const [kind, label] of [
            ['password', '密码'],
            ['pin', 'PIN'],
        ]) {
            const field = firstCard.locator(
                `.template-demo-submission-field[data-field-kind="${kind}"]`,
            );
            await expect(field).toHaveAttribute('data-kind', kind);
            await expect(field.locator('dt')).toHaveText(`${label}：`);
            await expect(field.locator('.template-demo-sample-value')).toHaveText('000000');
        }
        await expect(firstCard.locator('.template-demo-submission-time')).toHaveAttribute(
            'datetime',
            '2026-01-01T09:40:00Z',
        );
        await expect(firstCard.locator('.template-demo-submission-time')).toHaveText(
            '01/01 09:40:00',
        );
        await expect(count).toHaveText('已提交 1/4');
    };
    await assertSubmission();
    await expect(page.locator('.device-topbar')).toContainText('WS · 已连接');
    const requestsBeforeActions = observation.requests.slice();
    const framesBeforeActions = observation.frames.slice();
    await firstSkip.focus();
    await page.keyboard.press('Space');
    await expect(firstSkip).toBeChecked();
    await expect(firstCard).toHaveAttribute('data-status', 'skipped');
    await expect(firstCard.locator('.template-demo-submission-field')).toHaveCount(0);
    await expect(count).toHaveText('已提交 0/4');
    await expect(demo.getByRole('status')).toHaveText(
        `「${first.name}」已跳过本地示例；未下发设备指令。`,
    );
    await firstSkip.focus();
    await page.keyboard.press('Space');
    await expect(firstSkip).not.toBeChecked();
    await assertSubmission();
    await expect(demo.getByRole('status')).toHaveText(
        `「${first.name}」已取消跳过本地示例；未下发设备指令。`,
    );
    await firstOpen.focus();
    await page.keyboard.press('Enter');
    await assertSubmission();
    await expect(firstCard.locator('.template-demo-package')).toHaveText(first.packageName);
    await expect(demo.getByRole('status')).toHaveText(
        `已展开「${first.name}」的合成详情；未启动外部应用。`,
    );
    await firstSkip.check();
    await firstCard
        .getByRole('button', { name: `重置 ${first.name} 本地预览`, exact: true })
        .click();
    await expect(firstSkip).not.toBeChecked();
    await expect(firstOpen).toHaveAttribute('aria-expanded', 'true');
    await assertSubmission();
    const skip = app(fourth.id).getByRole('checkbox', {
        name: `跳过 ${fourth.name} 本地示例`,
        exact: true,
    });
    await skip.focus();
    await page.keyboard.press('Space');
    await expect(skip).toBeChecked();
    await expect(app(fourth.id)).toHaveAttribute('data-status', 'skipped');
    await expect(count).toHaveText('已提交 1/4');
    const open = app(fourth.id).getByRole('button', {
        name: `打开 ${fourth.name} 合成详情`,
        exact: true,
    });
    await open.focus();
    await page.keyboard.press('Enter');
    await expect(open).toHaveAttribute('aria-expanded', 'true');
    await expect(app(fourth.id).locator('.template-demo-package')).toHaveText(fourth.packageName);
    await expect(app(fourth.id).locator('.template-demo-fields dd')).toHaveText([
        'DEMO-D001',
        'DEMO-D002',
    ]);
    await expect(app(fourth.id).locator('.template-demo-submission-field')).toHaveCount(0);
    await app(fourth.id)
        .getByRole('button', { name: `重置 ${fourth.name} 本地预览`, exact: true })
        .click();
    await expect(skip).not.toBeChecked();
    await expect(app(fourth.id)).toHaveAttribute('data-status', 'injected');
    await expect(open).toHaveAttribute('aria-expanded', 'false');
    await expect(app(fourth.id).locator('.template-demo-details')).toHaveCount(0);
    await firstSkip.check();
    await skip.check();
    await open.click();
    await previewWindow(page, 'quick')
        .getByRole('button', { name: '重置测试数据', exact: true })
        .click();
    await expect(skip).not.toBeChecked();
    await expect(open).toHaveAttribute('aria-expanded', 'false');
    await expect(panel(page, 'quick').locator('.template-demo-details')).toHaveCount(1);
    await assertSubmission();
    await expect(panel(page, 'quick').locator('.device-demo-feedback')).toHaveText(
        '测试数据已恢复；未执行设备操作。',
    );
    expect(observation.requests).toEqual(requestsBeforeActions);
    expect(observation.frames).toEqual(framesBeforeActions);
    await expectNoDownload(page, 'quick');
    const after = await (await page.request.get('/api/devices/1')).json();
    expect(after.device).toEqual(before.device);
    expect(after.snapshots).toEqual(before.snapshots);
    expect(after.events).toEqual(before.events);
    expectNoExecution(observation);
    console.log(
        'DEVICE_PANEL_DEMO_SUBMISSION PASS: exactA-D intersection/6registry/6installed; A submittedgreen/default-expanded typedpassword/PIN000000 UTC01/01 09:40:00; dynamiccount1/4→0/4→1/4; localskip/unskip/itemreset/allreset preservefixedfixture; DgenericDEMO-D001/2 unchanged; localHTTP/nonheartbeatWSframes=0, no device/history/event mutations/commands/external/downloads',
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
    const second = matchedApplications[3];
    const skip = panel(page, 'quick').getByRole('checkbox', {
        name: `跳过 ${second.name} 本地示例`,
        exact: true,
    });
    await skip.check();
    await demoToggle(page, 'password').click();
    await expectDefault(page, 'password', false);
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
    const quickClose = previewWindow(page, 'quick').getByRole('button', {
        name: '关闭注入应用快捷',
        exact: true,
    });
    // Both windows are right-aligned; keyboard focus activates the obscured
    // shortcut window through its real focusin handler before pointer closing.
    await quickClose.focus();
    await expect(quickClose).toBeFocused();
    await expect(previewWindow(page, 'quick')).toHaveCSS('z-index', '91');
    await expect(previewWindow(page, 'password')).toHaveCSS('z-index', '90');
    await quickClose.click();
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
    await expect(panel(page, 'quick').locator('.template-demo-card')).toHaveCount(4);
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
        'DEVICE_PANEL_DEMO_RESET PASS: independent opt-in/selection; keyboard focus switches active window and Escape closes only focused window in both directions with own opener restored; close/reopen recomputes sample password true/quick true; other window local state retained; device route/account logout-login reset; only two explicit auth POSTs, device mutations/WS commands/external=0',
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
                await expect(previewWindow(page, instance)).toHaveCSS(
                    'top',
                    instance === 'password' ? '62px' : '360px',
                );
                await expect(previewWindow(page, instance).locator('.viewer-width')).toHaveCount(0);
            }
            const submitted = panel(page, 'quick').locator(
                '.template-demo-card[data-demo-app="DEMO-TEMPLATE-A"][data-status="submitted"]',
            );
            const inset = submitted.locator('.template-demo-submission-details');
            const badge = submitted.locator('.template-demo-badge');
            await expect(submitted).toHaveCSS(
                'background-color',
                theme === 'dark' ? 'rgb(29, 48, 44)' : 'rgb(243, 250, 247)',
            );
            await expect(inset).toHaveCSS(
                'background-color',
                theme === 'dark' ? 'rgb(28, 53, 46)' : 'rgb(237, 248, 243)',
            );
            await expect(badge).toHaveCSS(
                'color',
                theme === 'dark' ? 'rgb(104, 218, 178)' : 'rgb(0, 155, 112)',
            );
            if (theme === 'dark') {
                const badgeBackground = await badge.evaluate(
                    (element) => getComputedStyle(element).backgroundColor,
                );
                const rgb = /^rgb\((\d+), (\d+), (\d+)\)$/.exec(badgeBackground);
                expect(rgb, 'submitted dark badge has an opaque RGB background').not.toBeNull();
                const [red, green, blue] = rgb.slice(1).map(Number);
                expect(Math.max(red, green, blue)).toBeLessThan(100);
                expect(
                    green,
                    'submitted badge remains green instead of default blue',
                ).toBeGreaterThan(red);
                expect(
                    green,
                    'submitted badge remains green instead of default blue',
                ).toBeGreaterThan(blue);
            } else {
                await expect(badge).toHaveCSS('background-color', 'rgb(237, 248, 243)');
            }
            await expect(previewWindow(page, 'password')).toHaveCSS(
                'left',
                `${Math.max(1280, width) - 492}px`,
            );
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
            expect(boxes.password.x).toBeCloseTo(boxes.quick.x, 1);
            expect(boxes.quick.y - boxes.password.y).toBeCloseTo(298, 1);
            const passwordPosition = await previewWindow(page, 'password').evaluate((element) => ({
                left: parseFloat(getComputedStyle(element).left),
                top: parseFloat(getComputedStyle(element).top),
                width: element.getBoundingClientRect().width,
                canvas: Math.max(1280, innerWidth),
            }));
            expect(passwordPosition.canvas - passwordPosition.left - passwordPosition.width).toBe(
                192,
            );
            expect(passwordPosition.top).toBe(62);
            expect(passwordPosition.left).toBeGreaterThanOrEqual(0);
            expect(passwordPosition.left + passwordPosition.width).toBeLessThanOrEqual(
                passwordPosition.canvas,
            );
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
                await expect(previewWindow(page, 'password')).toHaveCSS(
                    'left',
                    `${Math.max(1280, width) - 492}px`,
                );
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
        'DEVICE_PANEL_DEMO_GEOMETRY PASS: light/dark1440/1280/800; submittedcard/inset exactthemebackgrounds/greenbadgecolor/darkbadgeopaque-darkgreen; width300/radius14; password right192/top62 andquick right192/top360; narrow1280canvaspositionsclamped; all header button/count bounds inside own300px window; togglefont9/reset22pxfont13; no internal horizontal overflow; minimum1280/settled horizontal scroll360/fixedleft110; portable screenshots; POST/WS commands/external=0',
    );
});

test('lock-password and shortcut defaults are limited to verified sample devices and context replacement clears prior choices', async ({
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
    for (const otherSource of ['api', 'import', 'unknown', '']) {
        source = otherSource;
        await openDetail(page);
        await openPanel(page, 'password');
        await expectDefault(page, 'password', false);
        await openPanel(page, 'quick');
        await expectDefault(page, 'quick', false);
    }
    await enableDemo(page, 'password');
    await expectDefault(page, 'password');
    await expectDefault(page, 'quick', false);
    await enableDemo(page, 'quick');
    await expectDefault(page, 'quick');
    source = 'sample';
    await openDetail(page);
    await openPanel(page, 'password');
    await expectDefault(page, 'password');
    await demoToggle(page, 'password').click();
    await expectDefault(page, 'password', false);
    await topToggle(page, 'password').uncheck();
    await openPanel(page, 'password');
    await expectDefault(page, 'password');
    const fixturePattern = fixture.lockEvents.find((item) => item.id === 'DEMO-EVENT-02');
    await expect(
        panel(page, 'password').locator(
            `[data-record-id="${fixturePattern.id}"] .lock-event-demo-value strong`,
        ),
    ).toHaveText(fixturePattern.pattern.join(' → '));
    await expect(
        panel(page, 'password').locator(
            '[data-record-id="DEMO-EVENT-01"] .lock-event-demo-value strong',
        ),
    ).toHaveText('000000');
    await expect(
        panel(page, 'password').locator(
            '[data-record-id="DEMO-EVENT-04"] .lock-event-demo-value strong',
        ),
    ).toHaveText('pattern');
    await panel(page, 'password').locator('.lock-event-demo-tab[data-category="app"]').click();
    await openDetail(page, 2);
    await openPanel(page, 'password');
    await expectDefault(page, 'password');
    await expect(
        panel(page, 'password').locator('.lock-event-demo-tab[data-category="all"]'),
    ).toHaveAttribute('aria-pressed', 'true');
    await openPanel(page, 'quick');
    await expectDefault(page, 'quick');
    expectNoExecution(observation);
    console.log(
        'DEVICE_LOCK_SOURCE PASS: only sample source auto-shows16 after verifiedGET; api/import/unknown/empty source0 then explicitoptin16; quick sampledefault4/otherexplicitoptin4; fixed pattern/000000 and patternsequence remain markedfixture; reopen/devicechange resets selection/choice; no device mutations',
    );
});

test('lock-password preview gates pending, invalid and unauthenticated reads and cancels stale device responses before revealing fixtures', async ({
    page,
}) => {
    const observation = observe(page);
    await login(page);
    observation.mutations.length = 0;
    await openDetail(page);
    const endpoint = '**/api/devices/1/ui-preview/password';
    const valid = await (await page.request.get('/api/devices/1/ui-preview/password')).json();
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
                .fulfill({ status: 500, json: { error: 'DEMO-LOCK-GET-FAILED' } })
                .catch(() => {});
        },
        { times: 1 },
    );
    try {
        await topToggle(page, 'password').check();
        await expect.poll(() => started).toBe(1);
        await expect(panel(page, 'password')).toHaveAttribute('aria-busy', 'true');
        await expect(panel(page, 'password')).toHaveAttribute('data-demo', 'false');
        await expect(panel(page, 'password').locator('.lock-event-demo-record')).toHaveCount(0);
        await expect(demoToggle(page, 'password')).toBeDisabled();
        release();
        await expect(panel(page, 'password').getByRole('alert')).toContainText(
            'DEMO-LOCK-GET-FAILED',
        );
        await expect(demoToggle(page, 'password')).toBeDisabled();
        await panel(page, 'password')
            .getByRole('button', { name: '重试预览', exact: true })
            .click();
        await expectDefault(page, 'password');
    } finally {
        release();
        await page.unroute(endpoint);
    }
    for (const invalid of [
        { ...valid, deviceId: 2 },
        { ...valid, section: { id: 'templates' } },
        { ...valid, items: [{ sampleValue: 'DEMO-REJECTED-REMOTE' }], total: 1 },
        { ...valid, implemented: true, state: 'connected' },
    ]) {
        await topToggle(page, 'password').uncheck();
        await page.route(endpoint, (route) => route.fulfill({ status: 200, json: invalid }), {
            times: 1,
        });
        await topToggle(page, 'password').check();
        await expect(panel(page, 'password')).toHaveAttribute('aria-busy', 'false');
        await expect(panel(page, 'password').getByRole('alert')).toContainText(
            '预览接口状态不符合当前约定，请重试。',
        );
        await expect(panel(page, 'password')).toHaveAttribute('data-demo', 'false');
        await expect(panel(page, 'password').locator('.lock-event-demo-record')).toHaveCount(0);
        await expect(panel(page, 'password')).not.toContainText('DEMO-REJECTED-REMOTE');
        await expect(demoToggle(page, 'password')).toBeDisabled();
        await panel(page, 'password')
            .getByRole('button', { name: '重试预览', exact: true })
            .click();
        await expectDefault(page, 'password');
    }
    await topToggle(page, 'password').uncheck();
    let releaseLate;
    let lateStarted = 0;
    const lateGate = new Promise((resolve) => {
        releaseLate = resolve;
    });
    await page.route(endpoint, async (route) => {
        lateStarted++;
        await lateGate;
        await route
            .fulfill({ status: 500, json: { error: 'DEMO-LOCK-OLD-DEVICE' } })
            .catch(() => {});
    });
    try {
        await topToggle(page, 'password').check();
        await expect.poll(() => lateStarted).toBe(1);
        await expect(panel(page, 'password')).toHaveAttribute('aria-busy', 'true');
        await openDetail(page, 2);
        await expect(panel(page, 'password')).toHaveCount(0);
        await openPanel(page, 'password');
        await expectDefault(page, 'password');
        releaseLate();
        await expect(panel(page, 'password')).not.toContainText('DEMO-LOCK-OLD-DEVICE');
    } finally {
        releaseLate();
        await page.unroute(endpoint);
    }
    await openDetail(page);
    await page.route(
        endpoint,
        (route) => route.fulfill({ status: 401, json: { error: 'DEMO-LOCK-AUTH-EXPIRED' } }),
        { times: 1 },
    );
    await topToggle(page, 'password').check();
    await expect(page).toHaveURL('/login');
    await expect(panel(page, 'password')).toHaveCount(0);
    const logout = await page.evaluate(async () => {
        const response = await fetch('/api/auth/logout', {
            method: 'POST',
            headers: { 'X-Boundary-Request': '1', 'Content-Type': 'application/json' },
            body: '{}',
            credentials: 'same-origin',
        });
        return { status: response.status, body: await response.json() };
    });
    expect(logout).toEqual({ status: 200, body: { success: true } });
    await login(page);
    await openDetail(page);
    await openPanel(page, 'password');
    await expectDefault(page, 'password');
    await openPanel(page, 'quick');
    await expectDefault(page, 'quick');
    expectNoExecution(observation, true);
    console.log(
        'DEVICE_LOCK_AUTH_GATE PASS: pending/500/wrong-device/wrong-section/nonempty/implemented reads hide all16 anddisabletoggle; retryverifiedGET restores16; staleolddeviceGETaborted; 401removesview andfreshloginresetscontext; shortcutfreshsampledefault4; onlyauthPOSTs',
    );
});

test('typed synthetic password protocol defaults to the fixed fake PIN and copies only the marked fixture envelope', async ({
    page,
}) => {
    await installClipboardProbe(page);
    const observation = observe(page);
    await login(page);
    observation.mutations.length = 0;
    const before = await (await page.request.get('/api/devices/1')).json();
    await openDetail(page);
    await openPanel(page, 'password');
    await expectDefault(page, 'password');
    const demo = panel(page, 'password').locator('.lock-event-demo');
    const row = (id) => demo.locator(`.lock-event-demo-record[data-record-id="${id}"]`);
    const first = fixture.lockEvents[0];
    expect(fixture).toMatchObject({
        protocol: 'mtx-ui-demo/v1',
        schemaVersion: 1,
        source: 'synthetic-ui-fixture',
        fixtureOnly: true,
    });
    expect(first).toMatchObject({
        id: 'DEMO-EVENT-01',
        category: 'system',
        label: '系统PIN',
        sampleValue: '000000',
        valueType: 'pin',
        synthetic: true,
    });
    await expect(row(first.id)).toHaveAttribute('aria-pressed', 'true');
    await expect(demo.locator('.lock-event-demo-record[aria-pressed="true"]')).toHaveCount(1);
    const pins = [
        ['DEMO-EVENT-01', '000000'],
        ['DEMO-EVENT-14', '111111'],
        ['DEMO-EVENT-15', '222222'],
        ['DEMO-EVENT-16', '333333'],
    ];
    for (const [id, value] of pins) {
        await expect(row(id).locator('.lock-event-demo-value strong')).toHaveText(value);
        await expect(row(id).locator('.lock-event-demo-pattern')).toHaveCount(0);
        expect(fixture.lockEvents.find((item) => item.id === id)).toMatchObject({
            valueType: 'pin',
            synthetic: true,
            sampleValue: value,
        });
    }
    const displayedNumeric = await demo
        .locator('.lock-event-demo-value strong')
        .evaluateAll((items) =>
            items.map((item) => item.textContent.trim()).filter((value) => /^\d+$/.test(value)),
        );
    expect(displayedNumeric).toEqual(pins.map(([, value]) => value));
    await demo.locator('.lock-event-demo-copy').click();
    const firstCopy = await page.evaluate(() => window.__mtxDemoClipboard);
    expect(firstCopy).toHaveLength(1);
    expect(JSON.parse(firstCopy[0])).toEqual(copyEnvelope(first));
    const pattern = fixture.lockEvents.find((item) => item.id === 'DEMO-EVENT-03');
    expect(pattern).toMatchObject({ valueType: 'pattern', synthetic: true, pattern: [2, 5, 8, 9] });
    await row(pattern.id).focus();
    await page.keyboard.press('Enter');
    await expect(row(pattern.id)).toHaveAttribute('aria-pressed', 'true');
    await expect(row(pattern.id).locator('.lock-event-demo-value strong')).toHaveText(
        '2 → 5 → 8 → 9',
    );
    await expect(row(pattern.id).locator('.lock-event-demo-pattern i')).toHaveCount(9);
    expect(
        await row(pattern.id)
            .locator('.lock-event-demo-pattern i')
            .evaluateAll((dots) =>
                dots.flatMap((dot, index) => (dot.classList.contains('lit') ? [index + 1] : [])),
            ),
    ).toEqual(pattern.pattern);
    await demo.locator('.lock-event-demo-copy').click();
    const allCopies = await page.evaluate(() => window.__mtxDemoClipboard);
    expect(allCopies).toHaveLength(2);
    expect(JSON.parse(allCopies[1])).toEqual(copyEnvelope(pattern));
    for (const payload of allCopies) {
        expect(JSON.parse(payload)).toMatchObject({
            protocol: 'mtx-ui-demo/v1',
            schemaVersion: 1,
            fixtureOnly: true,
            synthetic: true,
        });
        expect(JSON.parse(payload).source).toMatch(/^dev\.mtx\.demo\./);
    }
    expect(await (await page.request.get('/api/devices/1')).json()).toEqual(before);
    expectNoExecution(observation);
    console.log(
        'DEVICE_TYPED_PASSWORD_PROTOCOL PASS: defaultselected01/fixedPIN000000; APP111111222222333333 onlyfourliteralnumericfixtures; type/pattern/sample enumtyped;03exactninegrid2-5-8-9; clipboardprotocolmtx-ui-demo/v1/schema1/fixtureOnly/synthetic markers; deviceunchanged; noPOST/commands/external/downloads',
    );
});

test('matched shortcut fixtures require strict authenticated reads and discard pending failures and late prior-device responses', async ({
    page,
}) => {
    const observation = observe(page);
    await login(page);
    observation.mutations.length = 0;
    await openDetail(page);
    const endpoint = '**/api/devices/1/ui-preview/templates';
    const valid = await (await page.request.get('/api/devices/1/ui-preview/templates')).json();
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
                .fulfill({ status: 500, json: { error: 'DEMO-MATCH-GET-FAILED' } })
                .catch(() => {});
        },
        { times: 1 },
    );
    try {
        await topToggle(page, 'quick').check();
        await expect.poll(() => started).toBe(1);
        await expect(panel(page, 'quick')).toHaveAttribute('aria-busy', 'true');
        await expect(panel(page, 'quick')).toHaveAttribute('data-demo', 'false');
        await expect(panel(page, 'quick').locator('.template-demo-card')).toHaveCount(0);
        await expect(demoToggle(page, 'quick')).toBeDisabled();
        release();
        await expect(panel(page, 'quick').getByRole('alert')).toContainText(
            'DEMO-MATCH-GET-FAILED',
        );
        await expect(demoToggle(page, 'quick')).toBeDisabled();
        await panel(page, 'quick').getByRole('button', { name: '重试预览', exact: true }).click();
        await expectDefault(page, 'quick');
    } finally {
        release();
        await page.unroute(endpoint);
    }
    for (const invalid of [
        { ...valid, deviceId: 2 },
        { ...valid, section: { id: 'password' } },
        { ...valid, items: [{ packageName: 'DEMO-REJECTED-REMOTE' }], total: 1 },
        { ...valid, total: 1 },
        { ...valid, implemented: true, state: 'connected' },
    ]) {
        await topToggle(page, 'quick').uncheck();
        await page.route(endpoint, (route) => route.fulfill({ status: 200, json: invalid }), {
            times: 1,
        });
        await topToggle(page, 'quick').check();
        await expect(panel(page, 'quick')).toHaveAttribute('aria-busy', 'false');
        await expect(panel(page, 'quick').getByRole('alert')).toContainText(
            '预览接口状态不符合当前约定，请重试。',
        );
        await expect(panel(page, 'quick')).toHaveAttribute('data-demo', 'false');
        await expect(panel(page, 'quick').locator('.template-demo-card')).toHaveCount(0);
        await expect(panel(page, 'quick')).not.toContainText('DEMO-REJECTED-REMOTE');
        await expect(demoToggle(page, 'quick')).toBeDisabled();
        await panel(page, 'quick').getByRole('button', { name: '重试预览', exact: true }).click();
        await expectDefault(page, 'quick');
    }
    await topToggle(page, 'quick').uncheck();
    let releaseLate;
    let lateStarted = 0;
    const lateGate = new Promise((resolve) => {
        releaseLate = resolve;
    });
    await page.route(endpoint, async (route) => {
        lateStarted++;
        await lateGate;
        await route
            .fulfill({ status: 500, json: { error: 'DEMO-MATCH-OLD-DEVICE' } })
            .catch(() => {});
    });
    try {
        await topToggle(page, 'quick').check();
        await expect.poll(() => lateStarted).toBe(1);
        await expect(panel(page, 'quick')).toHaveAttribute('aria-busy', 'true');
        await openDetail(page, 2);
        await expect(panel(page, 'quick')).toHaveCount(0);
        await openPanel(page, 'quick');
        await expectDefault(page, 'quick');
        releaseLate();
        await expect(panel(page, 'quick')).not.toContainText('DEMO-MATCH-OLD-DEVICE');
        await expect(panel(page, 'quick').locator('.template-demo-details')).toHaveCount(1);
    } finally {
        releaseLate();
        await page.unroute(endpoint);
    }
    await openDetail(page);
    await page.route(
        endpoint,
        (route) => route.fulfill({ status: 401, json: { error: 'DEMO-MATCH-AUTH-EXPIRED' } }),
        { times: 1 },
    );
    await topToggle(page, 'quick').check();
    await expect(page).toHaveURL('/login');
    await expect(panel(page, 'quick')).toHaveCount(0);
    const logout = await page.evaluate(async () => {
        const response = await fetch('/api/auth/logout', {
            method: 'POST',
            headers: { 'X-Boundary-Request': '1', 'Content-Type': 'application/json' },
            body: '{}',
            credentials: 'same-origin',
        });
        return { status: response.status, body: await response.json() };
    });
    expect(logout).toEqual({ status: 200, body: { success: true } });
    await login(page);
    await openDetail(page);
    await openPanel(page, 'quick');
    await expectDefault(page, 'quick');
    await openPanel(page, 'password');
    await expectDefault(page, 'password');
    expectNoExecution(observation, true);
    console.log(
        'DEVICE_MATCH_AUTH_GATE PASS: pending/500/wrongdevice/wrongsection/nonempty/nonzerototal/implemented hidesfixture; retry restoresdefaultsubmitted1/4/match4of6; lateolddeviceaborted/submittedArestored;401clearsbothpanels/freshloginresets; only explicit authPOSTs; no device command/external/downloads',
    );
});
