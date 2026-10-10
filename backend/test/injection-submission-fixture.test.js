import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { matchInjectionDemo } from '../../frontend/src/fixtures/injection-demo-match.js';
import {
    INJECTION_SUBMISSION_DEMO_PROTOCOL,
    validInjectionSubmission,
    attachInjectionSubmissions,
} from '../../frontend/src/fixtures/injection-submission-demo.js';

const fixture = JSON.parse(
    await readFile(
        new URL(
            '../../frontend/src/fixtures/device-injection-submission-demo.json',
            import.meta.url,
        ),
        'utf8',
    ),
);
const matchFixture = JSON.parse(
    await readFile(
        new URL('../../frontend/src/fixtures/device-injection-match-demo.json', import.meta.url),
        'utf8',
    ),
);
const baseMatch = matchInjectionDemo(matchFixture);
const clone = (value) => structuredClone(value);
const invalidResult = {
    valid: false,
    protocol: 'mtx-injection-match-demo/v1',
    registryCount: 0,
    installedCount: 0,
    matchedCount: 0,
    submissionProtocol: 'mtx-injection-submission-demo/v1',
    submittedCount: 0,
    applications: [],
};

test('marked injection submissions attach the fixed password and PIN sample only to the exact matched synthetic application', () => {
    assert.equal(INJECTION_SUBMISSION_DEMO_PROTOCOL, 'mtx-injection-submission-demo/v1');
    assert.equal(fixture.protocol, INJECTION_SUBMISSION_DEMO_PROTOCOL);
    assert.equal(fixture.schemaVersion, 1);
    assert.equal(fixture.datasetId, 'DEMO-DEVICE-01');
    assert.equal(fixture.source, 'synthetic-ui-fixture');
    assert.equal(fixture.fixtureOnly, true);
    assert.equal(fixture.records.length, 1);
    assert.deepEqual(fixture.records[0], {
        id: 'DEMO-SUBMISSION-A',
        applicationId: 'DEMO-TEMPLATE-A',
        packageName: 'dev.mtx.demo.pay.a',
        status: 'submitted',
        formType: 'form',
        submittedAt: '2026-01-01T09:40:00Z',
        fields: [
            { kind: 'password', label: '密码', sampleValue: '000000' },
            { kind: 'pin', label: 'PIN', sampleValue: '000000' },
        ],
        synthetic: true,
    });
    assert.equal(validInjectionSubmission(fixture.records[0]), true);
    const attached = attachInjectionSubmissions(baseMatch, fixture);
    assert.deepEqual(Object.keys(attached).sort(), Object.keys(invalidResult).sort());
    assert.equal(attached.valid, true);
    assert.equal(attached.protocol, 'mtx-injection-match-demo/v1');
    assert.equal(attached.submissionProtocol, INJECTION_SUBMISSION_DEMO_PROTOCOL);
    assert.equal(attached.registryCount, 6);
    assert.equal(attached.installedCount, 6);
    assert.equal(attached.matchedCount, 4);
    assert.equal(attached.submittedCount, 1);
    assert.deepEqual(
        attached.applications.map((item) => item.id),
        ['DEMO-TEMPLATE-A', 'DEMO-TEMPLATE-B', 'DEMO-TEMPLATE-C', 'DEMO-TEMPLATE-D'],
    );
    assert.deepEqual(
        attached.applications.map((item) => item.status),
        ['submitted', 'skipped', 'skipped', 'injected'],
    );
    assert.deepEqual(
        attached.applications.map((item) => item.skip),
        [false, true, true, false],
    );
    assert.equal(attached.applications[0].time, '01/01 09:40');
    assert.deepEqual(attached.applications[0].submission, fixture.records[0]);
    assert.deepEqual(
        attached.applications.slice(1).map((item) => item.submission),
        [null, null, null],
    );
    assert.deepEqual(attached.applications[3].fields, baseMatch.applications[3].fields);
    for (const sampleValue of ['000000', '111111', '222222', '333333']) {
        const record = clone(fixture.records[0]);
        record.fields = [
            { kind: 'password', label: '密码', sampleValue },
            { kind: 'pin', label: 'PIN', sampleValue },
        ];
        assert.equal(validInjectionSubmission(record), true);
    }
    const leapDate = clone(fixture.records[0]);
    leapDate.submittedAt = '2024-02-29T23:59:59Z';
    assert.equal(validInjectionSubmission(leapDate), true);
});

