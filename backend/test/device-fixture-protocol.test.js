import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
    DEMO_DATASET_ID,
    FIXTURE_PROTOCOLS,
    validFixtureEnvelope,
    validFixtureTimestamp,
    readAppsDemo,
    readSmsDemo,
    readRecordDemo,
    readPaymentDemo,
    readInjectionRecordsDemo,
    readGalleryDemo,
    readAnalysisDemo,
    readMemosDemo,
    readLockDemo,
} from '../../frontend/src/fixtures/device-fixture-protocol.js';
import { matchInjectionDemo } from '../../frontend/src/fixtures/injection-demo-match.js';
import { attachInjectionSubmissions } from '../../frontend/src/fixtures/injection-submission-demo.js';

const load = async (file) =>
    JSON.parse(
        await readFile(new URL(`../../frontend/src/fixtures/${file}`, import.meta.url), 'utf8'),
    );
const definitions = [
    {
        key: 'apps',
        file: 'device-apps-demo.json',
        read: readAppsDemo,
        lists: ['applications'],
        counts: [8],
    },
    {
        key: 'sms',
        file: 'device-sms-demo.json',
        read: readSmsDemo,
        lists: ['messages'],
        counts: [8],
        times: ['receivedAt'],
    },
    {
        key: 'records',
        file: 'device-records-demo.json',
        read: readRecordDemo,
        lists: ['records'],
        counts: [24],
        times: ['occurredAt'],
    },
    {
        key: 'payments',
        file: 'device-payments-demo.json',
        read: readPaymentDemo,
        lists: ['applications', 'records'],
        counts: [4, 24],
        times: ['occurredAt'],
    },
    {
        key: 'injectionRecords',
        file: 'device-injection-records-demo.json',
        read: readInjectionRecordsDemo,
        lists: ['applications', 'records'],
        counts: [3, 6],
        times: ['occurredAt'],
    },
    {
        key: 'gallery',
        file: 'device-gallery-demo.json',
        read: readGalleryDemo,
        lists: ['items'],
        counts: [2],
        times: ['createdAt'],
    },
    {
        key: 'analysis',
        file: 'device-analysis-demo.json',
        read: readAnalysisDemo,
        lists: ['items'],
        counts: [2],
    },
    {
        key: 'memos',
        file: 'device-memos-demo.json',
        read: readMemosDemo,
        lists: ['items'],
        counts: [2],
        times: ['createdAt', 'updatedAt'],
    },
];
for (const definition of definitions) definition.fixture = await load(definition.file);
const fixtures = Object.fromEntries(definitions.map((d) => [d.key, d.fixture]));
const matchFixture = await load('device-injection-match-demo.json');
const submissionFixture = await load('device-injection-submission-demo.json');
const lockFixture = await load('device-ui-demo.json');
const clone = (value) => structuredClone(value);
const rejected = (definition, fixture) =>
    assert.deepEqual(
        definition.read(fixture),
        {
            valid: false,
            ...Object.fromEntries(definition.lists.map((key) => [key, []])),
        },
        definition.key,
    );

// Every module is checked against its own wire marker, not a generic demo flag.
test('eight presentation protocols have explicit dataset envelopes, fixed counts and valid empty payloads', () => {
    assert.equal(DEMO_DATASET_ID, 'DEMO-DEVICE-01');
    assert.equal(new Set(Object.values(FIXTURE_PROTOCOLS)).size, 8);
    for (const definition of definitions) {
        const { fixture } = definition;
        assert.equal(fixture.protocol, FIXTURE_PROTOCOLS[definition.key]);
        assert.equal(fixture.datasetId, DEMO_DATASET_ID);
        assert.equal(validFixtureEnvelope(fixture, fixture.protocol), true);
        const parsed = definition.read(fixture);
        assert.equal(parsed.valid, true, definition.key);
        assert.deepEqual(
            definition.lists.map((key) => parsed[key].length),
            definition.counts,
        );
        assert.deepEqual(Object.keys(parsed).sort(), ['valid', ...definition.lists].sort());
        const empty = clone(fixture);
        for (const key of definition.lists) empty[key] = [];
        assert.deepEqual(definition.read(empty), {
            valid: true,
            ...Object.fromEntries(definition.lists.map((key) => [key, []])),
        });
        for (const other of definitions.filter((d) => d.key !== definition.key))
            rejected(definition, other.fixture);
    }
});

