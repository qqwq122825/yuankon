import { test } from 'node:test';
import assert from 'node:assert/strict';
import { deviceListQuery, localDevicePage } from '../../frontend/src/device-list.js';

const ids = (view) => view.data.map((row) => row.id);

test('blacklist mode selects only strict true flags and stays outside the server request key', () => {
    const flags = [true, false, null, undefined, 1, 0, 'true', '1', {}, []];
    const data = flags.map((is_blacklisted, index) => ({ id: index + 1, is_blacklisted }));
    const result = { data, total: data.length, filters: { sort: 'id', direction: 'asc' } };
    const view = localDevicePage(result, { blacklisted: '1' });
    assert.deepEqual(ids(view), [1]);
    assert.equal(view.total, 1);
    assert.equal(view.data[0], data[0]);
    for (const value of [undefined, '', '0', 'true', 1, true, false])
        assert.equal(localDevicePage(result, { blacklisted: value }).total, flags.length);
    assert.equal(
        deviceListQuery({ q: 'fixture', sort: 'id', direction: 'desc', blacklisted: '1', page: 2 }),
        deviceListQuery({ q: 'fixture', sort: 'id', direction: 'desc' }),
    );
    assert.equal(
        new URLSearchParams(deviceListQuery({ blacklisted: '1' })).has('blacklisted'),
        false,
    );
    assert.equal(result.data.length, flags.length);
    assert.equal(result.total, flags.length);
});

test('blacklist filtering combines with blocked-online semantics, accessibility, source and Beijing date', () => {
    const installed = Date.UTC(2026, 8, 30, 16);
    const data = [
        {
            id: 1,
            is_blacklisted: true,
            status: 'online',
            accessibility_enabled: true,
            source: 'api',
            installed_at: installed,
        },
        {
            id: 2,
            is_blacklisted: true,
            status: 'offline',
            accessibility_enabled: true,
            source: 'api',
            installed_at: installed,
        },
        {
            id: 3,
            is_blacklisted: true,
            status: 'offline',
            accessibility_enabled: false,
            source: 'sample',
            installed_at: installed - 1000,
        },
        {
            id: 4,
            is_blacklisted: false,
            status: 'offline',
            accessibility_enabled: true,
            source: 'api',
            installed_at: installed,
        },
        {
            id: 5,
            is_blacklisted: 'true',
            status: 'offline',
            accessibility_enabled: true,
            source: 'api',
            installed_at: installed,
        },
    ];
    const result = { data, total: data.length, filters: { sort: 'id', direction: 'desc' } };
    assert.deepEqual(ids(localDevicePage(result, { blacklisted: '1', status: 'online' })), []);
    assert.deepEqual(
        ids(localDevicePage(result, { blacklisted: '1', status: 'offline' })),
        [3, 2, 1],
    );
    assert.deepEqual(
        ids(
            localDevicePage(result, {
                blacklisted: '1',
                status: 'offline',
                a11y: 'enabled',
                source: 'api',
                installedDate: '2026-10-01',
            }),
        ),
        [2, 1],
    );
    assert.deepEqual(
        ids(
            localDevicePage(result, {
                blacklisted: '1',
                a11y: 'disabled',
                source: 'sample',
                installedDate: '2026-09-30',
            }),
        ),
        [3],
    );
    assert.equal(
        localDevicePage(result, { blacklisted: '1', installedDate: '2026-10-02' }).total,
        0,
    );
    assert.deepEqual(
        data.map((row) => row.id),
        [1, 2, 3, 4, 5],
    );
});

test('blacklist empty results and filtered page bounds are clamped without mutating the source', () => {
    const data = Array.from({ length: 51 }, (_, index) => ({
        id: index + 1,
        is_blacklisted: index < 25,
    }));
    const result = { data, total: data.length, filters: { sort: 'id', direction: 'asc' } };
    const second = localDevicePage(result, { blacklisted: '1', page: 2 });
    assert.equal(second.total, 25);
    assert.equal(second.page, 2);
    assert.equal(second.perPage, 10);
    assert.deepEqual(ids(second), [11, 12, 13, 14, 15, 16, 17, 18, 19, 20]);
    const last = localDevicePage(result, { blacklisted: '1', page: 999 });
    assert.equal(last.page, 3);
    assert.deepEqual(ids(last), [21, 22, 23, 24, 25]);
    for (const page of [0, -1, 'invalid', 1.5, Number.MAX_SAFE_INTEGER + 1])
        assert.equal(localDevicePage(result, { blacklisted: '1', page }).page, 1);
    const empty = localDevicePage(
        { data: [{ id: 1, is_blacklisted: false }], total: 1 },
        { blacklisted: '1', page: 99 },
    );
    assert.equal(empty.total, 0);
    assert.equal(empty.page, 1);
    assert.deepEqual(empty.data, []);
    assert.equal(localDevicePage(null, { blacklisted: '1' }), null);
    assert.deepEqual(ids(localDevicePage({ data: [] }, { blacklisted: '1' })), []);
    assert.equal(result.data.length, 51);
    assert.equal(result.total, 51);
    assert.deepEqual(
        result.data.map((row) => row.id),
        Array.from({ length: 51 }, (_, index) => index + 1),
    );
    assert.equal(second.data[0], data[10]);
});
