import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const load = async (filename) =>
    JSON.parse(
        await readFile(new URL(`../../frontend/src/fixtures/${filename}`, import.meta.url), 'utf8'),
    );
const payment = await load('device-payments-demo.json');
const injection = await load('device-injection-records-demo.json');

function assertEnvelope(fixture) {
    assert.equal(fixture.schemaVersion, 1);
    assert.equal(fixture.source, 'synthetic-ui-fixture');
    assert.equal(fixture.fixtureOnly, true);
    assert.doesNotMatch(
        JSON.stringify(fixture),
        /https?:\/\/|cohuducox|Yape|Samsung|Facebook|WhatsApp|[+]91|"token"|"otp"|"cvv"|<script|onerror/i,
    );
}

function assertApplications(applications, prefix) {
    assert.equal(new Set(applications.map((item) => item.id)).size, applications.length);
    assert.equal(new Set(applications.map((item) => item.packageName)).size, applications.length);
    for (const app of applications) {
        assert.match(app.id, new RegExp(`^${prefix}-\\d{2}$`));
        assert.match(app.name, /^样例/);
        assert.match(app.packageName, /^dev\.mtx\.demo\.[a-z][a-z0-9_]*(?:\.[a-z][a-z0-9_]*)*$/);
        assert.equal(app.synthetic, true);
        assert.ok(
            Object.keys(app).every((key) =>
                [
                    'id',
                    'name',
                    'packageName',
                    'ageLabel',
                    'initial',
                    'status',
                    'synthetic',
                ].includes(key),
            ),
        );
    }
}

test('payment password fixture is fixed fictional data with four app groups, twenty-four records and derived counts', () => {
    assertEnvelope(payment);
    assert.equal(payment.applications.length, 4);
    assert.equal(payment.records.length, 24);
    assertApplications(payment.applications, 'DEMO-PAY-APP');
    assert.equal(new Set(payment.records.map((item) => item.id)).size, 24);
    assert.deepEqual(
        payment.applications.map(
            (app) => payment.records.filter((item) => item.appId === app.id).length,
        ),
        [12, 5, 4, 3],
    );
    for (const record of payment.records) {
        assert.deepEqual(Object.keys(record).sort(), [
            'appId',
            'id',
            'kind',
            'occurredAt',
            'success',
            'synthetic',
            'value',
        ]);
        assert.match(record.id, /^DEMO-PAY-RECORD-\d{2}$/);
        assert.ok(payment.applications.some((app) => app.id === record.appId));
        assert.match(record.value, /^DEMO-[A-Z\d-]+$/);
        assert.equal(record.kind, 'APP密码');
        assert.ok(Number.isFinite(Date.parse(record.occurredAt)));
        assert.equal(typeof record.success, 'boolean');
        assert.equal(record.synthetic, true);
    }
    const first = payment.records.filter((item) => item.appId === payment.applications[0].id);
    assert.equal(first.filter((item) => item.success).length, 12);
    assert.equal(new Set(first.map((item) => item.value)).size, 3);
});

test('injection records fixture is six local mock submissions belonging only to three fictional applications', () => {
    assertEnvelope(injection);
    assert.equal(injection.applications.length, 3);
    assert.equal(injection.records.length, 6);
    assertApplications(injection.applications, 'DEMO-INJECTION-APP');
    assert.equal(new Set(injection.records.map((item) => item.id)).size, 6);
    for (const app of injection.applications) {
        assert.equal(app.status, 'submitted');
        assert.equal(injection.records.filter((item) => item.applicationId === app.id).length, 2);
    }
    for (const record of injection.records) {
        assert.deepEqual(Object.keys(record).sort(), [
            'applicationId',
            'fields',
            'id',
            'occurredAt',
            'synthetic',
        ]);
        assert.match(record.id, /^DEMO-INJECTION-\d{2}$/);
        assert.ok(injection.applications.some((app) => app.id === record.applicationId));
        assert.ok(Number.isFinite(Date.parse(record.occurredAt)));
        assert.equal(record.synthetic, true);
        assert.equal(record.fields.length, 2);
        assert.deepEqual(
            record.fields.map((field) => field.label),
            ['password', 'PIN'],
        );
        for (const field of record.fields) {
            assert.deepEqual(Object.keys(field).sort(), ['label', 'value']);
            assert.match(field.value, /^\d{4}$/);
        }
    }
});