test('all modules reject mismatched markers, missing lists, duplicates and any unmarked row as whole empty datasets', () => {
    for (const definition of definitions) {
        for (const invalid of [null, [], {}, 'DEMO']) rejected(definition, invalid);
        for (const mutate of [
            (f) => {
                delete f.protocol;
            },
            (f) => {
                f.protocol += '-unsupported';
            },
            (f) => {
                f.schemaVersion = '1';
            },
            (f) => {
                f.schemaVersion = 2;
            },
            (f) => {
                delete f.datasetId;
            },
            (f) => {
                f.datasetId = 'DEMO-DEVICE-02';
            },
            (f) => {
                f.datasetId = { id: DEMO_DATASET_ID };
            },
            (f) => {
                f.source = 'api';
            },
            (f) => {
                f.fixtureOnly = 'true';
            },
            (f) => {
                f.fixtureOnly = false;
            },
        ]) {
            const fixture = clone(definition.fixture);
            mutate(fixture);
            rejected(definition, fixture);
        }
        for (const key of definition.lists) {
            for (const mutate of [
                (f) => {
                    delete f[key];
                },
                (f) => {
                    f[key] = null;
                },
                (f) => {
                    f[key].push(clone(f[key][0]));
                },
                (f) => {
                    f[key][0].synthetic = false;
                },
                (f) => {
                    delete f[key][0].synthetic;
                },
                (f) => {
                    f[key][0].id = 'REAL-ROW';
                },
                (f) => {
                    f[key][0].id = `DEMO-${'A'.repeat(65)}`;
                },
                (f) => {
                    f[key] = Array.from({ length: 101 }, (_, i) => ({
                        ...f[key][0],
                        id: `DEMO-CAP-${i}`,
                    }));
                },
            ]) {
                const fixture = clone(definition.fixture);
                mutate(fixture);
                rejected(definition, fixture);
            }
        }
        const packageRows = definition.fixture.applications;
        if (packageRows) {
            for (const packageName of [
                'com.real.application',
                'dev.mtx.demo.',
                'dev.mtx.demo.X',
                'dev.mtx.demo.pay/a',
            ]) {
                const fixture = clone(definition.fixture);
                fixture.applications[0].packageName = packageName;
                rejected(definition, fixture);
            }
            const duplicatePackage = clone(definition.fixture);
            duplicatePackage.applications[1].packageName =
                duplicatePackage.applications[0].packageName;
            rejected(definition, duplicatePackage);
        }
    }
});

