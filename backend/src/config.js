import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkdirSync, readFileSync, writeFileSync, chmodSync } from 'node:fs';
import { randomBytes } from 'node:crypto';

export const ROOT = fileURLToPath(new URL('../../', import.meta.url));
export function config(overrides = {}) {
    const port = Number(process.env.NODE_PORT || 8080);
    const privateDir = path.resolve(ROOT, 'backend/.node-private');
    return {
        root: ROOT,
        port,
        projectId: 1,
        privateDir,
        database: path.join(privateDir, 'boundary.sqlite'),
        origin: `http://127.0.0.1:${port}`,
        ...overrides,
    };
}
export function loadKey(dir) {
    mkdirSync(dir, { recursive: true, mode: 0o700 });
    const filename = path.join(dir, 'master.key');
    try {
        writeFileSync(filename, randomBytes(32), { flag: 'wx', mode: 0o600 });
    } catch (e) {
        if (e.code !== 'EEXIST') throw e;
    }
    const key = readFileSync(filename);
    if (key.length !== 32) throw new Error('Invalid local key length');
    chmodSync(filename, 0o600);
    return key;
}