test('submission record validation rejects unmarked, mistyped, non-preset and invalid-calendar input before attachment', () => {
    for (const invalid of [null, [], {}, 'DEMO-SUBMISSION'])
        assert.equal(Boolean(validInjectionSubmission(invalid)), false);
    for (const mutate of [
        (record) => {
            delete record.synthetic;
        },
        (record) => {
            record.synthetic = false;
        },
        (record) => {
            record.synthetic = 'true';
        },
        (record) => {
            record.id = 'REAL-SUBMISSION';
        },
        (record) => {
            record.id = 'DEMO-' + 'A'.repeat(60);
        },
        (record) => {
            record.applicationId = 'APP-A';
        },
        (record) => {
            record.packageName = 'com.example.real.application';
        },
        (record) => {
            record.packageName = 'dev.mtx.demo';
        },
        (record) => {
            record.status = 'injected';
        },
        (record) => {
            record.formType = 'password';
        },
        (record) => {
            record.fields = [];
        },
        (record) => {
            record.fields = {};
        },
        (record) => {
            record.fields.push({ kind: 'pin', label: 'PIN', sampleValue: '000000' });
        },
        (record) => {
            record.fields[1] = clone(record.fields[0]);
        },
        (record) => {
            record.fields[0].kind = 'token';
        },
        (record) => {
            record.fields[0].label = 'PIN';
        },
        (record) => {
            record.fields[1].label = '密码';
        },
        (record) => {
            record.fields[0].sampleValue = '2245';
        },
        (record) => {
            record.fields[0].sampleValue = '123456';
        },
        (record) => {
            record.fields[0].sampleValue = 'REAL-PASSWORD';
        },
        (record) => {
            record.fields[0].sampleValue = 0;
        },
        (record) => {
            record.fields[0].sampleValue = 'DEMO-000000';
        },
    ]) {
        const record = clone(fixture.records[0]);
        mutate(record);
        assert.equal(Boolean(validInjectionSubmission(record)), false);
        assert.deepEqual(
            attachInjectionSubmissions(baseMatch, { ...fixture, records: [record] }),
            invalidResult,
        );
    }
    for (const submittedAt of [
        '2026-02-29T09:40:00Z',
        '2026-02-30T09:40:00Z',
        '2026-04-31T09:40:00Z',
        '2026-13-01T09:40:00Z',
        '2026-01-01T24:00:00Z',
        '2026-01-01T09:60:00Z',
        '2026-01-01T09:40:60Z',
        '2026-01-01T09:40:00+00:00',
        '2026-01-01T09:40:00.000Z',
        '2026-1-1T09:40:00Z',
        '2026-01-01',
        'yesterday',
        null,
    ]) {
        const record = { ...fixture.records[0], submittedAt };
        assert.equal(Boolean(validInjectionSubmission(record)), false, String(submittedAt));
        assert.deepEqual(
            attachInjectionSubmissions(baseMatch, { ...fixture, records: [record] }),
            invalidResult,
        );
    }
});

