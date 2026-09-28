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
        assert.equal(
            t.sourceDir.split('/')[0],
            t.kind === 'installer'
                ? 'a-packages'
                : t.kind === 'screenagent'
                  ? 'b-packages'
                  : 'standalone',
        );
    }
    const screenagent = path.join(
        ROOT,
        'android/apk-templates/b-packages/screenagent-1.2/app/src/main',
    );
    const manifest = await readFile(path.join(screenagent, 'AndroidManifest.xml'), 'utf8');
    const screenagentConfig = await readFile(
        path.join(screenagent, 'assets/agent_config.json'),
        'utf8',
    );
    const installer = path.join(
        ROOT,
        'android/apk-templates/a-packages/installer-1.0/app/src/main',
    );
    const installerManifest = await readFile(path.join(installer, 'AndroidManifest.xml'), 'utf8');
    const installerActivity = await readFile(
        path.join(installer, 'java/org/boundarylab/installer/MainActivity.java'),
        'utf8',
    );
    const service = await readFile(
        path.join(
            screenagent,
            'java/com/zaka/screenagent/accessibility/BoundaryAccessibilityService.kt',
        ),
        'utf8',
    );
    const socket = await readFile(
        path.join(screenagent, 'java/com/zaka/screenagent/net/AgentSocket.kt'),
        'utf8',
    );
    const metadata = await readFile(
        path.join(screenagent, 'res/xml/boundary_accessibility_service.xml'),
        'utf8',
    );
    assert.match(manifest, /BIND_ACCESSIBILITY_SERVICE/);
    assert.doesNotMatch(manifest, /android\.intent\.action\.MAIN/);
    assert.doesNotMatch(manifest, /android\.intent\.category\.LAUNCHER/);
    assert.doesNotMatch(screenagentConfig, /webUrl/);
    assert.match(installerManifest, /android\.intent\.action\.MAIN/);
    assert.match(installerManifest, /android\.intent\.category\.LAUNCHER/);
    assert.match(installerActivity, /config\.getString\("homeUrl"\)/);
    assert.match(metadata, /canTakeScreenshot="true"/);
    assert.match(metadata, /canRetrieveWindowContent="false"/);
    assert.match(service, /CMD_VIEWER_LEASE/);
    assert.match(service, /initial_accessibility/);
    assert.match(service, /Build\.VERSION_CODES\.R\) 1001L else 334L/);
    assert.match(service, /scheduleViewerFrame/);
    assert.match(service, /onServiceConnected[\s\S]*connect\(\)/);
    assert.match(service, /accessibilityAlive", true/);
    assert.match(socket, /send\(Protocol\.UP_STATUS/);
    assert.match(socket, /send\(Protocol\.UP_PING/);
    assert.match(socket, /main\.postDelayed\(this, 20_000\)/);
});
test('template sourceDir accepts version folders but stays inside the unified template root', async () => {
    const base = (await loadTemplates(ROOT))[0];
    assert.equal(
        templateSchema.parse({ ...base, sourceDir: 'b-packages/screenagent-1.2' }).sourceDir,
        'b-packages/screenagent-1.2',
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
