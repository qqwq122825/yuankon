import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

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
    assert.equal(fixture.schemaVersion, 1);
    assert.equal(fixture.source, 'synthetic-ui-fixture');
    assert.equal(fixture.fixtureOnly, true);
    assert.equal(fixture.lockEvents.length, 16);
    assert.equal(new Set(fixture.lockEvents.map((item) => item.id)).size, 16);
    for (const [category, count] of Object.entries({ system: 12, scenario: 1, app: 3 }))
        assert.equal(fixture.lockEvents.filter((item) => item.category === category).length, count);
    for (const item of fixture.lockEvents) {
        assert.match(item.id, /^DEMO-EVENT-\d{2}$/);
        assert.match(item.source, /^dev\.mtx\.demo\.[a-z\d]+$/);
        assert.match(item.sampleValue, /^(DEMO-\d{3}|图案示例 [A-Z])$/);
        assert.match(item.time, /^\d{2}:\d{2}:\d{2}$/);
        if (item.pattern) {
            assert.equal(new Set(item.pattern).size, item.pattern.length);
            assert.ok(
                item.pattern.every((point) => Number.isInteger(point) && point >= 1 && point <= 9),
            );
        }
        assert.ok(
            Object.keys(item).every((key) =>
                ['id', 'category', 'label', 'sampleValue', 'source', 'time', 'pattern'].includes(
                    key,
                ),
            ),
        );
    }
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
        JSON.stringify(fixture),
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
        assert.match(item.name, /^示例/);
        assert.match(item.packageName, /^org\.example\.mtx\.demo\.[a-z.]+$/);
        assert.equal(item.synthetic, true);
        assert.equal(typeof item.system, 'boolean');
        assert.equal(Array.from(item.initial).length, 1);
    }
    assert.doesNotMatch(
        JSON.stringify(data),
        /https?:\/\/|cohuducox|facebook|whatsapp|telegram|tiktok|yape|samsung|password|pin|otp|cvv|token/i,
    );
});

test('record demo preserves eight synthetic metadata-only rows without live input or credentials', async () => {
    const data = JSON.parse(
        await readFile(
            new URL('../../frontend/src/fixtures/device-records-demo.json', import.meta.url),
            'utf8',
        ),
    );
    assert.equal(data.schemaVersion, 1);
    assert.equal(data.source, 'synthetic-ui-fixture');
    assert.equal(data.fixtureOnly, true);
    assert.equal(data.records.length, 8);
    assert.equal(new Set(data.records.map((item) => item.id)).size, 8);
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
        assert.match(item.packageName, /^dev\.mtx\.demo\.[a-z\d]+$/);
        assert.ok(['ui-event', 'state', 'sample'].includes(item.type));
        assert.ok(Number.isFinite(Date.parse(item.occurredAt)));
        assert.equal(item.synthetic, true);
    }
    assert.doesNotMatch(
        JSON.stringify(data),
        /https?:\/\/|cohuducox|"password"|"pin"|"otp"|"cvv"|"token"|验证码|口令|密钥|<script|onerror/i,
    );
    assert.ok(data.records.some((item) => item.content.includes('<b>示例</b> & 1 < 2')));
});
