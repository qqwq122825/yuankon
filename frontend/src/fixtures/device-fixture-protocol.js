import {
    UI_DEMO_PROTOCOL,
    LOCK_VALUE_TYPES,
    lockDemoValue,
    lockDemoPattern,
} from './device-demo-protocol.js';

// Presentation fixtures are separate from the authenticated, empty HTTP preview protocol.
export const DEMO_DATASET_ID = 'DEMO-DEVICE-01';
export const FIXTURE_PROTOCOLS = Object.freeze({
    apps: 'mtx-apps-demo/v1',
    sms: 'mtx-sms-demo/v1',
    records: 'mtx-records-demo/v1',
    payments: 'mtx-payments-demo/v1',
    injectionRecords: 'mtx-injection-records-demo/v1',
    gallery: 'mtx-gallery-demo/v1',
    analysis: 'mtx-analysis-demo/v1',
    memos: 'mtx-memos-demo/v1',
});
const object = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const text = (value, max) => typeof value === 'string' && value.length > 0 && value.length <= max;
const id = (value) => text(value, 64) && /^DEMO-[A-Z0-9_-]+$/.test(value);
const packageName = (value) =>
    text(value, 150) && /^dev\.mtx\.demo\.[a-z][a-z0-9_]*(?:\.[a-z][a-z0-9_]*)*$/.test(value);
