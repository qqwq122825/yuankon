import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
    INJECTION_DEMO_PROTOCOL,
    matchInjectionDemo,
} from '../../frontend/src/fixtures/injection-demo-match.js';

const fixture = JSON.parse(
    await readFile(
        new URL('../../frontend/src/fixtures/device-injection-match-demo.json', import.meta.url),
        'utf8',
    ),
);
const awaitLegacyFixtureText = await readFile(
    new URL('../../frontend/src/fixtures/device-ui-demo.json', import.meta.url),
    'utf8',
);

const copyFixture = () => structuredClone(fixture);
const invalidResult = {
    valid: false,
    protocol: 'mtx-injection-match-demo/v1',
    registryCount: 0,
    installedCount: 0,
    matchedCount: 0,
    applications: [],
};

test('injection match fixture renders the exact enabled global and installed synthetic package intersection', () => {
    assert.equal(INJECTION_DEMO_PROTOCOL, 'mtx-injection-match-demo/v1');
    assert.equal(fixture.protocol, INJECTION_DEMO_PROTOCOL);
    assert.equal(fixture.schemaVersion, 1);
    assert.equal(fixture.datasetId, 'DEMO-DEVICE-01');
    assert.equal(fixture.source, 'synthetic-ui-fixture');
    assert.equal(fixture.fixtureOnly, true);
    assert.equal(fixture.registryId, 'DEMO-REGISTRY-01');
    assert.equal(fixture.installedReportId, 'DEMO-INSTALLED-01');
    assert.equal(fixture.globalInjectionList.length, 6);
    assert.equal(fixture.installedApplications.length, 6);
    assert.equal(fixture.applicationStates.length, 6);
    assert.deepEqual(
        fixture.globalInjectionList.map((item) => item.enabled),
        [true, true, true, true, true, false],
    );
    for (const list of ['globalInjectionList', 'installedApplications', 'applicationStates']) {
        const items = fixture[list];
        assert.equal(new Set(items.map((item) => item.id)).size, items.length);
        assert.equal(new Set(items.map((item) => item.packageName)).size, items.length);
        for (const item of items) {
            assert.equal(item.synthetic, true);
            assert.match(item.id, /^DEMO-[A-Z0-9_-]+$/);
            assert.match(item.packageName, /^dev\.mtx\.demo\.[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)*$/);
        }
    }
    const result = matchInjectionDemo(fixture);
    assert.equal(result.valid, true);
    assert.equal(result.protocol, INJECTION_DEMO_PROTOCOL);
    assert.equal(result.registryCount, 6);
    assert.equal(result.installedCount, 6);
    assert.equal(result.matchedCount, 4);
    assert.deepEqual(
        result.applications.map((item) => item.id),
        ['DEMO-TEMPLATE-A', 'DEMO-TEMPLATE-B', 'DEMO-TEMPLATE-C', 'DEMO-TEMPLATE-D'],
    );
    assert.deepEqual(
        result.applications.map((item) => item.packageName),
        [
            'dev.mtx.demo.pay.a',
            'dev.mtx.demo.wallet.b',
            'dev.mtx.demo.bank.c',
            'dev.mtx.demo.app.d',
        ],
    );
    assert.deepEqual(
        result.applications.map((item) => item.status),
        ['skipped', 'skipped', 'skipped', 'injected'],
    );
    assert.deepEqual(
        result.applications.map((item) => item.skip),
        [true, true, true, false],
    );
    assert.ok(result.applications.every((item) => item.synthetic === true));
    assert.deepEqual(
        result.applications.slice(0, 3).map((item) => item.fields),
        [[], [], []],
    );
    assert.deepEqual(result.applications[3].fields, [
        { label: '测试字段 A', value: 'DEMO-D001' },
        { label: '测试字段 B', value: 'DEMO-D002' },
    ]);
    // Enabled E is absent from the installed report, F is installed but disabled,
    // and the installed unlisted G does not enter the global intersection.
    const excluded = ['dev.mtx.demo.shop.e', 'dev.mtx.demo.helper.f', 'dev.mtx.demo.unlisted.g'];
    assert.ok(result.applications.every((item) => !excluded.includes(item.packageName)));
    const legacy = JSON.parse(awaitLegacyFixtureText);
    assert.equal(legacy.applications.length, 2);
});