test('typed fields, real calendar timestamps and cross-record foreign keys fail closed without accepting arbitrary media or values', () => {
    for (const invalid of [
        '2026-02-30T10:00:00+08:00',
        '2026-10-10T10:5:00+08:00',
        '2026-13-01T00:00:00Z',
        '2026-10-10T24:00:00Z',
        '2026-10-10T10:60:00Z',
        '2026-10-10T10:00:60Z',
        '2026-10-10T10:00:00+14:01',
        '2026-10-10T10:00:00+15:00',
        '2026-10-10',
        '1999-12-31T00:00:00Z',
        '2100-01-01T00:00:00Z',
        '2026-10-10T10:00:00.000Z',
        null,
    ]) {
        assert.equal(validFixtureTimestamp(invalid), false, String(invalid));
        for (const definition of definitions) {
            for (const field of definition.times || []) {
                const fixture = clone(definition.fixture);
                const list = fixture[definition.lists.at(-1)];
                list[0][field] = invalid;
                rejected(definition, fixture);
            }
        }
    }
    for (const valid of [
        '2024-02-29T23:59:59Z',
        '2026-10-10T10:00:00+14:00',
        '2026-10-10T10:00:00-08:00',
    ])
        assert.equal(validFixtureTimestamp(valid), true);
    const cases = [
        [
            'apps',
            (f) => {
                f.applications[0].system = 'false';
            },
        ],
        [
            'apps',
            (f) => {
                f.applications[0].group = '系统应用';
            },
        ],
        [
            'apps',
            (f) => {
                f.applications[0].name = 'Actual app';
            },
        ],
        [
            'sms',
            (f) => {
                f.messages[0].address = '+8613800000000';
            },
        ],
        [
            'sms',
            (f) => {
                f.messages[0].body = 'real message';
            },
        ],
        [
            'sms',
            (f) => {
                f.messages[0].body = `【合成测试】${'x'.repeat(501)}`;
            },
        ],
        [
            'records',
            (f) => {
                f.records[0].type = 'password';
            },
        ],
        [
            'records',
            (f) => {
                f.records[0].typeLabel = 'PIN';
            },
        ],
        [
            'records',
            (f) => {
                f.records[0].packageName = 'com.android.systemui';
            },
        ],
        [
            'records',
            (f) => {
                f.records[0].content = '123456';
            },
        ],
        [
            'payments',
            (f) => {
                f.records[0].appId = 'DEMO-UNKNOWN';
            },
        ],
        [
            'payments',
            (f) => {
                f.records[0].value = '123456';
            },
        ],
        [
            'payments',
            (f) => {
                f.records[0].success = 'true';
            },
        ],
        [
            'injectionRecords',
            (f) => {
                f.records[0].applicationId = 'DEMO-UNKNOWN';
            },
        ],
        [
            'injectionRecords',
            (f) => {
                f.applications[0].status = 'injected';
            },
        ],
        [
            'injectionRecords',
            (f) => {
                f.records[0].fields.push({ label: '测试字段 C', value: 'DEMO-EXTRA' });
            },
        ],
        [
            'injectionRecords',
            (f) => {
                f.records[0].fields[0].value = '123456';
            },
        ],
        [
            'injectionRecords',
            (f) => {
                f.records[0].fields[0].value = 'DEMO-FORM-A-01';
            },
        ],
        [
            'injectionRecords',
            (f) => {
                f.records[0].fields[1].label = 'password';
            },
        ],
        [
            'gallery',
            (f) => {
                f.items[0].assetId = 'https://example.test/photo.svg';
            },
        ],
        [
            'gallery',
            (f) => {
                f.items[0].mimeType = 'image/jpeg';
            },
        ],
        [
            'gallery',
            (f) => {
                f.items[0].width = 321;
            },
        ],
        [
            'gallery',
            (f) => {
                f.items[1].assetId = f.items[0].assetId;
            },
        ],
        [
            'analysis',
            (f) => {
                f.items[0].messageIds[0] = 'DEMO-SMS-99';
            },
        ],
        [
            'analysis',
            (f) => {
                f.items[0].messageIds.push(f.items[0].messageIds[0]);
            },
        ],
        [
            'analysis',
            (f) => {
                f.items[0].messageIds = [];
            },
        ],
        [
            'analysis',
            (f) => {
                f.items[0].summary = 'actual inference';
            },
        ],
        [
            'memos',
            (f) => {
                f.items[0].label = 'urgent';
            },
        ],
        [
            'memos',
            (f) => {
                f.items[0].author = 'Actual user';
            },
        ],
        [
            'memos',
            (f) => {
                f.items[0].updatedAt = '2026-10-10T09:59:59+08:00';
            },
        ],
    ];
    for (const [key, mutate] of cases) {
        const definition = definitions.find((d) => d.key === key);
        const fixture = clone(definition.fixture);
        mutate(fixture);
        rejected(definition, fixture);
    }
    assert.equal(readAnalysisDemo(fixtures.analysis, fixtures.sms).valid, true);
    assert.deepEqual(readAnalysisDemo(fixtures.analysis, { ...fixtures.sms, messages: [] }), {
        valid: false,
        items: [],
    });
    assert.deepEqual(
        readAnalysisDemo(fixtures.analysis, { ...fixtures.sms, datasetId: 'DEMO-DEVICE-02' }),
        { valid: false, items: [] },
    );
    for (const definition of definitions.filter((d) =>
        ['records', 'payments', 'injectionRecords'].includes(d.key),
    )) {
        assert.equal(definition.read(definition.fixture, fixtures.apps).valid, true);
        for (const catalog of [
            null,
            { ...fixtures.apps, datasetId: 'DEMO-DEVICE-02' },
            { ...fixtures.apps, applications: [] },
        ]) {
            assert.deepEqual(definition.read(definition.fixture, catalog), {
                valid: false,
                ...Object.fromEntries(definition.lists.map((key) => [key, []])),
            });
        }
        for (const field of ['name', 'packageName']) {
            const changed = clone(definition.fixture);
            const row = definition.key === 'records' ? changed.records[0] : changed.applications[0];
            const target = definition.key === 'records' && field === 'name' ? 'appName' : field;
            row[target] = field === 'name' ? '样例不匹配名称' : 'dev.mtx.demo.unmatched';
            assert.equal(definition.read(changed).valid, true);
            assert.deepEqual(definition.read(changed, fixtures.apps), {
                valid: false,
                ...Object.fromEntries(definition.lists.map((key) => [key, []])),
            });
        }
    }
});

