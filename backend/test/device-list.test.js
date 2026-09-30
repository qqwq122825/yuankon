import { test } from 'node:test';
import assert from 'node:assert/strict';
import { deviceListQuery, localDevicePage } from '../../frontend/src/device-list.js';

const rows = Array.from({ length: 24 }, (_, index) => ({
    id: index + 1,
    source: index < 4 ? 'sample' : 'api',
    status: index > 19 ? 'online' : 'offline',
    is_blacklisted: index === 23,
    accessibility_enabled: index === 22 ? null : index % 2 === 0,
}));
const result = { data: rows, total: rows.length, filters: { sort: 'id', direction: 'asc' } };

test('quick filters and local paging never change the server request key', () => {
    const base = deviceListQuery({ q: 'device', sort: 'brand', direction: 'desc' });
    assert.equal(
        deviceListQuery({
            q: 'device',
            sort: 'brand',
            direction: 'desc',
            status: 'online',
            a11y: 'enabled',
            source: 'api',
            page: 9,
        }),
        base,
    );
    assert.equal(new URLSearchParams(base).get('perPage'), '500');
    assert.equal(new URLSearchParams(base).has('status'), false);
    assert.notEqual(deviceListQuery({ q: 'different' }), deviceListQuery({}));
    assert.notEqual(deviceListQuery({ sort: 'brand' }), deviceListQuery({}));
});
test('online filter covers devices beyond UI page one and excludes blacklisted devices', () => {
    const page = localDevicePage(result, { status: 'online' });
    assert.deepEqual(
        page.data.map((row) => row.id),
        [21, 22, 23],
    );
    assert.equal(page.total, 3);
    assert.equal(page.page, 1);
    assert.equal(result.total, 24);
    assert.equal(result.data.length, 24);
});
test('combined filters, unknown accessibility, empty results and page bounds stay consistent', () => {
    assert.deepEqual(
        localDevicePage(result, { status: 'online', a11y: 'enabled', source: 'api' }).data.map(
            (row) => row.id,
        ),
        [21],
    );
    assert.deepEqual(
        localDevicePage(result, { status: 'online', a11y: 'disabled' }).data.map((row) => row.id),
        [22],
    );
    assert.equal(localDevicePage(result, { status: 'online', source: 'sample', page: 5 }).total, 0);
    assert.equal(localDevicePage(result, { status: 'online', source: 'sample', page: 5 }).page, 1);
    assert.equal(localDevicePage(result, { page: 999 }).page, 3);
    assert.equal(localDevicePage(result, { page: 'bad' }).page, 1);
    assert.equal(localDevicePage(result, { page: 2 }).data[0].id, 11);
    assert.equal(localDevicePage(result, { status: 'offline' }).total, 21);
    assert.equal(localDevicePage(null, {}), null);
});
test('local filters preserve SQL ordering, row objects and current-page selection inputs', () => {
    const descending = { ...result, data: [...rows].reverse() };
    const visible = localDevicePage(descending, { status: 'online' });
    assert.deepEqual(
        visible.data.map((row) => row.id),
        [23, 22, 21],
    );
    assert.equal(visible.data[0], rows[22]);
});
