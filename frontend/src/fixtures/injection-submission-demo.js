import { validFixtureEnvelope } from './device-fixture-protocol.js';
import { INJECTION_DEMO_PROTOCOL } from './injection-demo-match.js';

export const INJECTION_SUBMISSION_DEMO_PROTOCOL = 'mtx-injection-submission-demo/v1';
const sampleValues = new Set(['000000', '111111', '222222', '333333']);
const fieldLabels = new Map([
    ['password', '密码'],
    ['pin', 'PIN'],
]);
const object = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const demoId = (value) =>
    typeof value === 'string' && value.length <= 64 && /^DEMO-[A-Z0-9_-]+$/.test(value);
const demoPackage = (value) =>
    typeof value === 'string' &&
    /^dev\.mtx\.demo\.[a-z][a-z0-9_]*(?:\.[a-z][a-z0-9_]*)*$/.test(value);
function validTimestamp(value) {
    if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/.test(value))
        return false;
    const date = new Date(value);
    return Number.isFinite(date.getTime()) && date.toISOString().replace('.000Z', 'Z') === value;
}

// Only preset fictional values can enter this local presentation protocol.
export function validInjectionSubmission(record) {
    return (
        object(record) &&
        record.synthetic === true &&
        demoId(record.id) &&
        demoId(record.applicationId) &&
        demoPackage(record.packageName) &&
        record.status === 'submitted' &&
        record.formType === 'form' &&
        validTimestamp(record.submittedAt) &&
        Array.isArray(record.fields) &&
        record.fields.length >= 1 &&
        record.fields.length <= 2 &&
        record.fields.every(
            (field) =>
                object(field) &&
                fieldLabels.has(field.kind) &&
                field.label === fieldLabels.get(field.kind) &&
                sampleValues.has(field.sampleValue),
        ) &&
        new Set(record.fields.map((field) => field.kind)).size === record.fields.length
    );
}

function copySubmission(record) {
    return {
        id: record.id,
        applicationId: record.applicationId,
        packageName: record.packageName,
        status: record.status,
        formType: record.formType,
        submittedAt: record.submittedAt,
        fields: record.fields.map((field) => ({
            kind: field.kind,
            label: field.label,
            sampleValue: field.sampleValue,
        })),
        synthetic: true,
    };
}

function emptyResult() {
    return {
        valid: false,
        protocol: INJECTION_DEMO_PROTOCOL,
        registryCount: 0,
        installedCount: 0,
        matchedCount: 0,
        submissionProtocol: INJECTION_SUBMISSION_DEMO_PROTOCOL,
        submittedCount: 0,
        applications: [],
    };
}

function validMatch(result) {
    return (
        object(result) &&
        result.valid === true &&
        result.protocol === INJECTION_DEMO_PROTOCOL &&
        [result.registryCount, result.installedCount, result.matchedCount].every(
            (count) => Number.isSafeInteger(count) && count >= 0 && count <= 100,
        ) &&
        Array.isArray(result.applications) &&
        result.applications.length === result.matchedCount &&
        result.matchedCount <= Math.min(result.registryCount, result.installedCount) &&
        result.applications.every(
            (item) =>
                object(item) &&
                item.synthetic === true &&
                demoId(item.id) &&
                demoPackage(item.packageName) &&
                typeof item.name === 'string' &&
                item.name.startsWith('样例') &&
                item.name.length <= 60 &&
                typeof item.initial === 'string' &&
                item.initial.length >= 1 &&
                item.initial.length <= 2 &&
                ['skipped', 'injected'].includes(item.status) &&
                typeof item.time === 'string' &&
                /^\d{2}\/\d{2} \d{2}:\d{2}$/.test(item.time) &&
                typeof item.skip === 'boolean' &&
                (item.status === 'skipped') === item.skip &&
                Array.isArray(item.fields) &&
                item.fields.length <= 2 &&
                item.fields.every(
                    (field) =>
                        object(field) &&
                        typeof field.label === 'string' &&
                        /^测试字段 [AB]$/.test(field.label) &&
                        typeof field.value === 'string' &&
                        /^DEMO-[A-Z0-9_-]{1,64}$/.test(field.value),
                ),
        ) &&
        new Set(result.applications.map((item) => item.id)).size === result.applications.length &&
        new Set(result.applications.map((item) => item.packageName)).size ===
            result.applications.length
    );
}

export function attachInjectionSubmissions(matchResult, fixture) {
    if (
        !validMatch(matchResult) ||
        !validFixtureEnvelope(fixture, INJECTION_SUBMISSION_DEMO_PROTOCOL) ||
        fixture.schemaVersion !== 1 ||
        fixture.source !== 'synthetic-ui-fixture' ||
        fixture.fixtureOnly !== true ||
        !Array.isArray(fixture.records) ||
        fixture.records.length > 100 ||
        !fixture.records.every(validInjectionSubmission) ||
        ['id', 'applicationId', 'packageName'].some(
            (key) =>
                new Set(fixture.records.map((item) => item[key])).size !== fixture.records.length,
        )
    )
        return emptyResult();
    const matched = new Map(matchResult.applications.map((item) => [item.id, item]));
    if (
        fixture.records.some(
            (record) => matched.get(record.applicationId)?.packageName !== record.packageName,
        )
    )
        return emptyResult();
    const submissions = new Map(fixture.records.map((record) => [record.applicationId, record]));
    const applications = matchResult.applications.map((item) => {
        const record = submissions.get(item.id);
        return {
            id: item.id,
            name: item.name,
            initial: item.initial,
            packageName: item.packageName,
            status: record ? 'submitted' : item.status,
            time: record
                ? `${record.submittedAt.slice(5, 7)}/${record.submittedAt.slice(8, 10)} ${record.submittedAt.slice(11, 16)}`
                : item.time,
            fields: item.fields.map((field) => ({ label: field.label, value: field.value })),
            skip: record ? false : item.skip,
            synthetic: true,
            submission: record ? copySubmission(record) : null,
        };
    });
    return {
        valid: true,
        protocol: INJECTION_DEMO_PROTOCOL,
        registryCount: matchResult.registryCount,
        installedCount: matchResult.installedCount,
        matchedCount: applications.length,
        submissionProtocol: INJECTION_SUBMISSION_DEMO_PROTOCOL,
        submittedCount: fixture.records.length,
        applications,
    };
}
