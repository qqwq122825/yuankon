import { fail } from './protocol.js';

// Administrative record lifecycle only. No device-side data deletion commands.
export class DeviceManagement {
    constructor(db, store, ingress) {
        Object.assign(this, { db, store, ingress });
    }
    async change(id, { blacklisted, remove = false }, actorId) {
        let changed = false;
        const device = await this.db.transaction(async (trx) => {
            const query = trx('devices').where('id', id);
            if (this.store.projectId !== null) query.where('project_id', this.store.projectId);
            const row = await query.first();
            if (!row || (row.deleted_at && !remove)) throw fail(404, '设备不存在');
            if (row.deleted_at || (!remove && Boolean(row.is_blacklisted) === blacklisted))
                return row;
            const patch = remove
                ? { deleted_at: Date.now(), is_blacklisted: true }
                : { is_blacklisted: blacklisted };
            changed = true;
            await trx('devices').where('id', id).update(patch);
            if (remove)
                await trx('device_credentials').where('device_id', id).update({ revoked: true });
            const type = remove
                ? 'device_deleted'
                : blacklisted
                  ? 'device_blacklisted'
                  : 'device_unblacklisted';
            await trx('protocol_logs').insert({
                project_id: row.project_id,
                ts: Date.now(),
                device_id: row.public_id,
                dir: 'down',
                channel: 'http',
                type,
                size: 0,
            });
            await trx('account_audit').insert({
                ts: Date.now(),
                actor_id: actorId,
                event: `${type}:${row.public_id}`,
                ip: null,
            });
            return { ...row, ...patch };
        });
        if (!changed) return device;
        this.ingress.frames.delete(id);
        this.ingress.nodeFrames.delete(id);
        this.ingress.viewerLeases.delete(id);
        this.ingress.grants.delete(id);
        this.ingress.pendingCaptures.delete(id);
        this.ingress.autoCaptureAt.delete(id);
        this.store.live.delete(device.public_id);
        this.disconnect?.(device.public_id, Boolean(device.deleted_at));
        await this.notify?.(device);
        return device;
    }
}
