import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { config, ROOT } from '../src/config.js';
import { openDatabase } from '../src/database.js';
import { createApplication } from '../src/app.js';
import { buildFixture } from './build-fixture.js';
const dir = await mkdtemp(path.join(tmpdir(), 'boundary-browser-'));
const settings = config({
    port: 8081,
    origin: 'http://127.0.0.1:8081',
    apiLimit: 10000,
    privateDir: dir,
    database: path.join(dir, 'browser.sqlite'),
});
const db = await openDatabase(settings.database);
for (let id = 1; id <= 12; id++)
    await db('devices').insert({
        id,
        project_id: 1,
        public_id: `DEMO-${String(id).padStart(3, '0')}`,
        name: `测试设备 ${id}`,
        brand: 'Fixture',
        android_version: '15',
        source: 'sample',
        battery: 70,
        accessibility_enabled: 1,
        note: '合成示例',
    });
const payload = await readFile(path.join(ROOT, 'backend/fixtures/example-snapshot.json'), 'utf8');
await db('snapshots').insert({
    id: 1,
    project_id: 1,
    device_id: 1,
    source: 'sample',
    captured_at: new Date().toISOString(),
    payload,
    node_count: 19,
    window_count: 2,
    screenshot_path: 'demo:settings',
});
const app = await createApplication(settings, {
    db,
    buildOptions: buildFixture,
    bootstrapDefault: true,
});
const upgraded = new Set();
app.server.on('upgrade', (_req, socket) => {
    upgraded.add(socket);
    socket.on('close', () => upgraded.delete(socket));
});
app.server.prependListener('request', (_req, res) =>
    res.setHeader('X-Test-Server-Pid', String(process.pid)),
);
process.on('SIGUSR2', () => {
    for (const socket of upgraded) socket.destroy();
});
app.server.listen(settings.port, '127.0.0.1');
async function close() {
    await app.close();
    await db.destroy();
    await rm(dir, { recursive: true, force: true });
    process.exit(0);
}
process.on('SIGTERM', close);
process.on('SIGINT', close);
