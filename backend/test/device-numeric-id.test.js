import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openDatabase } from '../src/database.js';
import { Store } from '../src/store.js';

test('device IDs sort numerically and search by primary key without changing public identity or scope', async () => {
    const db = await openDatabase(':memory:');
    try {
        await db('devices').insert([
            { id: 2, project_id: 1, public_id: 'ZZZ', name: 'Phone A' },
            { id: 10, project_id: 1, public_id: 'MMM', name: 'Phone B' },
            { id: 100, project_id: 1, public_id: 'AAA', name: 'Phone C' },
            { id: 200, project_id: 2, public_id: 'OTHER', name: 'Phone D' },
        ]);
        const store = new Store(db, 1);
        const ids = (result) => result.data.map((row) => row.id);
        assert.deepEqual(ids(await store.list({ sort: 'id', direction: 'asc' })), [2, 10, 100]);
        assert.deepEqual(ids(await store.list({ sort: 'id', direction: 'desc' })), [100, 10, 2]);
        const second = await store.list({ sort: 'id', perPage: 1, page: 2 });
        assert.deepEqual(ids(second), [10]);
        assert.equal(second.total, 3);
        assert.deepEqual(ids(await store.list({ q: ' 10 ' })), [10]);
        assert.deepEqual(ids(await store.list({ q: 'MMM' })), [10]);
        assert.deepEqual(ids(await store.list({ q: 'Phone A' })), [2]);
        assert.deepEqual(ids(await store.list({ q: '200' })), []);
        assert.deepEqual(ids(await store.list({ q: '999999' })), []);
        await assert.rejects(store.list({ sort: 'devices.id' }), /Invalid/);
        await assert.rejects(store.list({ direction: 'DROP' }), /Invalid/);
        assert.deepEqual(
            (await db('devices').where('project_id', 1).orderBy('id')).map((row) => row.public_id),
            ['ZZZ', 'MMM', 'AAA'],
        );
    } finally {
        await db.destroy();
    }
});
