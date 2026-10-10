import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
    UI_DEMO_PROTOCOL,
    LOCK_VALUE_TYPES,
    SYNTHETIC_PIN_VALUES,
    lockDemoValue,
    lockDemoPattern,
} from '../../frontend/src/fixtures/device-demo-protocol.js';

const fixture = JSON.parse(
    await readFile(
        new URL('../../frontend/src/fixtures/device-ui-demo.json', import.meta.url),
        'utf8',
    ),
);
const smsFixture = JSON.parse(
    await readFile(
        new URL('../../frontend/src/fixtures/device-sms-demo.json', import.meta.url),
        'utf8',
    ),
);
test('device panel demo is an explicit portable synthetic fixture with consistent category counts', () => {
    assert.equal(fixture.protocol, 'mtx-ui-demo/v1');
    assert.equal(fixture.schemaVersion, 1);
    assert.equal(fixture.datasetId, 'DEMO-DEVICE-01');
    assert.equal(fixture.source, 'synthetic-ui-fixture');
    assert.equal(fixture.fixtureOnly, true);
    assert.equal(fixture.lockEvents.length, 16);
    assert.equal(new Set(fixture.lockEvents.map((item) => item.id)).size, 16);
    for (const [category, count] of Object.entries({ system: 12, scenario: 1, app: 3 }))
        assert.equal(fixture.lockEvents.filter((item) => item.category === category).length, count);
    const fixedPins = new Map([
        ['DEMO-EVENT-01', '000000'],
        ['DEMO-EVENT-14', '111111'],
        ['DEMO-EVENT-15', '222222'],
        ['DEMO-EVENT-16', '333333'],
    ]);
    for (const item of fixture.lockEvents) {
        assert.match(item.id, /^DEMO-EVENT-\d{2}$/);
        assert.match(item.source, /^dev\.mtx\.demo\.[a-z\d]+$/);
        assert.equal(item.synthetic, true);
        assert.ok(['pin', 'pattern', 'type', 'sample'].includes(item.valueType));
        assert.match(item.time, /^\d{2}:\d{2}:\d{2}$/);
        const required = [
            'id',
            'category',
            'label',
            'sampleValue',
            'source',
            'time',
            'synthetic',
            'valueType',
        ];
        if (item.valueType === 'pattern') required.push('pattern');
        assert.deepEqual(Object.keys(item).sort(), required.sort());
        if (item.valueType === 'pin') {
            assert.equal(item.sampleValue, fixedPins.get(item.id));
            assert.equal(item.category, item.id === 'DEMO-EVENT-01' ? 'system' : 'app');
            assert.equal(item.label, item.id === 'DEMO-EVENT-01' ? '系统PIN' : 'APP密码');
            assert.equal(item.pattern, undefined);
        } else if (item.valueType === 'type') {
            assert.equal(item.id, 'DEMO-EVENT-04');
            assert.equal(item.category, 'system');
            assert.equal(item.label, '锁类型');
            assert.equal(item.sampleValue, 'pattern');
        } else if (item.valueType === 'pattern') {
            assert.equal(item.category, 'system');
            assert.equal(item.label, '系统图案');
            assert.match(item.sampleValue, /^图案示例 [A-Z]$/);
            assert.ok(item.pattern.length > 0 && item.pattern.length <= 9);
            assert.equal(new Set(item.pattern).size, item.pattern.length);
            assert.ok(
                item.pattern.every((point) => Number.isInteger(point) && point >= 1 && point <= 9),
            );
        } else {
            assert.ok(['DEMO-EVENT-07', 'DEMO-EVENT-10', 'DEMO-EVENT-13'].includes(item.id));
            assert.match(item.sampleValue, /^DEMO-\d{3}$/);
        }
    }
    assert.deepEqual(
        Object.fromEntries(
            ['pin', 'pattern', 'type', 'sample'].map((type) => [
                type,
                fixture.lockEvents.filter((item) => item.valueType === type).length,
            ]),
        ),
        { pin: 4, pattern: 8, type: 1, sample: 3 },
    );
    assert.deepEqual(
        fixture.lockEvents
            .filter((item) => item.valueType === 'pin')
            .map((item) => item.sampleValue),
        [...fixedPins.values()],
    );
    assert.deepEqual(
        fixture.lockEvents.find((item) => item.id === 'DEMO-EVENT-03').pattern,
        [2, 5, 8, 9],
    );
});
test('typed lock demo protocol accepts only marked fixed fake values and rejects arbitrary numeric values or invalid grids', () => {
    assert.equal(UI_DEMO_PROTOCOL, 'mtx-ui-demo/v1');
    assert.equal(fixture.protocol, UI_DEMO_PROTOCOL);
    assert.deepEqual(LOCK_VALUE_TYPES, ['pin', 'pattern', 'type', 'sample']);
    assert.deepEqual(SYNTHETIC_PIN_VALUES, ['000000', '111111', '222222', '333333']);
    assert.ok(Object.isFrozen(LOCK_VALUE_TYPES));
    assert.ok(Object.isFrozen(SYNTHETIC_PIN_VALUES));
    for (const sampleValue of SYNTHETIC_PIN_VALUES)
        assert.equal(
            lockDemoValue({ synthetic: true, valueType: 'pin', sampleValue }),
            sampleValue,
        );
    for (const invalid of [
        null,
        { valueType: 'pin', sampleValue: '000000' },
        { synthetic: false, valueType: 'pin', sampleValue: '000000' },
        { synthetic: true, valueType: 'pin', sampleValue: '2245' },
        { synthetic: true, valueType: 'pin', sampleValue: '123456' },
        { synthetic: true, valueType: 'pin', sampleValue: 0 },
        { synthetic: true, valueType: 'pin', sampleValue: 'pattern' },
        { synthetic: true, valueType: 'type', sampleValue: '000000' },
        { synthetic: true, valueType: 'sample', sampleValue: '111111' },
        { synthetic: true, valueType: 'pattern', sampleValue: '222222' },
        { synthetic: true, valueType: 'unknown', sampleValue: '333333' },
    ])
        assert.equal(lockDemoValue(invalid), 'DEMO-UNSET');
    assert.equal(
        lockDemoValue({ synthetic: true, valueType: 'type', sampleValue: 'pattern' }),
        'pattern',
    );
    assert.equal(
        lockDemoValue({ synthetic: true, valueType: 'sample', sampleValue: 'DEMO-013' }),
        'DEMO-013',
    );
    assert.equal(
        lockDemoValue({ synthetic: true, valueType: 'pattern', sampleValue: '图案示例 C' }),
        '图案示例 C',
    );
    const original = [2, 5, 8, 9];
    const copied = lockDemoPattern({ synthetic: true, valueType: 'pattern', pattern: original });
    assert.deepEqual(copied, original);
    assert.notEqual(copied, original);
    copied[0] = 1;
    assert.deepEqual(original, [2, 5, 8, 9]);
    for (const invalid of [
        null,
        { valueType: 'pattern', pattern: original },
        { synthetic: false, valueType: 'pattern', pattern: original },
        { synthetic: true, valueType: 'pin', pattern: original },
        ...[
            [],
            [2],
            [2, 2],
            [0, 2],
            [2, 10],
            [2, 5.5],
            ['2', 5],
            [1, 2, 3, 4, 5, 6, 7, 8, 9, 1],
        ].map((pattern) => ({ synthetic: true, valueType: 'pattern', pattern })),
    ])
        assert.deepEqual(lockDemoPattern(invalid), []);
});
test('template demo uses only fictional app IDs and clearly marked sample fields', () => {
    assert.equal(fixture.applications.length, 2);
    assert.equal(fixture.applications.filter((item) => item.status === 'submitted').length, 1);
    for (const item of fixture.applications) {
        assert.match(item.id, /^DEMO-APP-[AB]$/);
        assert.match(item.name, /^样例/);
        assert.match(item.packageName, /^dev\.mtx\.demo\.[a-z]+$/);
        assert.equal(typeof item.skip, 'boolean');
        assert.equal(item.fields.length, 2);
        for (const field of item.fields) {
            assert.match(field.label, /^测试字段 [AB]$/);
            assert.match(field.value, /^DEMO-[AB]\d{3}$/);
        }
        assert.ok(
            Object.keys(item).every((key) =>
                [
                    'id',
                    'name',
                    'initial',
                    'packageName',
                    'status',
                    'time',
                    'fields',
                    'skip',
                ].includes(key),
            ),
        );
    }
    assert.doesNotMatch(
        JSON.stringify(fixture.applications),
        /Yape|Samsung Pay|nepal\.banking|sk-|"password"|"pin"|"otp"|"cvv"|"token"/i,
    );
});
test('SMS records fixture contains eight explicitly fictional, uniquely identified text messages', () => {
    assert.equal(smsFixture.schemaVersion, 1);
    assert.equal(smsFixture.source, 'synthetic-ui-fixture');
    assert.equal(smsFixture.fixtureOnly, true);
    assert.match(smsFixture.description, /合成短信/);
    assert.equal(smsFixture.messages.length, 8);
    assert.equal(new Set(smsFixture.messages.map((message) => message.id)).size, 8);
    for (const message of smsFixture.messages) {
        assert.deepEqual(Object.keys(message).sort(), [
            'address',
            'body',
            'id',
            'receivedAt',
            'sender',
            'synthetic',
        ]);
        assert.match(message.id, /^DEMO-SMS-\d{2}$/);
        assert.match(message.address, /^DEMO-\d{5}$/);
        assert.match(message.body, /^【合成测试】/);
        assert.equal(message.synthetic, true);
        assert.ok(message.sender.length > 0 && message.sender.length <= 30);
        assert.ok(message.body.length > 0 && message.body.length <= 500);
        assert.ok(Number.isFinite(Date.parse(message.receivedAt)));
        assert.match(message.receivedAt, /^2026-10-10T\d{2}:\d{2}:\d{2}[+]08:00$/);
    }
});
test('SMS fixture excludes live sources and credentials, retaining escaped-text and multilingual test cases', () => {
    assert.doesNotMatch(
        JSON.stringify(smsFixture),
        /https?:\/\/|Entel|cohuducox|sk-|"password"|"pin"|"otp"|"cvv"|"token"|验证码|口令|密钥|<script|onerror/i,
    );
    assert.ok(smsFixture.messages.some((message) => message.body.includes('Mensaje sintético')));
    assert.ok(smsFixture.messages.some((message) => message.body.includes('<b>示例</b> & 1 < 2')));
});