test('submission attachment rejects malformed match metadata, envelopes, duplicates and references instead of creating ghost applications', () => {
    for (const invalid of [
        null,
        [],
        {},
        { ...fixture, protocol: 'mtx-injection-submission-demo/v2' },
        { ...fixture, schemaVersion: 2 },
        { ...fixture, datasetId: undefined },
        { ...fixture, datasetId: 'DEMO-DEVICE-02' },
        { ...fixture, datasetId: { id: 'DEMO-DEVICE-01' } },
        { ...fixture, source: 'device-report' },
        { ...fixture, fixtureOnly: false },
        { ...fixture, records: {} },
        { ...fixture, records: undefined },
        { ...fixture, records: Array.from({ length: 101 }, () => clone(fixture.records[0])) },
    ])
        assert.deepEqual(attachInjectionSubmissions(baseMatch, invalid), invalidResult);
    for (const mutate of [
        (input) => {
            input.records[0].applicationId = 'DEMO-TEMPLATE-E';
            input.records[0].packageName = 'dev.mtx.demo.shop.e';
        },
        (input) => {
            input.records[0].packageName = 'dev.mtx.demo.wallet.b';
        },
        (input) => {
            input.records.push(clone(input.records[0]));
        },
        (input) => {
            input.records.push({ ...clone(input.records[0]), id: 'DEMO-SUBMISSION-B' });
        },
        (input) => {
            input.records.push({
                ...clone(input.records[0]),
                applicationId: 'DEMO-TEMPLATE-B',
                packageName: 'dev.mtx.demo.wallet.b',
            });
        },
    ]) {
        const input = clone(fixture);
        mutate(input);
        assert.deepEqual(attachInjectionSubmissions(baseMatch, input), invalidResult);
    }
    for (const invalid of [
        null,
        [],
        {},
        { ...baseMatch, valid: false },
        { ...baseMatch, protocol: 'mtx-injection-match-demo/v2' },
        { ...baseMatch, applications: {} },
        { ...baseMatch, matchedCount: 3 },
        { ...baseMatch, registryCount: 3 },
        { ...baseMatch, installedCount: -1 },
        { ...baseMatch, installedCount: 6.5 },
        { ...baseMatch, registryCount: 101 },
    ])
        assert.deepEqual(attachInjectionSubmissions(invalid, fixture), invalidResult);
    for (const mutate of [
        (input) => {
            input.applications[0].synthetic = false;
        },
        (input) => {
            input.applications[0].id = 'REAL-APP';
        },
        (input) => {
            input.applications[0].name = 'Real app';
        },
        (input) => {
            input.applications[0].packageName = 'com.example.real.app';
        },
        (input) => {
            input.applications[0].status = 'submitted';
        },
        (input) => {
            input.applications[0].skip = false;
        },
        (input) => {
            input.applications[0].skip = 'true';
        },
        (input) => {
            input.applications[0].time = 'yesterday';
        },
        (input) => {
            input.applications[1].id = input.applications[0].id;
        },
        (input) => {
            input.applications[1].packageName = input.applications[0].packageName;
        },
        (input) => {
            input.applications[3].fields[0].value = '2245';
        },
    ]) {
        const input = clone(baseMatch);
        mutate(input);
        assert.deepEqual(attachInjectionSubmissions(input, fixture), invalidResult);
    }
    const empty = attachInjectionSubmissions(baseMatch, { ...fixture, records: [] });
    assert.equal(empty.valid, true);
    assert.equal(empty.submittedCount, 0);
    assert.equal(empty.matchedCount, 4);
    assert.deepEqual(
        empty.applications.map((item) => item.submission),
        [null, null, null, null],
    );
    assert.deepEqual(
        empty.applications.map((item) => item.status),
        baseMatch.applications.map((item) => item.status),
    );
});

test('submission attachment clones only whitelisted display fields and leaves match and submission fixtures unchanged by local UI mutations', () => {
    const inputMatch = clone(baseMatch);
    const inputFixture = clone(fixture);
    inputMatch.applications[0].unexpected = 'DEMO-EXTRA';
    inputFixture.records[0].unexpected = 'DEMO-EXTRA';
    inputFixture.records[0].fields[0].unexpected = 'DEMO-EXTRA';
    const beforeMatch = clone(inputMatch);
    const beforeFixture = clone(inputFixture);
    const attached = attachInjectionSubmissions(inputMatch, inputFixture);
    assert.equal(attached.valid, true);
    assert.deepEqual(inputMatch, beforeMatch);
    assert.deepEqual(inputFixture, beforeFixture);
    assert.deepEqual(
        Object.keys(attached.applications[0]).sort(),
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
            'submission',
        ].sort(),
    );
    assert.deepEqual(
        Object.keys(attached.applications[0].submission).sort(),
        [
            'id',
            'applicationId',
            'packageName',
            'status',
            'formType',
            'submittedAt',
            'fields',
            'synthetic',
        ].sort(),
    );
    assert.deepEqual(Object.keys(attached.applications[0].submission.fields[0]).sort(), [
        'kind',
        'label',
        'sampleValue',
    ]);
    assert.notEqual(attached.applications[0].submission, inputFixture.records[0]);
    assert.notEqual(attached.applications[0].submission.fields, inputFixture.records[0].fields);
    assert.notEqual(
        attached.applications[0].submission.fields[0],
        inputFixture.records[0].fields[0],
    );
    assert.notEqual(attached.applications[3].fields, inputMatch.applications[3].fields);
    attached.applications[0].status = 'skipped';
    attached.applications[0].skip = true;
    attached.applications[0].submission.fields[0].sampleValue = '111111';
    attached.applications[3].fields[0].value = 'DEMO-LOCAL-CHANGE';
    assert.deepEqual(inputMatch, beforeMatch);
    assert.deepEqual(inputFixture, beforeFixture);
    const restored = attachInjectionSubmissions(baseMatch, fixture);
    assert.equal(restored.submittedCount, 1);
    assert.equal(restored.applications[0].status, 'submitted');
    assert.equal(restored.applications[0].submission.fields[0].sampleValue, '000000');
    assert.equal(restored.applications[3].fields[0].value, 'DEMO-D001');
});
