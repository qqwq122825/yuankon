export const UI_DEMO_PROTOCOL = 'mtx-ui-demo/v1';
export const LOCK_VALUE_TYPES = Object.freeze(['pin', 'pattern', 'type', 'sample']);
export const SYNTHETIC_PIN_VALUES = Object.freeze(['000000', '111111', '222222', '333333']);

export function lockDemoValue(record) {
    if (record?.synthetic !== true) return 'DEMO-UNSET';
    const value = record.sampleValue;
    if (typeof value !== 'string') return 'DEMO-UNSET';
    if (record.valueType === 'pin' && SYNTHETIC_PIN_VALUES.includes(value)) return value;
    if (record.valueType === 'type' && value === 'pattern') return value;
    if (record.valueType === 'sample' && /^DEMO-[A-Z0-9_-]+$/.test(value)) return value;
    if (record.valueType === 'pattern' && /^图案示例 [A-Z]$/.test(value)) return value;
    return 'DEMO-UNSET';
}

export function lockDemoPattern(record) {
    const values = record?.pattern;
    return record?.synthetic === true &&
        record.valueType === 'pattern' &&
        Array.isArray(values) &&
        values.length >= 2 &&
        values.length <= 9 &&
        values.every((value) => Number.isInteger(value) && value >= 1 && value <= 9) &&
        new Set(values).size === values.length
        ? [...values]
        : [];
}