test('application demo uses eight fictional packages with explicit local-only and system markers', async () => {
    const data = JSON.parse(
        await readFile(
            new URL('../../frontend/src/fixtures/device-apps-demo.json', import.meta.url),
            'utf8',
        ),
    );
    assert.equal(data.schemaVersion, 1);
    assert.equal(data.source, 'synthetic-ui-fixture');
    assert.equal(data.fixtureOnly, true);
    assert.equal(data.applications.length, 8);
    assert.equal(new Set(data.applications.map((item) => item.id)).size, 8);
    assert.equal(new Set(data.applications.map((item) => item.packageName)).size, 8);
    assert.equal(data.applications.filter((item) => item.system).length, 2);
    for (const item of data.applications) {
        assert.deepEqual(Object.keys(item).sort(), [
            'group',
            'id',
            'initial',
            'name',
            'packageName',
            'synthetic',
            'system',
        ]);
        assert.match(item.id, /^DEMO-APP-\d{2}$/);
        assert.match(item.name, /^样例/);
        assert.match(item.packageName, /^dev\.mtx\.demo\.[a-z][a-z0-9_]*(?:\.[a-z][a-z0-9_]*)*$/);
        assert.equal(item.synthetic, true);
        assert.equal(typeof item.system, 'boolean');
        assert.equal(Array.from(item.initial).length, 1);
    }
    assert.doesNotMatch(
        JSON.stringify(data),
        /https?:\/\/|cohuducox|facebook|whatsapp|telegram|tiktok|yape|samsung|password|pin|otp|cvv|token/i,
    );
});

