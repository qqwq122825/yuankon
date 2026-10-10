import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { readAppsPresentation } from '../../frontend/src/fixtures/apps-demo-presentation.js';

const load = async (name) =>
    JSON.parse(
        await readFile(new URL(`../../frontend/src/fixtures/${name}`, import.meta.url), 'utf8'),
    );
const fixtures = [
    await load('device-apps-demo.json'),
    await load('device-injection-match-demo.json'),
    await load('device-injection-submission-demo.json'),
];
const copy = () => structuredClone(fixtures);
const zeroCounts = {
    installed: 0,
    user: 0,
    system: 0,
    matched: 0,
    ordinary: 0,
    configured: 0,
    registry: 0,
    enabled: 0,
};
const counts = {
    installed: 8,
    user: 6,
    system: 2,
    matched: 4,
    ordinary: 2,
    configured: 1,
    registry: 6,
    enabled: 5,
};
const actionLabels = (application) => application.actions.map((action) => action.label);
function expectInvalid(input) {
    const result = readAppsPresentation(...input);
    assert.equal(result.valid, false);
    assert.deepEqual(result.applications, []);
    assert.deepEqual(result.configuredApplications, []);
    assert.deepEqual(result.counts, zeroCounts);
}
function freeze(value) {
    if (value !== null && typeof value === 'object') {
        Object.values(value).forEach(freeze);
        Object.freeze(value);
    }
    return value;
}

test('application presentation separates four matched targets, two ordinary apps, two systems and one configured-only row', () => {
    const result = readAppsPresentation(...fixtures);
    assert.equal(result.valid, true);
    assert.deepEqual(result.counts, counts);
    assert.deepEqual(
        result.applications.map((app) => app.id),
        fixtures[0].applications.map((app) => app.id),
    );
    assert.deepEqual(
        result.applications.map((app) => app.presentationGroup),
        ['target', 'target', 'target', 'target', 'ordinary', 'ordinary', 'system', 'system'],
    );
    assert.deepEqual(
        result.applications.map((app) => app.matchStatus),
        ['submitted', 'skipped', 'skipped', 'injected', 'sample', 'sample', 'sample', 'sample'],
    );
    assert.deepEqual(
        result.applications.map((app) => app.statusLabel),
        [
            '已提交 (示例)',
            '注入目标 (示例)',
            '注入目标 (示例)',
            '已注入 (示例)',
            '已安装 (示例)',
            '已安装 (示例)',
            '系统应用',
            '系统应用',
        ],
    );
    for (const [index, app] of result.applications.entries()) {
        for (const [key, value] of Object.entries(fixtures[0].applications[index]))
            assert.deepEqual(app[key], value, `${app.id}.${key}`);
        assert.deepEqual(
            actionLabels(app),
            index < 4
                ? [
                      '打开',
                      '弹窗',
                      '横幅',
                      '注入',
                      ...([0, 3].includes(index) ? ['重注'] : []),
                      '卸载',
                  ]
                : app.system
                  ? ['打开']
                  : ['打开', '卸载'],
        );
        assert.equal(new Set(app.actions.map((action) => action.id)).size, app.actions.length);
        for (const action of app.actions) {
            assert.deepEqual(Object.keys(action).sort(), ['id', 'label', 'tone']);
            assert.equal(typeof action.id, 'string');
            assert.equal(typeof action.tone, 'string');
            assert.ok(action.id.length > 0);
            assert.ok(action.tone.length > 0);
        }
    }
    assert.equal(result.configuredApplications.length, 1);
    assert.equal(result.configuredApplications[0].packageName, 'dev.mtx.demo.shop.e');
    assert.deepEqual(result.configuredApplications[0].actions, []);
    const targets = result.applications.filter((app) => app.presentationGroup === 'target');
    assert.ok(targets.every((app) => !app.system));
    assert.ok(
        targets.every(
            (app) =>
                !['dev.mtx.demo.helper.f', 'dev.mtx.demo.unlisted.g'].includes(app.packageName),
        ),
    );
});