test('all readers construct field-whitelisted independent clones, including nested submission fields and SMS references', () => {
    for (const definition of definitions) {
        const original = clone(definition.fixture);
        original.extra = 'DEMO-UNTRUSTED-EXTRA';
        for (const key of definition.lists)
            for (const row of original[key]) {
                row.extra = 'DEMO-UNTRUSTED-EXTRA';
                if (row.fields)
                    for (const field of row.fields) field.extra = 'DEMO-UNTRUSTED-EXTRA';
            }
        const before = JSON.stringify(original);
        const expected = definition.read(definition.fixture);
        const parsed = definition.read(original);
        assert.deepEqual(parsed, expected);
        assert.doesNotMatch(JSON.stringify(parsed), /DEMO-UNTRUSTED-EXTRA/);
        for (const key of definition.lists) {
            assert.notEqual(parsed[key], original[key]);
            assert.notEqual(parsed[key][0], original[key][0]);
            parsed[key][0].id = 'DEMO-LOCAL-MUTATION';
            if (parsed[key][0].fields) {
                assert.notEqual(parsed[key][0].fields, original[key][0].fields);
                assert.notEqual(parsed[key][0].fields[0], original[key][0].fields[0]);
                parsed[key][0].fields[0].value = 'DEMO-LOCAL-FIELD';
            }
            if (parsed[key][0].messageIds) {
                assert.notEqual(parsed[key][0].messageIds, original[key][0].messageIds);
                parsed[key][0].messageIds[0] = 'DEMO-LOCAL-REFERENCE';
            }
        }
        assert.equal(JSON.stringify(original), before);
        assert.deepEqual(definition.read(definition.fixture), expected);
    }
});