test('record demo preserves twenty-four synthetic rows without live input or credentials', async () => {
    const data = JSON.parse(
        await readFile(
            new URL('../../frontend/src/fixtures/device-records-demo.json', import.meta.url),
            'utf8',
        ),
    );
    assert.equal(data.schemaVersion, 1);
    assert.equal(data.source, 'synthetic-ui-fixture');
    assert.equal(data.fixtureOnly, true);
    assert.equal(data.records.length, 24);
    assert.equal(new Set(data.records.map((item) => item.id)).size, 24);
    for (const item of data.records) {
        assert.deepEqual(Object.keys(item).sort(), [
            'appName',
            'content',
            'id',
            'occurredAt',
            'packageName',
            'synthetic',
            'type',
            'typeLabel',
        ]);
        assert.match(item.id, /^DEMO-RECORD-\d{2}$/);
        assert.match(item.content, /^DEMO-[A-Z0-9_-]+ · /);
        assert.match(item.appName, /^样例/);
        assert.match(item.packageName, /^dev\.mtx\.demo\.[a-z][a-z0-9_]*(?:\.[a-z][a-z0-9_]*)*$/);
        assert.ok(['app', 'keyboard', 'pin'].includes(item.type));
        assert.equal(item.typeLabel, { app: 'APP', keyboard: '键盘', pin: 'PIN' }[item.type]);
        assert.ok(Number.isFinite(Date.parse(item.occurredAt)));
        assert.equal(item.synthetic, true);
    }
    assert.doesNotMatch(
        JSON.stringify(data),
        /https?:\/\/|cohuducox|"(?:password|pin|otp|cvv|token)"\s*:|验证码|口令|密钥|<script|onerror/i,
    );
    assert.ok(data.records.some((item) => item.content.includes('<b>示例</b> & 1 < 2')));
    assert.deepEqual(
        new Set(data.records.map((item) => item.type)),
        new Set(['app', 'keyboard', 'pin']),
    );
    assert.deepEqual(
        data.records.map((item) => item.type),
        [
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
        ],
    );
    assert.deepEqual(
        Object.fromEntries(
            ['app', 'keyboard', 'pin'].map((type) => [
                type,
                data.records.filter((item) => item.type === type).length,
            ]),
        ),
        { app: 14, keyboard: 9, pin: 1 },
    );
    assert.equal(new Set(data.records.map((item) => item.packageName)).size, 3);
    assert.ok(data.records.some((item) => item.content.length > 80));
    assert.ok(
        data.records.every(
            (item, index) =>
                index === 0 ||
                Date.parse(data.records[index - 1].occurredAt) > Date.parse(item.occurredAt),
        ),
    );
});
