import { listSchema, SORT_COLUMNS, normalizeSnapshot, labelsFor, fail } from './protocol.js';
export class Store {
    constructor(db, projectId) {
        this.db = db;
        this.projectId = projectId;
        this.live = new Map();
    }
    devices() {
        const query = this.db('devices').whereNull('devices.deleted_at');
        return this.projectId === null ? query : query.where('devices.project_id', this.projectId);
    }
    async device(id, publicId = false) {
        const row = await this.devices()
            .where(publicId ? 'public_id' : 'id', id)
            .first();
        if (!row) throw fail(404, '设备不存在');
        return this.dto(row);
    }
    dto(row) {
        const live = row.is_blacklisted ? null : this.live.get(row.public_id);
        return {
            ...row,
            is_blacklisted: Boolean(row.is_blacklisted),
            accessibility_enabled:
                row.accessibility_enabled === null ? null : Boolean(row.accessibility_enabled),
            status: live && Date.now() - live.seen < 90000 ? 'online' : 'offline',
            isLocked: live?.isLocked ?? null,
            isScreenOn: live?.isScreenOn ?? null,
            lastSeen: live?.seen ?? null,
        };
    }
    installedAtExpression() {
        return this.db.raw(
            `COALESCE(
                (SELECT credential.registered_at
                   FROM device_credentials AS credential
                  WHERE credential.device_id = devices.id
                  LIMIT 1),
                (SELECT MIN(registration_log.ts)
                   FROM protocol_logs AS registration_log
                  WHERE registration_log.device_id = devices.public_id
                    AND registration_log.type IN (?, ?))
            )`,
            ['device_auto_registered', 'device_registered'],
        );
    }
    async list(input) {
        const filter = listSchema.parse(input);
        const base = this.devices().select('devices.*');
        const snap = this.db('snapshots')
            .whereColumn('device_id', 'devices.id')
            .whereColumn('project_id', 'devices.project_id');
        base.select({
            owner_username: this.db('accounts')
                .select('username')
                .whereColumn('accounts.id', 'devices.owner_account_id')
                .limit(1),
            memo_count: this.db('device_memos')
                .whereColumn('device_id', 'devices.id')
                .whereColumn('project_id', 'devices.project_id')
                .count('*'),
            installed_at: this.installedAtExpression(),
            snapshots_count: snap.clone().count('*'),
            node_count: snap.clone().select('node_count').orderBy('id', 'desc').limit(1),
            window_count: snap.clone().select('window_count').orderBy('id', 'desc').limit(1),
        });
        if (filter.q.trim())
            base.where((q) => {
                const term = `%${filter.q.trim()}%`;
                for (const c of [
                    'devices.name',
                    'devices.public_id',
                    'devices.note',
                    'devices.brand',
                    'devices.app_name',
                    'devices.app_version',
                    'devices.apk_id',
                ])
                    q.orWhere(c, 'like', term);
                q.orWhereExists(
                    this.db('accounts')
                        .select(this.db.raw('1'))
                        .whereColumn('accounts.id', 'devices.owner_account_id')
                        .where('accounts.username', 'like', term),
                );
            });
        if (filter.source) base.where('source', filter.source);
        if (filter.a11y) base.where('accessibility_enabled', filter.a11y === 'enabled');
        if (filter.status) {
            const ids = [...this.live.entries()]
                .filter(([, v]) => Date.now() - v.seen < 90000)
                .map(([id]) => id);
            if (filter.status === 'online')
                base.whereIn('public_id', ids).where('is_blacklisted', false);
            else base.where((q) => q.whereNotIn('public_id', ids).orWhere('is_blacklisted', true));
        }
        const query = this.db.from(base.as('filtered'));
        const { count } = await query.clone().count('* as count').first();
        const column = SORT_COLUMNS[filter.sort];
        query.orderByRaw('?? IS NULL ASC', [column]);
        if (filter.sort === 'android') {
            query.orderByRaw(
                "CASE WHEN android_version IN ('', '待记录', '—') THEN 1 ELSE 0 END ASC",
            );
            query.orderBy(this.db.raw('CAST(?? AS REAL)', [column]), filter.direction);
        } else query.orderBy(column, filter.direction);
        query.orderBy('id', 'asc');
        return {
            data: (
                await query.offset((filter.page - 1) * filter.perPage).limit(filter.perPage)
            ).map((row) => this.dto(row)),
            total: Number(count),
            page: filter.page,
            perPage: filter.perPage,
            filters: filter,
            stats: await this.stats(),
        };
    }
    async stats() {
        const [{ count }] = await this.devices().count('* as count');
        const apiDevices = await this.devices()
            .where('source', 'api')
            .select('public_id', 'is_blacklisted', 'accessibility_enabled', {
                installed_at: this.installedAtExpression(),
            });
        const isOnline = (device) => {
            const live = this.live.get(device.public_id);
            return !device.is_blacklisted && live && Date.now() - live.seen < 90000;
        };
        const onlineCount = apiDevices.filter((d) => {
            return isOnline(d);
        }).length;
        const day = 86400000;
        const beijingOffset = 8 * 3600000;
        const today = Math.floor((Date.now() + beijingOffset) / day) * day - beijingOffset;
        const hasInstallRecords = apiDevices.some((device) => Number(device.installed_at) > 0);
        const period = (label, start, end) => {
            if (!hasInstallRecords)
                return { label, installed: null, offline: null, accessibility: null };
            const cohort = apiDevices.filter((device) => {
                const installedAt = Number(device.installed_at);
                return installedAt >= start && installedAt < end;
            });
            return {
                label,
                installed: cohort.length,
                offline: cohort.filter((device) => !isOnline(device)).length,
                accessibility: cohort.filter((device) => Boolean(device.accessibility_enabled))
                    .length,
            };
        };
        return {
            devices: Number(count),
            online: apiDevices.length ? onlineCount : null,
            periods: [period('今日', today, today + day), period('昨日', today - day, today)],
        };
    }
    snapshotQuery() {
        const query = this.db('snapshots').whereExists(
            this.devices()
                .select(this.db.raw('1'))
                .whereColumn('devices.id', 'snapshots.device_id')
                .whereColumn('devices.project_id', 'snapshots.project_id'),
        );
        return this.projectId === null
            ? query
            : query.where('snapshots.project_id', this.projectId);
    }
    async snapshot(id) {
        const row = await this.snapshotQuery().where('id', id).first();
        if (!row) throw fail(404, '快照不存在');
        return { ...row, payload: normalizeSnapshot(JSON.parse(row.payload)) };
    }
    async detail(id, snapshotId) {
        const device = await this.device(id);
        const snapshots = await this.snapshotQuery()
            .where('device_id', id)
            .select('id', 'captured_at', 'node_count', 'window_count', 'source')
            .orderBy('id', 'desc')
            .limit(50);
        const selected = snapshotId ?? snapshots[0]?.id;
        const snapshot = selected ? await this.snapshot(selected) : null;
        if (snapshot && snapshot.device_id !== id) throw fail(404, '快照不存在');
        const events = await this.db('lab_events')
            .where({ project_id: device.project_id, device_id: id })
            .orderBy('occurred_at', 'desc')
            .limit(50);
        return {
            device,
            owner: device.owner_account_id
                ? await this.db('accounts')
                      .where('id', device.owner_account_id)
                      .first('id', 'username')
                : null,
            snapshots,
            snapshot: snapshot
                ? {
                      ...snapshot,
                      screenshot_path: undefined,
                      imageUrl: snapshot.screenshot_path
                          ? `/api/snapshots/${snapshot.id}/image`
                          : null,
                      labels: labelsFor(snapshot),
                  }
                : null,
            events,
        };
    }
    async note(id, note) {
        await this.device(id);
        await this.devices().where('id', id).update({ note });
        return this.device(id);
    }
    async audit(type, channel, deviceId = null, size = 0, dir = 'up', request = {}) {
        const device = deviceId
            ? await this.devices().where('public_id', deviceId).first('project_id')
            : null;
        await this.db('protocol_logs').insert({
            project_id: device?.project_id ?? this.projectId ?? 1,
            ts: Date.now(),
            device_id: deviceId,
            type,
            channel,
            size,
            dir,
            request_method: request.method || null,
            request_path: request.path || null,
            response_status: request.status || null,
            duration_ms: request.durationMs ?? null,
        });
    }
}
