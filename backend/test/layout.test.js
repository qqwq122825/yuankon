import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { readFile, readdir, access, mkdtemp, mkdir, symlink, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { ROOT, config } from '../src/config.js';
import { loadTemplates, templateSchema, templateSource } from '../src/build-templates.js';

test('repository has three source folders, nested dependencies and correctly located runtime assets', async () => {
    const folders = (await readdir(ROOT, { withFileTypes: true }))
        .filter((d) => d.isDirectory() && !d.name.startsWith('.'))
        .map((d) => d.name)
        .sort();
    assert.deepEqual(folders, ['android', 'backend', 'frontend']);
    assert.equal(config().privateDir, path.join(ROOT, 'backend/.node-private'));
    for (const file of [
        'frontend/package-lock.json',
        'backend/package-lock.json',
        'frontend/public/vendor/tabler/tabler.min.css',
        'android/scripts/build-screenagent.sh',
    ])
        await access(path.join(ROOT, file));
    for (const folder of ['backend', 'frontend']) {
        const pkg = JSON.parse(await readFile(path.join(ROOT, folder, 'package.json'), 'utf8'));
        const lock = JSON.parse(
            await readFile(path.join(ROOT, folder, 'package-lock.json'), 'utf8'),
        );
        assert.deepEqual(lock.packages[''].dependencies, pkg.dependencies);
        assert.deepEqual(lock.packages[''].devDependencies, pkg.devDependencies);
    }
    for (const t of await loadTemplates(ROOT)) {
        const source = await templateSource(ROOT, t);
        assert.ok(source.startsWith(path.join(ROOT, 'android/apk-templates') + path.sep));
        await access(path.join(source, 'app/src/main/AndroidManifest.xml'));
    }
});
test('template sourceDir accepts version folders but stays inside the unified template root', async () => {
    const base = (await loadTemplates(ROOT))[0];
    assert.equal(
        templateSchema.parse({ ...base, sourceDir: 'screenagent-1.1' }).sourceDir,
        'screenagent-1.1',
    );
    for (const sourceDir of ['../backend', '/tmp/code', 'safe/../../other', 'safe/../code'])
        assert.equal(templateSchema.safeParse({ ...base, sourceDir }).success, false);
    const temp = await mkdtemp(path.join(tmpdir(), 'boundary-layout-'));
    try {
        await mkdir(path.join(temp, 'android/apk-templates'), { recursive: true });
        await mkdir(path.join(temp, 'outside'));
        await symlink(
            path.join(temp, 'outside'),
            path.join(temp, 'android/apk-templates/outside-link'),
        );
        await assert.rejects(
            () => templateSource(temp, { ...base, sourceDir: 'outside-link' }),
            (e) => e.status === 422,
        );
    } finally {
        await rm(temp, { recursive: true, force: true });
    }
});