test('a single synthetic device catalog joins installed matching, payment groups, record aliases, historical injection and SMS summaries', () => {
    const apps = readAppsDemo(fixtures.apps).applications;
    const catalog = new Map(apps.map((app) => [app.packageName, app]));
    assert.equal(apps.filter((app) => !app.system).length, 6);
    assert.equal(apps.filter((app) => app.system).length, 2);
    assert.deepEqual(
        new Set(apps.filter((app) => !app.system).map((app) => app.packageName)),
        new Set(matchFixture.installedApplications.map((app) => app.packageName)),
    );
    for (const app of [
        ...readPaymentDemo(fixtures.payments).applications,
        ...readInjectionRecordsDemo(fixtures.injectionRecords).applications,
    ]) {
        assert.equal(catalog.get(app.packageName)?.name, app.name, app.packageName);
    }
    for (const record of readRecordDemo(fixtures.records).records)
        assert.equal(catalog.get(record.packageName)?.name, record.appName, record.id);
    const matched = matchInjectionDemo(matchFixture);
    const attached = attachInjectionSubmissions(matched, submissionFixture);
    assert.equal(attached.valid, true);
    assert.deepEqual(
        [
            attached.registryCount,
            attached.installedCount,
            attached.matchedCount,
            attached.submittedCount,
        ],
        [6, 6, 4, 1],
    );
    for (const app of attached.applications)
        assert.equal(catalog.get(app.packageName)?.name, app.name);
    assert.equal(attached.applications[0].submission.packageName, apps[0].packageName);
    assert.deepEqual(
        attached.applications.map((app) => app.status),
        ['submitted', 'skipped', 'skipped', 'injected'],
    );
    // Historical list markers are not silently equated with the quick-card local state.
    assert.ok(fixtures.injectionRecords.applications.every((app) => app.status === 'submitted'));
    const summaries = readAnalysisDemo(fixtures.analysis, fixtures.sms);
    assert.equal(summaries.valid, true);
    const ids = new Set(fixtures.sms.messages.map((m) => m.id));
    for (const summary of summaries.items) assert.ok(summary.messageIds.every((id) => ids.has(id)));
    assert.deepEqual(
        summaries.items[0].messageIds,
        fixtures.sms.messages.map((m) => m.id),
    );
    assert.doesNotMatch(
        JSON.stringify(fixtures),
        /https?:\/\/|org\.example\.mtx\.demo|com\.android\.|Facebook|WhatsApp|Yape|Samsung|"(?:token|otp|cvv)"\s*:/i,
    );
    const lock = readLockDemo(lockFixture);
    assert.equal(lock.valid, true);
    assert.equal(lock.lockEvents.length, 16);
    assert.deepEqual(
        lock.lockEvents.filter((r) => r.valueType === 'pin').map((r) => r.sampleValue),
        ['000000', '111111', '222222', '333333'],
    );
    for (const badEnvelope of [
        { ...lockFixture, datasetId: undefined },
        { ...lockFixture, datasetId: 'DEMO-DEVICE-02' },
        { ...lockFixture, protocol: 'mtx-ui-demo/v2' },
    ])
        assert.deepEqual(readLockDemo(badEnvelope), { valid: false, lockEvents: [] });
    for (const mutate of [
        (f) => {
            f.lockEvents[0].sampleValue = '123456';
        },
        (f) => {
            f.lockEvents[0].synthetic = false;
        },
        (f) => {
            f.lockEvents[0].time = '24:00:00';
        },
        (f) => {
            f.lockEvents[1].pattern = [1, 1, 2];
        },
        (f) => {
            f.lockEvents[1].pattern = [1, 10];
        },
        (f) => {
            f.lockEvents.push(clone(f.lockEvents[0]));
        },
    ]) {
        const bad = clone(lockFixture);
        mutate(bad);
        assert.deepEqual(readLockDemo(bad), { valid: false, lockEvents: [] });
    }
    const pattern = lock.lockEvents.find((r) => r.valueType === 'pattern');
    const original = lockFixture.lockEvents.find((r) => r.id === pattern.id);
    assert.notEqual(pattern.pattern, original.pattern);
    pattern.pattern[0] = 9;
    assert.notDeepEqual(pattern.pattern, original.pattern);
});