test('injection match validation rejects protocol, marker, namespace, duplicate and unmatched-state failures as an empty result', () => {
    for (const invalid of [
        null,
        [],
        {},
        { ...fixture, protocol: 'mtx-injection-match-demo/v2' },
        { ...fixture, schemaVersion: 2 },
        { ...fixture, datasetId: undefined },
        { ...fixture, datasetId: 'DEMO-DEVICE-02' },
        { ...fixture, datasetId: { id: 'DEMO-DEVICE-01' } },
        { ...fixture, source: 'device-report' },
        { ...fixture, fixtureOnly: false },
        { ...fixture, registryId: 'REGISTRY-01' },
        { ...fixture, installedReportId: 'INSTALLED-01' },
    ])
        assert.deepEqual(matchInjectionDemo(invalid), invalidResult);
    for (const list of ['globalInjectionList', 'installedApplications', 'applicationStates']) {
        for (const mutate of [
            (copy) => {
                delete copy[list];
            },
            (copy) => {
                copy[list] = {};
            },
            (copy) => {
                delete copy[list][0].synthetic;
            },
            (copy) => {
                copy[list][0].synthetic = false;
            },
            (copy) => {
                copy[list][0].id = 'REAL-ITEM';
            },
            (copy) => {
                copy[list][0].packageName = 'com.example.real.application';
            },
            (copy) => {
                copy[list][0].packageName = 'dev.mtx.demo';
            },
            (copy) => {
                copy[list][0].packageName = 'dev.mtx.demo.bad-package';
            },
            (copy) => {
                copy[list][1].id = copy[list][0].id;
            },
            (copy) => {
                copy[list][1].packageName = copy[list][0].packageName;
            },
            (copy) => {
                copy[list].push(structuredClone(copy[list][0]));
            },
        ]) {
            const invalid = copyFixture();
            mutate(invalid);
            assert.deepEqual(matchInjectionDemo(invalid), invalidResult, list);
        }
    }
    for (const mutate of [
        (copy) => {
            copy.globalInjectionList[0].enabled = 'true';
        },
        (copy) => {
            copy.globalInjectionList[0].name = '';
        },
        (copy) => {
            copy.globalInjectionList[0].name = 'Non-sample title';
        },
        (copy) => {
            copy.globalInjectionList[0].id = 'DEMO-' + 'A'.repeat(60);
        },
        (copy) => {
            copy.globalInjectionList[0].name = '样'.repeat(61);
        },
        (copy) => {
            copy.globalInjectionList[0].initial = 'ABC';
        },
        (copy) => {
            copy.applicationStates[0].status = 'connected';
        },
        (copy) => {
            copy.applicationStates[0].time = 'yesterday';
        },
        (copy) => {
            copy.applicationStates[3].fields[0].value = '2245';
        },
        (copy) => {
            copy.applicationStates[3].fields[0].label = '';
        },
        (copy) => {
            copy.applicationStates[3].fields[0].label = '测试字段 C';
        },
        (copy) => {
            copy.applicationStates[3].fields.push({ label: '测试字段 A', value: 'DEMO-TOO-MANY' });
        },
        (copy) => {
            copy.applicationStates = copy.applicationStates.slice(1);
        },
    ]) {
        const invalid = copyFixture();
        mutate(invalid);
        assert.deepEqual(matchInjectionDemo(invalid), invalidResult);
    }
    const empty = {
        ...fixture,
        globalInjectionList: [],
        installedApplications: [],
        applicationStates: [],
    };
    assert.deepEqual(matchInjectionDemo(empty), { ...invalidResult, valid: true });
});

test('injection match output follows registry order, whitelists fields and isolates local mutations from the fixture', () => {
    const input = copyFixture();
    const before = structuredClone(input);
    input.globalInjectionList[3].unexpected = 'DEMO-DO-NOT-COPY';
    input.applicationStates[3].fields[0].unexpected = 'DEMO-DO-NOT-COPY';
    const result = matchInjectionDemo(input);
    assert.equal(result.valid, true);
    assert.deepEqual(
        Object.keys(result.applications[3]).sort(),
        [
            'id',
            'name',
            'initial',
            'packageName',
            'status',
            'time',
            'fields',
            'skip',
            'synthetic',
        ].sort(),
    );
    assert.deepEqual(Object.keys(result.applications[3].fields[0]).sort(), ['label', 'value']);
    assert.notEqual(result.applications[3].fields, input.applicationStates[3].fields);
    assert.notEqual(result.applications[3].fields[0], input.applicationStates[3].fields[0]);
    result.applications[0].skip = false;
    result.applications[0].status = 'injected';
    result.applications[3].fields[0].value = 'DEMO-LOCAL-CHANGE';
    assert.equal(input.applicationStates[0].status, before.applicationStates[0].status);
    assert.equal(
        input.applicationStates[3].fields[0].value,
        before.applicationStates[3].fields[0].value,
    );
    assert.deepEqual(
        matchInjectionDemo(fixture).applications.map((item) => item.skip),
        [true, true, true, false],
    );
    const reordered = copyFixture();
    reordered.globalInjectionList.reverse();
    reordered.installedApplications.reverse();
    reordered.applicationStates.reverse();
    assert.deepEqual(
        matchInjectionDemo(reordered).applications.map((item) => item.id),
        ['DEMO-TEMPLATE-D', 'DEMO-TEMPLATE-C', 'DEMO-TEMPLATE-B', 'DEMO-TEMPLATE-A'],
    );
});