test('application presentation does not mutate frozen fixtures and copies action objects for independent local results', () => {
    const input = freeze(copy());
    const before = structuredClone(input);
    const result = readAppsPresentation(...input);
    assert.equal(result.valid, true);
    assert.deepEqual(input, before);
    result.applications[0].name = '样例本地变更';
    result.applications[0].actions[0].label = '本地变更';
    result.applications[3].actions.reverse();
    result.configuredApplications[0].name = '样例本地变更';
    result.counts.matched = 0;
    assert.deepEqual(input, before);
    const next = readAppsPresentation(...input);
    assert.equal(next.applications[0].name, fixtures[0].applications[0].name);
    assert.deepEqual(actionLabels(next.applications[0]), [
        '打开',
        '弹窗',
        '横幅',
        '注入',
        '重注',
        '卸载',
    ]);
    assert.deepEqual(actionLabels(next.applications[3]), [
        '打开',
        '弹窗',
        '横幅',
        '注入',
        '重注',
        '卸载',
    ]);
    assert.deepEqual(next.counts, counts);
    assert.equal(next.configuredApplications[0].name, '样例商城 E');
});

test('application presentation rejects malformed fixture envelopes and rows as one empty result instead of partial actions', () => {
    for (const index of [0, 1, 2]) {
        for (const invalid of [null, [], {}, false, 'DEMO-NOT-A-FIXTURE']) {
            const input = copy();
            input[index] = invalid;
            expectInvalid(input);
        }
        for (const [key, value] of [
            ['protocol', `${fixtures[index].protocol}-unknown`],
            ['schemaVersion', 2],
            ['datasetId', 'DEMO-DEVICE-02'],
            ['source', 'device-report'],
            ['fixtureOnly', false],
        ]) {
            const input = copy();
            input[index][key] = value;
            expectInvalid(input);
        }
    }
    for (const [index, key] of [
        [0, 'applications'],
        [1, 'globalInjectionList'],
        [1, 'installedApplications'],
        [1, 'applicationStates'],
        [2, 'records'],
    ]) {
        for (const mutate of [
            (input) => {
                input[index][key] = {};
            },
            (input) => {
                input[index][key][0].synthetic = false;
            },
            (input) => {
                input[index][key].push(structuredClone(input[index][key][0]));
            },
            (input) => {
                input[index][key][0].packageName = 'com.example.not.synthetic';
            },
        ]) {
            const input = copy();
            mutate(input);
            expectInvalid(input);
        }
    }
});

test('application presentation requires exact installed-user membership and canonical package/name/initial associations', () => {
    for (const mutate of [
        (input) => {
            input[1].installedApplications.pop();
        },
        (input) => {
            input[1].installedApplications.push({
                id: 'DEMO-INSTALLED-X',
                packageName: 'dev.mtx.demo.extra.x',
                synthetic: true,
            });
        },
        (input) => {
            input[1].installedApplications[5].packageName = 'dev.mtx.demo.system.settings';
        },
        (input) => {
            input[0].applications[4].packageName = 'dev.mtx.demo.helper.ff';
        },
        (input) => {
            input[1].globalInjectionList[0].name = '样例名称不一致';
        },
        (input) => {
            input[1].globalInjectionList[0].initial = '错';
        },
        (input) => {
            input[1].globalInjectionList[5].name = '样例禁用名称不一致';
        },
        (input) => {
            input[2].records[0].packageName = 'dev.mtx.demo.wallet.b';
        },
        (input) => {
            input[2].records[0].applicationId = 'DEMO-TEMPLATE-B';
        },
        (input) => {
            input[2].records[0].applicationId = 'DEMO-TEMPLATE-E';
            input[2].records[0].packageName = 'dev.mtx.demo.shop.e';
        },
    ]) {
        const input = copy();
        mutate(input);
        expectInvalid(input);
    }
});

test('application presentation excludes installed system apps from targets even when an enabled global row names one', () => {
    const input = copy();
    const system = input[0].applications.find((app) => app.system);
    input[1].globalInjectionList.push({
        id: 'DEMO-TEMPLATE-SYSTEM',
        name: system.name,
        initial: system.initial,
        packageName: system.packageName,
        enabled: true,
        synthetic: true,
    });
    const result = readAppsPresentation(...input);
    assert.equal(result.valid, true);
    assert.deepEqual(result.counts, { ...counts, registry: 7, enabled: 6 });
    assert.equal(
        result.applications.find((app) => app.id === system.id).presentationGroup,
        'system',
    );
    assert.deepEqual(actionLabels(result.applications.find((app) => app.id === system.id)), [
        '打开',
    ]);
    assert.equal(result.configuredApplications.length, 1);
    assert.equal(result.configuredApplications[0].packageName, 'dev.mtx.demo.shop.e');
    assert.equal(result.applications.filter((app) => app.presentationGroup === 'target').length, 4);
});
