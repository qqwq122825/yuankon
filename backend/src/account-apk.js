import { fail } from './protocol.js';

const FIRST_MANAGED_APK_ID = 100;

function numericApkId(value) {
    if (!/^\d+$/.test(String(value))) return null;
    const parsed = Number(value);
    return Number.isSafeInteger(parsed) ? parsed : null;
}

async function advanceSequencePast(trx, apkId) {
    const value = numericApkId(apkId);
    if (value === null || value < FIRST_MANAGED_APK_ID) return;
    const sequence = await trx('account_apk_sequence').where('id', 1).first();
    if (!sequence) throw fail(500, 'APK ID 分配器尚未初始化');
    if (sequence.next_value <= value)
        await trx('account_apk_sequence')
            .where('id', 1)
            .update({ next_value: value + 1, updated_at: Date.now() });
}

async function allocateAccountApkId(trx) {
    const sequence = await trx('account_apk_sequence').where('id', 1).first();
    if (!sequence) throw fail(500, 'APK ID 分配器尚未初始化');
    let candidate = Math.max(FIRST_MANAGED_APK_ID, Number(sequence.next_value));
    if (!Number.isSafeInteger(candidate)) throw fail(500, 'APK ID 分配器状态无效');
    while (
        (await trx('apk_routes').where('apk_id', String(candidate)).first()) ||
        (await trx('accounts').where('apk_id', String(candidate)).first())
    )
        candidate++;
    if (!Number.isSafeInteger(candidate)) throw fail(500, 'APK ID 已超出可分配范围');
    await trx('account_apk_sequence')
        .where('id', 1)
        .update({ next_value: candidate + 1, updated_at: Date.now() });
    return String(candidate);
}

export async function createAccountWithApkId(trx, values, projectId) {
    const [id] = await trx('accounts').insert(values);
    const apkId = await assignAccountApkId(trx, { id }, projectId);
    return await trx('accounts').where({ id, apk_id: apkId }).first();
}

// Call inside the account-creation transaction. APK IDs are public routing IDs, not credentials.
export async function assignAccountApkId(trx, account, projectId) {
    const current = await trx('accounts').where('id', account.id).first();
    if (!current) throw fail(404, '账号不存在');
    if (current.apk_id) return current.apk_id;
    const legacy = await trx('apk_routes')
        .where({ owner_account_id: account.id, project_id: projectId })
        // If every old route was disabled, preserve that state instead of creating an active one.
        .orderBy('enabled', 'desc')
        .orderBy('created_at')
        .orderBy('apk_id')
        .first();
    let apkId = legacy?.apk_id;
    if (!apkId) {
        const root =
            current.role === 'superadmin'
                ? await trx('accounts').where('role', 'superadmin').orderBy('id').first()
                : null;
        const reservedRoot =
            root?.id === current.id &&
            !(await trx('accounts').where('apk_id', '1').whereNot('id', current.id).first()) &&
            !(await trx('apk_routes').where('apk_id', '1').first());
        apkId = reservedRoot ? '1' : await allocateAccountApkId(trx);
        await trx('apk_routes').insert({
            apk_id: apkId,
            owner_account_id: account.id,
            project_id: projectId,
            enabled: true,
            created_at: Date.now(),
        });
    } else await advanceSequencePast(trx, apkId);
    await trx('accounts').where('id', account.id).update({ apk_id: apkId });
    return apkId;
}

export async function resolveBuildRecipient(trx, requestedId, actor, projectId) {
    // Only superadmin accounts are active in this release. Future studio/member support
    // must supply a tenant-scoped default and lookup, not reuse this global root scope.
    const available = () =>
        trx('accounts as a')
            .join('apk_routes as r', function () {
                this.on('r.apk_id', '=', 'a.apk_id').andOn('r.owner_account_id', '=', 'a.id');
            })
            .where({
                'a.enabled': true,
                'a.role': 'superadmin',
                'r.enabled': true,
                'r.project_id': projectId,
            })
            .where(function () {
                this.whereNull('a.valid_until').orWhere('a.valid_until', '>', Date.now());
            })
            .select('a.id', 'a.username', 'a.apk_id');
    const explicit = requestedId ? await available().where('a.apk_id', requestedId).first() : null;
    const recipient = explicit || (await available().where('a.id', actor.id).first());
    if (!recipient) throw fail(409, '默认接收账号或 APK ID 已停用，请先检查账号配置');
    return {
        apk_id: recipient.apk_id,
        requested_apk_id: requestedId,
        owner_account_id: recipient.id,
        owner_username: recipient.username,
        routing_reason: explicit ? 'explicit' : requestedId ? 'default_unmatched' : 'default_empty',
    };
}
