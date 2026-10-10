import { validFixtureEnvelope } from './device-fixture-protocol.js';

export const INJECTION_DEMO_PROTOCOL = 'mtx-injection-match-demo/v1';
const packagePattern = /^dev\.mtx\.demo\.[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)*$/;
const demoId = (value) =>
    typeof value === 'string' && value.length <= 64 && /^DEMO-[A-Z0-9_-]+$/.test(value);
const text = (value, max) => typeof value === 'string' && value.length > 0 && value.length <= max;
const object = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
function listValid(items, validate) {
    return (
        Array.isArray(items) &&
        items.length <= 100 &&
        items.every(
            (item) =>
                object(item) &&
                item.synthetic === true &&
                demoId(item.id) &&
                typeof item.packageName === 'string' &&
                packagePattern.test(item.packageName) &&
                validate(item),
        ) &&
        new Set(items.map((item) => item.id)).size === items.length &&
        new Set(items.map((item) => item.packageName)).size === items.length
    );
}
function emptyResult() {
    return {
        valid: false,
        protocol: INJECTION_DEMO_PROTOCOL,
        registryCount: 0,
        installedCount: 0,
        matchedCount: 0,
        applications: [],
    };
}
export function matchInjectionDemo(fixture) {
    if (
        !validFixtureEnvelope(fixture, INJECTION_DEMO_PROTOCOL) ||
        fixture.schemaVersion !== 1 ||
        fixture.source !== 'synthetic-ui-fixture' ||
        fixture.fixtureOnly !== true ||
        !demoId(fixture.registryId) ||
        !demoId(fixture.installedReportId) ||
        !listValid(
            fixture.globalInjectionList,
            (item) =>
                text(item.name, 60) &&
                /^样例/.test(item.name) &&
                text(item.initial, 2) &&
                typeof item.enabled === 'boolean',
        ) ||
        !listValid(fixture.installedApplications, () => true) ||
        !listValid(
            fixture.applicationStates,
            (item) =>
                ['skipped', 'injected'].includes(item.status) &&
                typeof item.time === 'string' &&
                /^\d{2}\/\d{2} \d{2}:\d{2}$/.test(item.time) &&
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
        )
    )
        return emptyResult();
    const installed = new Set(fixture.installedApplications.map((item) => item.packageName));
    const states = new Map(fixture.applicationStates.map((item) => [item.packageName, item]));
    const matches = fixture.globalInjectionList.filter(
        (item) => item.enabled && installed.has(item.packageName),
    );
    if (matches.some((item) => !states.has(item.packageName))) return emptyResult();
    const applications = matches.map((item) => {
        const state = states.get(item.packageName);
        return {
            id: item.id,
            name: item.name,
            initial: item.initial,
            packageName: item.packageName,
            status: state.status,
            time: state.time,
            fields: state.fields.map((field) => ({ label: field.label, value: field.value })),
            skip: state.status === 'skipped',
            synthetic: true,
        };
    });
    return {
        valid: true,
        protocol: INJECTION_DEMO_PROTOCOL,
        registryCount: fixture.globalInjectionList.length,
        installedCount: fixture.installedApplications.length,
        matchedCount: applications.length,
        applications,
    };
}