const sampleName = (value) => text(value, 60) && value.startsWith('样例');
const token = (value) => text(value, 80) && /^DEMO-[A-Z0-9_-]+$/.test(value);
export function validFixtureEnvelope(fixture, protocol) {
    return (
        object(fixture) &&
        fixture.protocol === protocol &&
        fixture.schemaVersion === 1 &&
        fixture.datasetId === DEMO_DATASET_ID &&
        fixture.source === 'synthetic-ui-fixture' &&
        fixture.fixtureOnly === true
    );
}
export function validFixtureTimestamp(value) {
    if (typeof value !== 'string') return false;
    const parts = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(Z|[+-]\d{2}:\d{2})$/.exec(
        value,
    );
    if (!parts) return false;
    const [, y, m, d, h, minute, second, zone] = parts;
    const year = Number(y),
        month = Number(m),
        day = Number(d);
    if (
        year < 2000 ||
        year > 2099 ||
        month < 1 ||
        month > 12 ||
        day < 1 ||
        day > new Date(Date.UTC(year, month, 0)).getUTCDate() ||
        Number(h) > 23 ||
        Number(minute) > 59 ||
        Number(second) > 59
    )
        return false;
    if (
        zone !== 'Z' &&
        (Number(zone.slice(1, 3)) > 14 ||
            Number(zone.slice(4)) > 59 ||
            (Number(zone.slice(1, 3)) === 14 && Number(zone.slice(4)) !== 0))
    )
        return false;
    return Number.isFinite(Date.parse(value));
}
function list(items, validate, uniqueKeys = ['id']) {
    return (
        Array.isArray(items) &&
        items.length <= 100 &&
        items.every(
            (item) => object(item) && id(item.id) && item.synthetic === true && validate(item),
        ) &&
        uniqueKeys.every((key) => new Set(items.map((item) => item[key])).size === items.length)
    );
}
const pick = (item, fields) => Object.fromEntries(fields.map((field) => [field, item[field]]));
function readList(fixture, protocol, key, validate, fields, uniqueKeys) {
    const valid =
        validFixtureEnvelope(fixture, protocol) && list(fixture[key], validate, uniqueKeys);
    return { valid, [key]: valid ? fixture[key].map((item) => pick(item, fields)) : [] };
}
export function readAppsDemo(fixture) {
    return readList(
        fixture,
        FIXTURE_PROTOCOLS.apps,
        'applications',
        (a) =>
            sampleName(a.name) &&
            packageName(a.packageName) &&
            text(a.initial, 2) &&
            typeof a.system === 'boolean' &&
            a.group === (a.system ? '系统应用' : '常用应用'),
        ['id', 'name', 'packageName', 'initial', 'system', 'group', 'synthetic'],
        ['id', 'packageName'],
    );
}
export function readSmsDemo(fixture) {
    return readList(
        fixture,
        FIXTURE_PROTOCOLS.sms,
        'messages',
        (m) =>
            text(m.sender, 30) &&
            token(m.address) &&
            text(m.body, 500) &&
            m.body.startsWith('【合成测试】') &&
            validFixtureTimestamp(m.receivedAt),
        ['id', 'sender', 'address', 'body', 'receivedAt', 'synthetic'],
    );
}
function canonicalApplication(catalogFixture, name, pkg) {
    if (catalogFixture === undefined) return true;
    const catalog = readAppsDemo(catalogFixture);
    return (
        catalog.valid && catalog.applications.some((a) => a.name === name && a.packageName === pkg)
    );
}
const typeLabels = { app: 'APP', keyboard: '键盘', pin: 'PIN' };
export function readRecordDemo(fixture, catalogFixture) {
    return readList(
        fixture,
        FIXTURE_PROTOCOLS.records,
        'records',
        (r) =>
            Object.hasOwn(typeLabels, r.type) &&
            r.typeLabel === typeLabels[r.type] &&
            text(r.content, 500) &&
            /^DEMO-/.test(r.content) &&
            sampleName(r.appName) &&
            packageName(r.packageName) &&
            canonicalApplication(catalogFixture, r.appName, r.packageName) &&
            validFixtureTimestamp(r.occurredAt),
        ['id', 'type', 'typeLabel', 'content', 'appName', 'packageName', 'occurredAt', 'synthetic'],
    );
}
function readAssociated(
    fixture,
    protocol,
    validateApp,
    appFields,
    validateRecord,
    recordFields,
    foreignKey,
) {
    const validApps =
        validFixtureEnvelope(fixture, protocol) &&
        list(fixture.applications, validateApp, ['id', 'packageName']);
    const appIds = validApps ? new Set(fixture.applications.map((a) => a.id)) : new Set();
    const valid =
        validApps && list(fixture.records, (r) => appIds.has(r[foreignKey]) && validateRecord(r));
    return {
        valid,
        applications: valid ? fixture.applications.map((a) => pick(a, appFields)) : [],
        records: valid ? fixture.records.map((r) => pick(r, recordFields)) : [],
    };
}
export function readPaymentDemo(fixture, catalogFixture) {
    return readAssociated(
        fixture,
        FIXTURE_PROTOCOLS.payments,
        (a) =>
            sampleName(a.name) &&
            packageName(a.packageName) &&
            text(a.ageLabel, 40) &&
            canonicalApplication(catalogFixture, a.name, a.packageName),
        ['id', 'name', 'packageName', 'ageLabel', 'synthetic'],
        (r) =>
            token(r.value) &&
            r.kind === 'APP密码' &&
            validFixtureTimestamp(r.occurredAt) &&
            typeof r.success === 'boolean',
        ['id', 'appId', 'value', 'kind', 'occurredAt', 'success', 'synthetic'],
        'appId',
    );
}
const injectionFieldPatterns = Object.freeze({
    password: /^\d{4}$/,
    PIN: /^\d{4}$/,
});
function validInjectionFields(fields) {
    return (
        Array.isArray(fields) &&
        fields.length === 2 &&
        fields.every(
            (field) =>
                object(field) &&
                Object.hasOwn(injectionFieldPatterns, field.label) &&
                injectionFieldPatterns[field.label].test(field.value),
        ) &&
        new Set(fields.map((field) => field.label)).size === fields.length
    );
}
export function readInjectionRecordsDemo(fixture, catalogFixture) {
    const result = readAssociated(
        fixture,
        FIXTURE_PROTOCOLS.injectionRecords,
        (a) =>
            sampleName(a.name) &&
            packageName(a.packageName) &&
            text(a.initial, 2) &&
            a.status === 'submitted' &&
            canonicalApplication(catalogFixture, a.name, a.packageName),
        ['id', 'name', 'packageName', 'initial', 'status', 'synthetic'],
        (r) => validFixtureTimestamp(r.occurredAt) && validInjectionFields(r.fields),
        ['id', 'applicationId', 'occurredAt', 'fields', 'synthetic'],
        'applicationId',
    );
    result.records = result.records.map((r) => ({
        ...r,
        fields: r.fields.map((f) => pick(f, ['label', 'value'])),
    }));
    return result;
}
export function readGalleryDemo(fixture) {
    return readList(
        fixture,
        FIXTURE_PROTOCOLS.gallery,
        'items',
        (i) =>
            sampleName(i.title) &&
            ['landscape', 'geometry'].includes(i.assetId) &&
            i.mimeType === 'image/svg+xml' &&
            i.width === 320 &&
            i.height === 180 &&
            validFixtureTimestamp(i.createdAt),
        ['id', 'title', 'assetId', 'mimeType', 'width', 'height', 'createdAt', 'synthetic'],
        ['id', 'assetId'],
    );
}
export function readAnalysisDemo(fixture, smsFixture) {
    const validSources = smsFixture === undefined || readSmsDemo(smsFixture).valid;
    const smsIds = new Set(
        smsFixture === undefined
            ? Array.from({ length: 8 }, (_, i) => `DEMO-SMS-0${i + 1}`)
            : readSmsDemo(smsFixture).messages.map((m) => m.id),
    );
    if (!validSources) return { valid: false, items: [] };
    const result = readList(
        fixture,
        FIXTURE_PROTOCOLS.analysis,
        'items',
        (i) =>
            text(i.title, 40) &&
            text(i.summary, 500) &&
            i.summary.startsWith('【合成测试】') &&
            Array.isArray(i.messageIds) &&
            i.messageIds.length > 0 &&
            i.messageIds.length <= 100 &&
            i.messageIds.every((id) => smsIds.has(id)) &&
            new Set(i.messageIds).size === i.messageIds.length,
        ['id', 'title', 'summary', 'messageIds', 'synthetic'],
    );
    result.items = result.items.map((i) => ({ ...i, messageIds: [...i.messageIds] }));
    return result;
}
export function readMemosDemo(fixture) {
    return readList(
        fixture,
        FIXTURE_PROTOCOLS.memos,
        'items',
        (i) =>
            text(i.body, 500) &&
            i.body.startsWith('【合成测试】') &&
            ['none', 'important', 'follow_up', 'handled'].includes(i.label) &&
            sampleName(i.author) &&
            validFixtureTimestamp(i.createdAt) &&
            validFixtureTimestamp(i.updatedAt) &&
            Date.parse(i.updatedAt) >= Date.parse(i.createdAt),
        ['id', 'body', 'label', 'author', 'createdAt', 'updatedAt', 'synthetic'],
    );
}

export function readLockDemo(fixture) {
    const result = readList(
        fixture,
        UI_DEMO_PROTOCOL,
        'lockEvents',
        (r) =>
            ['system', 'scenario', 'app'].includes(r.category) &&
            text(r.label, 24) &&
            packageName(r.source) &&
            typeof r.time === 'string' &&
            /^(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d$/.test(r.time) &&
            LOCK_VALUE_TYPES.includes(r.valueType) &&
            lockDemoValue(r) !== 'DEMO-UNSET' &&
            (r.valueType === 'pattern' ? lockDemoPattern(r).length >= 2 : r.pattern === undefined),
        ['id', 'category', 'label', 'sampleValue', 'source', 'time', 'synthetic', 'valueType'],
    );
    result.lockEvents = result.lockEvents.map((r, i) =>
        r.valueType === 'pattern' ? { ...r, pattern: [...fixture.lockEvents[i].pattern] } : r,
    );
    return result;
}
