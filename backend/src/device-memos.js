import { fail } from './protocol.js';

export class DeviceMemos {
    constructor(db, store) {
        Object.assign(this, { db, store });
    }

    query(device) {
        return this.db('device_memos')
            .leftJoin('accounts', 'accounts.id', 'device_memos.author_account_id')
            .where({
                'device_memos.project_id': device.project_id,
                'device_memos.device_id': device.id,
            });
    }

    dto(row) {
        return {
            id: row.id,
            body: row.body,
            label: row.label,
            author: row.author || '已停用账号',
            createdAt: Number(row.created_at),
            updatedAt: Number(row.updated_at),
        };
    }

    async list(deviceId) {
        const device = await this.store.device(deviceId);
        const rows = await this.query(device)
            .select('device_memos.*', 'accounts.username as author')
            .orderBy('device_memos.created_at', 'desc')
            .orderBy('device_memos.id', 'desc');
        return { data: rows.map((row) => this.dto(row)), total: rows.length };
    }

    async create(deviceId, input, actorId) {
        const device = await this.store.device(deviceId);
        const now = Date.now();
        const [id] = await this.db('device_memos').insert({
            project_id: device.project_id,
            device_id: device.id,
            author_account_id: actorId,
            body: input.body,
            label: input.label,
            created_at: now,
            updated_at: now,
        });
        return this.one(device, id);
    }

    async update(deviceId, memoId, input) {
        const device = await this.store.device(deviceId);
        const changed = await this.db('device_memos')
            .where({ project_id: device.project_id, device_id: device.id, id: memoId })
            .update({ body: input.body, label: input.label, updated_at: Date.now() });
        if (!changed) throw fail(404, '备忘不存在');
        return this.one(device, memoId);
    }

    async remove(deviceId, memoId) {
        const device = await this.store.device(deviceId);
        const removed = await this.db('device_memos')
            .where({ project_id: device.project_id, device_id: device.id, id: memoId })
            .delete();
        if (!removed) throw fail(404, '备忘不存在');
    }

    async one(device, memoId) {
        const row = await this.query(device)
            .where('device_memos.id', memoId)
            .first('device_memos.*', 'accounts.username as author');
        if (!row) throw fail(404, '备忘不存在');
        return this.dto(row);
    }
}
