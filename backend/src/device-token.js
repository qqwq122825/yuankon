import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { config, loadKey } from './config.js';
import { openDatabase } from './database.js';
import { tokens } from './security.js';
import { deviceIdSchema } from './protocol.js';
const settings = config(),
    id = deviceIdSchema.parse(process.argv[2]),
    db = await openDatabase(settings.database);
try {
    const existing = await db('devices').where('public_id', id).first();
    if (existing && (existing.project_id !== settings.projectId || existing.source !== 'api'))
        throw new Error('设备标识已用于其他记录');
    if (!existing)
        await db('devices').insert({
            project_id: settings.projectId,
            public_id: id,
            name: id,
            brand: '待记录',
            android_version: '待记录',
            source: 'api',
            note: '',
        });
    const token = await tokens(loadKey(settings.privateDir), settings.projectId).issue(
        'device',
        id,
        '7d',
    );
    const folder = path.join(settings.privateDir, 'device-credentials');
    await mkdir(folder, { recursive: true, mode: 0o700 });
    const filename = path.join(folder, `${id}.json`);
    await writeFile(
        filename,
        JSON.stringify(
            { deviceId: id, token, expiresAt: new Date(Date.now() + 7 * 86400000).toISOString() },
            null,
            2,
        ),
        { mode: 0o600 },
    );
    console.log(`设备凭证已保存：${filename}`);
} finally {
    await db.destroy();
}
