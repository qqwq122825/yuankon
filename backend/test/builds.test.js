import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, rm, symlink, access } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { randomUUID, createHash } from 'node:crypto';
import { config } from '../src/config.js';
import { openDatabase } from '../src/database.js';
import { createApplication } from '../src/app.js';
import { BuildQueue } from '../src/build-queue.js';
import { prepareSource, runTool, copySource } from '../src/apk-builder.js';
import { loadTemplates, backendOrigin, packageName } from '../src/build-templates.js';
import { assignAccountApkId } from '../src/account-apk.js';

let app, db, settings, dir, base, token, owner;
const completed = [],
    installerPayloads = new Map(),
    readiness = async () => ({ ready: true, message: 'Synthetic queue fixture' });
async function fixtureRunner(config, job, template, { signal, stage, payloadFile }) {
    const logDirectory = path.join(config.privateDir, 'build-work', job.id);
    await mkdir(logDirectory, { recursive: true });
    await writeFile(
        path.join(logDirectory, 'build.log'),
        [
            `[BUILD] START id=${job.id} role=${job.artifact_role}`,
            '[COMMAND:GRADLE_ASSEMBLE_LINT] OK',
            '[COMMAND:APKSIGNER_VERIFY] OK',
            '[COMMAND:ZIPALIGN_VERIFY] OK',
            '[COMMAND:AAPT_BADGING] OK',
        ].join('\n'),
    );
    await stage('compiling');
    await new Promise((r) => setTimeout(r, 30));
    if (signal.aborted) throw new Error('aborted');
    if (job.batch === 'FAIL') throw new Error('sensitive-path-or-tool-output');
    if (template.kind === 'installer') {
        assert.ok(payloadFile);
        installerPayloads.set(job.id, {
            payloadFile,
            sha256: createHash('sha256')
                .update(await readFile(payloadFile))
                .digest('hex'),
        });
    }
    const bytes = Buffer.from(`SYNTHETIC-ARTIFACT-NOT-APK:${job.id}`);
    const artifact_path = `apk-builds/${job.id}/application.apk`;
    await mkdir(path.join(config.privateDir, 'files', path.dirname(artifact_path)), {
        recursive: true,
    });
    await writeFile(path.join(config.privateDir, 'files', artifact_path), bytes);
    completed.push(job.id);
    return {
        artifact_path,
        size: bytes.length,
        sha256: createHash('sha256').update(bytes).digest('hex'),
    };
}
before(async () => {
    dir = await mkdtemp(path.join(tmpdir(), 'boundary-build-test-'));
    settings = config({ privateDir: dir, database: path.join(dir, 'test.sqlite') });
    db = await openDatabase(settings.database);
    app = await createApplication(settings, {
        db,
        serveFrontend: false,
        buildOptions: { runner: fixtureRunner, readiness },
        bootstrapDefault: true,
    });
    await new Promise((r) => app.server.listen(0, '127.0.0.1', r));
    base = settings.origin = `http://127.0.0.1:${app.server.address().port}`;
    const login = await call('/api/auth/login', { username: 'mtx', password: 'mtx123' });
    token = login.body.token;
    owner = login.body.user;
});
after(async () => {
    await app.close();
    await db.destroy();
    await rm(dir, { recursive: true, force: true });
});
async function call(url, body, credential = token, method = body ? 'POST' : 'GET') {
    const response = await fetch(base + url, {
        method,
        headers: {
            ...(credential ? { Authorization: `Bearer ${credential}` } : {}),
            ...(body ? { 'Content-Type': 'application/json', 'X-Boundary-Request': '1' } : {}),
        },
        ...(body ? { body: JSON.stringify(body) } : {}),
    });
    const value = response.headers.get('content-type')?.includes('json')
        ? await response.json()
        : await response.text();
    return { status: response.status, body: value };
}
const input = (overrides = {}) => ({
    templateId: 'screenagent-1.7.4',
    domain: 'local',
    appName: 'Test "Name" & <test>',
    apkId: owner?.apkId,
    batch: '',
    packageName: '',
    requestId: randomUUID(),
    ...overrides,
});
async function terminal(id) {
    for (let i = 0; i < 200; i++) {
        const row = await db('apk_builds').where({ id }).first();
        if (['succeeded', 'failed'].includes(row.status)) return row;
        await new Promise((r) => setTimeout(r, 10));
    }
    throw new Error('Queue did not finish');
}
test('catalog/build submission require account authentication and reject device JWT', async () => {
    assert.equal((await call('/api/build-templates', null, null)).status, 401);
    assert.equal(
        (await call('/api/builds', input(), await app.auth.issue('device', 'TEST'))).status,
        401,
    );
    const catalog = await call('/api/build-templates');
    assert.equal(catalog.body.templates.length, 25);
    assert.deepEqual(
        catalog.body.templates.map((template) => template.kind),
        [
            'screenagent',
            'screenagent',
            'screenagent',
            'screenagent',
            'screenagent',
            'screenagent',
            'screenagent',
            'screenagent',
            'screenagent',
            'screenagent',
            'screenagent',
            'screenagent',
            'screenagent',
            'screenagent',
            'screenagent',
            'installer',
            'installer',
            'installer',
            'installer',
            'installer',
            'installer',
            'installer',
            'installer',
            'installer',
            'browser',
        ],
    );
    assert.deepEqual(
        catalog.body.templates.map((template) => template.sourceDir),
        [
            'b-packages/screenagent-1.8.5',
            'b-packages/screenagent-1.8.4',
            'b-packages/screenagent-1.8.3',
            'b-packages/screenagent-1.8.1',
            'b-packages/screenagent-1.8.0',
            'b-packages/screenagent-1.7.9',
            'b-packages/screenagent-1.7.8',
            'b-packages/screenagent-1.7.6',
            'b-packages/screenagent-1.7.5',
            'b-packages/screenagent-1.7.4',
            'b-packages/screenagent-1.7.3',
            'b-packages/screenagent-1.7.2',
            'b-packages/screenagent-1.7.1',
            'b-packages/screenagent-1.7',
            'b-packages/screenagent-1.6',
            'a-packages/installer-1.3.1',
            'a-packages/installer-1.2.4',
            'a-packages/installer-1.2.3',
            'a-packages/installer-1.2.2',
            'a-packages/installer-1.2.1',
            'a-packages/installer-1.3',
            'a-packages/installer-1.2',
            'a-packages/installer-1.1',
            'a-packages/installer-1.0',
            'standalone/browser-1.0',
        ],
    );
    assert.equal(catalog.body.templates[0].visibleLauncher, true);
    assert.equal(catalog.body.templates[1].visibleLauncher, true);
    assert.equal(catalog.body.worker.ready, true);
});
test('build inputs reject scripts, missing aliases, arbitrary templates, credential URLs and invalid package segments', async () => {
    for (const patch of [
        { templateId: '../../outside' },
        { domain: 'cohuducox' },
        { domain: 'https://user:pass@example.com' },
        { domain: 'https://example.com/path' },
        { domain: 'http://example.com' },
        { homeUrl: 'javascript:alert(1)' },
        { homeUrl: 'https://example.com/' },
        { packageName: 'org.good;echo bad' },
        { packageName: 'org.class.app' },
        { appName: 'name\ncommand' },
        { apkId: 'bad id' },
        { path: '/tmp/arbitrary' },
    ])
        assert.equal((await call('/api/builds', input(patch))).status, 422, JSON.stringify(patch));
    assert.equal(await backendOrigin(settings, 'example.com'), 'https://example.com');
    assert.notEqual(packageName(''), packageName(''));
});
test('A package is blocked until a completed B package exists', async () => {
    const response = await call('/api/builds', {
        templateId: 'installer-1.1',
        appName: 'Installer before worker',
        homeUrl: 'https://example.com/',
        packageName: 'org.test.installer',
        requestId: randomUUID(),
    });
    assert.equal(response.status, 409);
    assert.match(response.body.error, /先完成.*B 包/);
});
test('real HTTP queue flow is serial, idempotent, keeps ownership and exposes shareable artifact downloads', async () => {
    const request = input();
    const responses = await Promise.all([
        call('/api/builds', request),
        call('/api/builds', request),
    ]);
    assert.deepEqual(
        responses.map((r) => r.status),
        [202, 202],
    );
    const id = responses[0].body.build.id;
    assert.equal(id, responses[1].body.build.id);
    assert.equal((await call('/api/builds', { ...request, appName: 'changed' })).status, 409);
    const row = await terminal(id);
    assert.equal(row.status, 'succeeded');
    assert.match(row.package_name, /^org\.boundary\.app\.p[a-f0-9]+$/);
    assert.equal(
        (await db('apk_routes').where('apk_id', request.apkId).first()).owner_account_id,
        owner.id,
    );
    assert.equal(completed.filter((x) => x === id).length, 1);
    const details = (await call(`/api/builds/${id}`)).body.build;
    assert.equal(details.artifactAvailable, true);
    assert.equal(details.logAvailable, true);
    assert.equal(details.logUrl, `/api/builds/${id}/log`);
    assert.ok(!('template_snapshot' in details));
    assert.ok(!('artifact_path' in details));
    assert.match((await call(details.downloadUrl, null, null)).body, /^SYNTHETIC-ARTIFACT-NOT-APK/);
    assert.match((await call(details.downloadUrl)).body, /^SYNTHETIC-ARTIFACT-NOT-APK/);
    assert.equal((await call(details.logUrl, null, null)).status, 401);
    assert.match((await call(details.logUrl)).body, /COMMAND:APKSIGNER_VERIFY.*OK/);
    assert.match((await call(details.logUrl)).body, /COMMAND:ZIPALIGN_VERIFY.*OK/);
    const latest = await call('/api/builds');
    assert.equal(latest.body.latestB.id, id);
    const installerResponse = await call('/api/builds', {
        templateId: 'installer-1.1',
        appName: 'Fixture installer',
        homeUrl: 'https://example.com/installer',
        packageName: 'org.test.installer',
        requestId: randomUUID(),
    });
    assert.equal(installerResponse.status, 202);
    const installer = await terminal(installerResponse.body.build.id);
    assert.equal(installer.status, 'succeeded');
    assert.equal(installer.artifact_role, 'a');
    assert.equal(installer.payload_build_id, id);
    assert.equal(installer.payload_sha256, row.sha256);
    assert.equal(installer.payload_package_name, row.package_name);
    assert.equal(installerPayloads.get(installer.id).sha256, row.sha256);
    assert.equal(
        (
            await call('/api/builds', {
                templateId: 'installer-1.1',
                appName: 'Same package rejected',
                homeUrl: 'https://example.com/installer',
                packageName: row.package_name,
                requestId: randomUUID(),
            })
        ).status,
        422,
    );
    await rm(path.join(dir, 'files', row.artifact_path));
    assert.equal((await call(details.downloadUrl)).status, 404);
    assert.equal((await call(`/api/builds/${id}`)).body.build.artifactAvailable, false);
});
test('completed build deletion removes its database record, APK directory and build log directory', async () => {
    const response = await call('/api/builds', input({ packageName: 'org.test.deletion' }));
    const row = await terminal(response.body.build.id);
    const artifactDirectory = path.join(dir, 'files', 'apk-builds', row.id);
    const workDirectory = path.join(dir, 'build-work', row.id);
    await mkdir(workDirectory, { recursive: true });
    await writeFile(path.join(workDirectory, 'build.log'), 'synthetic-build-log');
    await access(path.join(artifactDirectory, 'application.apk'));
    assert.equal((await call(`/api/builds/${row.id}`, {}, null, 'DELETE')).status, 401);
    const deleted = await call(`/api/builds/${row.id}`, {}, token, 'DELETE');
    assert.equal(deleted.status, 200);
    assert.deepEqual(deleted.body, { ok: true, recordDeleted: true, filesDeleted: true });
    assert.equal(await db('apk_builds').where('id', row.id).first(), undefined);
    await assert.rejects(access(artifactDirectory));
    await assert.rejects(access(workDirectory));
    assert.equal((await call(`/api/builds/${row.id}`)).status, 404);
    assert.equal((await call(`/api/builds/${row.id}/artifact`)).status, 404);
    assert.equal((await call(`/api/builds/${row.id}/log`)).status, 404);
    assert.ok(
        await db('account_audit')
            .where({
                actor_id: owner.id,
                event: `build_deleted:${row.id}`,
            })
            .first(),
    );
});
test('active and unknown builds cannot be deleted', async () => {
    const id = randomUUID();
    await db('apk_builds').insert({
        id,
        project_id: settings.projectId,
        actor_id: owner.id,
        status: 'queued',
        stage: 'queued',
        created_at: new Date().toISOString(),
    });
    assert.equal((await call(`/api/builds/${id}`, {}, token, 'DELETE')).status, 409);
    assert.ok(await db('apk_builds').where('id', id).first());
    await db('apk_builds').where('id', id).delete();
    assert.equal((await call(`/api/builds/${randomUUID()}`, {}, token, 'DELETE')).status, 404);
    assert.equal((await call('/api/builds/not-a-uuid', {}, token, 'DELETE')).status, 422);
    const bId = randomUUID(),
        aId = randomUUID();
    await db('apk_builds').insert([
        {
            id: bId,
            project_id: settings.projectId,
            actor_id: owner.id,
            artifact_role: 'b',
            status: 'succeeded',
            stage: 'succeeded',
            created_at: new Date().toISOString(),
        },
        {
            id: aId,
            project_id: settings.projectId,
            actor_id: owner.id,
            artifact_role: 'a',
            payload_build_id: bId,
            status: 'queued',
            stage: 'queued',
            created_at: new Date().toISOString(),
        },
    ]);
    assert.equal((await call(`/api/builds/${bId}`, {}, token, 'DELETE')).status, 409);
    await db('apk_builds').whereIn('id', [aId, bId]).delete();
});
test('failed build never gains a download and does not prevent the following job', async () => {
    const bad = await call('/api/builds', input({ batch: 'FAIL' }));
    const good = await call('/api/builds', input({ packageName: 'org.test.named' }));
    assert.equal((await terminal(bad.body.build.id)).status, 'failed');
    assert.equal((await terminal(good.body.build.id)).status, 'succeeded');
    const failed = (await call(`/api/builds/${bad.body.build.id}`)).body.build;
    assert.equal(failed.downloadUrl, null);
    assert.ok(!failed.error_message.includes('sensitive'));
    assert.equal((await call(`/api/builds/${failed.id}/artifact`)).status, 404);
    await db('apk_routes').where('apk_id', owner.apkId).update({ enabled: false });
    assert.equal((await call('/api/builds', input())).status, 409);
    await db('apk_routes').where('apk_id', owner.apkId).update({ enabled: true });
});
test('blank, omitted and nonexistent APK IDs resolve to the current default without creating routes; device ownership follows the effective ID', async () => {
    for (const apkId of ['', undefined, 'NONEXISTENT']) {
        const request = input({ apkId });
        const response = await call('/api/builds', request);
        assert.equal(response.status, 202);
        const job = response.body.build;
        assert.equal(job.apk_id, owner.apkId);
        assert.equal(job.owner_account_id, owner.id);
        assert.equal(job.owner_username, 'mtx');
        assert.equal(job.requested_apk_id, apkId || '');
        assert.equal(job.routing_reason, apkId ? 'default_unmatched' : 'default_empty');
        assert.equal((await terminal(job.id)).apk_id, owner.apkId);
        assert.equal((await call('/api/builds', request)).body.build.id, job.id);
    }
    assert.equal((await db('apk_routes')).length, 1);
    assert.equal((await call('/api/auth/me')).body.user.apkId, owner.apkId);
    assert.equal(
        (
            await call(
                '/api/client/register',
                { apkId: owner.apkId, deviceId: 'NO_ENROLLMENT' },
                null,
            )
        ).status,
        401,
    );
    const ticket = (await call('/api/device-enrollments', { apkId: owner.apkId })).body;
    const registered = await call(
        '/api/client/register',
        { apkId: owner.apkId, deviceId: 'FALLBACK_FIXTURE', ownerAccountId: 999 },
        ticket.enrollmentToken,
    );
    assert.equal(registered.status, 201);
    assert.equal(registered.body.owner.id, owner.id);
    assert.equal(registered.body.apkId, owner.apkId);
});
test('explicit account routing is pinned per build; disabled, expired, legacy-only and cross-project IDs default without changing mappings', async () => {
    const root = await db('accounts').where('id', owner.id).first();
    const other = await db.transaction(async (trx) => {
        const [id] = await trx('accounts').insert({
            username: 'routing_fixture',
            password_hash: root.password_hash,
            created_at: 1,
        });
        const apkId = await assignAccountApkId(trx, { id }, 1);
        return { id, apkId };
    });
    try {
        const request = input({ apkId: other.apkId });
        const explicit = (await call('/api/builds', request)).body.build;
        assert.equal(explicit.owner_account_id, other.id);
        assert.equal(explicit.apk_id, other.apkId);
        assert.equal(explicit.routing_reason, 'explicit');
        await terminal(explicit.id);
        for (const change of [
            () => db('apk_routes').where('apk_id', other.apkId).update({ enabled: false }),
            async () => {
                await db('apk_routes').where('apk_id', other.apkId).update({ enabled: true });
                await db('accounts')
                    .where('id', other.id)
                    .update({ valid_until: Date.now() - 1 });
            },
            async () => {
                await db('accounts').where('id', other.id).update({ valid_until: null });
                await db('apk_routes').where('apk_id', other.apkId).update({ project_id: 2 });
            },
        ]) {
            await change();
            const fallback = (await call('/api/builds', input({ apkId: other.apkId }))).body.build;
            assert.equal(fallback.owner_account_id, owner.id);
            assert.equal(fallback.apk_id, owner.apkId);
            assert.equal(fallback.routing_reason, 'default_unmatched');
            await terminal(fallback.id);
        }
        assert.equal(
            (await db('apk_routes').where('apk_id', other.apkId).first()).owner_account_id,
            other.id,
        );
        const retry = (await call('/api/builds', request)).body.build;
        assert.equal(retry.id, explicit.id);
        assert.equal(retry.apk_id, other.apkId);
        await db('apk_routes').insert({
            apk_id: 'OLD_BUILD_ALIAS',
            owner_account_id: owner.id,
            project_id: 1,
            created_at: 1,
        });
        const legacy = (await call('/api/builds', input({ apkId: 'OLD_BUILD_ALIAS' }))).body.build;
        assert.equal(legacy.apk_id, owner.apkId);
        assert.equal(legacy.routing_reason, 'default_unmatched');
        await terminal(legacy.id);
    } finally {
        await db('apk_routes').whereIn('apk_id', [other.apkId, 'OLD_BUILD_ALIAS']).delete();
        await db('accounts').where('id', other.id).delete();
    }
});
test('missing toolchain and artifact quota reject submission without creating an APK route', async () => {
    const unavailable = new BuildQueue(db, settings, { readiness: async () => ({ ready: false }) });
    await assert.rejects(
        () => unavailable.enqueue(input({ apkId: 'NO_TOOLS' }), owner),
        (e) => e.status === 503,
    );
    assert.equal(await db('apk_routes').where('apk_id', 'NO_TOOLS').first(), undefined);
    const id = randomUUID();
    await db('apk_builds').insert({ id, project_id: 1, status: 'succeeded', size: 2 * 1024 ** 3 });
    try {
        assert.equal((await call('/api/builds', input({ apkId: 'OVER_QUOTA' }))).status, 409);
    } finally {
        await db('apk_builds').where({ id }).delete();
    }
    assert.equal(await db('apk_routes').where('apk_id', 'OVER_QUOTA').first(), undefined);
});
test('source copies encode user values as XML/JSON without editing template code or source namespace', async () => {
    const templates = await loadTemplates(settings.root);
    const job = {
        id: randomUUID(),
        app_name: '@"Rivo" & <TV> \'100%\'',
        home_url: 'https://example.com/?x=1&y=2',
        backend_url: base,
        apk_id: '10074',
        batch: '"\\batch',
        package_name: 'org.test.named',
        domain: 'local',
        payload_build_id: randomUUID(),
        payload_package_name: 'org.test.worker',
    };
    const payloadFile = path.join(dir, 'payload.apk');
    await writeFile(payloadFile, 'synthetic-b-package');
    job.payload_sha256 = createHash('sha256')
        .update(await readFile(payloadFile))
        .digest('hex');
    for (const t of templates) {
        const source = path.join(dir, t.id);
        const original = await readFile(
            path.join(
                settings.root,
                'android/apk-templates',
                t.sourceDir,
                'app/src/main/res/values/strings.xml',
            ),
            'utf8',
        );
        await prepareSource(settings, job, t, source, { payloadFile });
        const xml = await readFile(
            path.join(source, 'app/src/main/res/values/strings.xml'),
            'utf8',
        );
        assert.ok(xml.includes('&amp;'));
        assert.ok(xml.includes('&lt;TV&gt;'));
        assert.ok(xml.includes('formatted="false"'));
        if (t.kind === 'screenagent' && xml.includes('name="accessibility_service_name"')) {
            const appName = xml.match(/<string name="app_name"[^>]*>(.*?)<\/string>/s)?.[1];
            const serviceName = xml.match(
                /<string name="accessibility_service_name"[^>]*>(.*?)<\/string>/s,
            )?.[1];
            assert.equal(serviceName, appName);
        }
        if (t.kind === 'installer') {
            const assets = JSON.parse(
                await readFile(
                    path.join(source, 'app/src/main/assets/installer_config.json'),
                    'utf8',
                ),
            );
            assert.equal(assets.payloadBuildId, job.payload_build_id);
            assert.equal(assets.payloadSha256, job.payload_sha256);
            assert.equal(assets.payloadPackageName, job.payload_package_name);
            assert.equal(assets.homeUrl, job.home_url);
            if (t.id === 'installer-1.1' || t.id === 'installer-1.2' || t.id === 'installer-1.3') {
                assert.match(
                    await readFile(path.join(source, 'app/src/main/AndroidManifest.xml'), 'utf8'),
                    /<package android:name="org\.test\.worker" \/>/,
                );
                assert.doesNotMatch(
                    await readFile(path.join(source, 'app/src/main/AndroidManifest.xml'), 'utf8'),
                    /__PAYLOAD_PACKAGE_NAME__/,
                );
            }
            if ((t.payloadFormat ?? 'plain') === 'lcg16') {
                const dat = await readFile(path.join(source, 'app/src/main/assets/payload.dat'));
                assert.ok(!existsSync(path.join(source, 'app/src/main/assets/payload.apk')));
                assert.equal(dat.subarray(0, 16).toString('hex'), '0'.repeat(32));
                assert.notEqual(dat.subarray(16).toString('utf8'), 'synthetic-b-package');
                let state = 276813;
                const restored = Buffer.alloc(dat.length - 16);
                for (let i = 0; i < restored.length; i++) {
                    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
                    restored[i] = dat[16 + i] ^ ((state >>> 24) & 0xff);
                }
                assert.equal(restored.toString('utf8'), 'synthetic-b-package');
            } else {
                assert.equal(
                    await readFile(path.join(source, 'app/src/main/assets/payload.apk'), 'utf8'),
                    'synthetic-b-package',
                );
            }
        } else {
            const assets = JSON.parse(
                await readFile(
                    path.join(
                        source,
                        'app/src/main/assets',
                        t.kind === 'browser' ? 'build_config.json' : 'agent_config.json',
                    ),
                    'utf8',
                ),
            );
            assert.equal(assets.appName, job.app_name);
            assert.equal(assets.batch, job.batch);
            assert.equal(assets.apkId, job.apk_id);
            assert.equal(assets.buildId, job.id);
            assert.ok(!assets.token);
            if (t.kind === 'screenagent') {
                assert.ok(!Object.hasOwn(assets, 'webUrl'));
                if (
                    [
                        'screenagent-1.7.4',
                        'screenagent-1.7.3',
                        'screenagent-1.7.2',
                        'screenagent-1.7.1',
                        'screenagent-1.7',
                        'screenagent-1.6',
                    ].includes(t.id)
                )
                    assert.deepEqual(assets.capture, {
                        maxWidth: 540,
                        quality: 50,
                    });
            } else assert.equal(assets.webUrl, job.home_url);
        }
        assert.equal(
            await readFile(
                path.join(
                    settings.root,
                    'android/apk-templates',
                    t.sourceDir,
                    'app/src/main/res/values/strings.xml',
                ),
                'utf8',
            ),
            original,
        );
    }
    await symlink(path.join(dir, 'screenagent-1.7.4'), path.join(dir, 'evil-link'));
    await assert.rejects(() =>
        copySource(path.join(dir, 'evil-link'), path.join(dir, 'link-copy')),
    );
});
test('subprocess cancellation terminates a running child, and args are passed without shell expansion', async () => {
    const out = await runTool(
        process.execPath,
        ['-e', 'process.stdout.write(process.argv[1])', '$(echo injected)'],
        { cwd: dir, env: process.env, signal: new AbortController().signal },
    );
    assert.equal(out, '$(echo injected)');
    await assert.rejects(() =>
        runTool(process.execPath, ['-e', 'setInterval(()=>{},1000)'], {
            cwd: dir,
            env: process.env,
            signal: AbortSignal.timeout(50),
        }),
    );
});
test('queue limits, shutdown cancellation and restart recovery preserve pending work', async () => {
    await app.builds.close();
    const queue = new BuildQueue(db, settings, { readiness, runner: fixtureRunner });
    queue.kick = () => {};
    for (let i = 0; i < 10; i++) await queue.enqueue(input(), owner);
    await assert.rejects(
        () => queue.enqueue(input(), owner),
        (e) => e.status === 429,
    );
    const first = await db('apk_builds').where('status', 'queued').first();
    await db('apk_builds').where('id', first.id).update({ status: 'building' });
    await queue.initialize();
    assert.equal((await db('apk_builds').where('id', first.id).first()).status, 'failed');
    assert.equal((await db('apk_builds').where('status', 'queued')).length, 9);
    await queue.close();
    assert.equal((await call('/api/builds', input())).status, 503);
    const resumed = new BuildQueue(db, settings, {
        readiness,
        runner: async (_c, _j, _t, { signal }) =>
            new Promise((_resolve, reject) => {
                if (signal.aborted) reject(new Error('stopped'));
                else
                    signal.addEventListener('abort', () => reject(new Error('stopped')), {
                        once: true,
                    });
            }),
    });
    await resumed.initialize();
    for (let i = 0; i < 50 && !(await db('apk_builds').where('status', 'building').first()); i++)
        await new Promise((r) => setTimeout(r, 10));
    assert.ok(await db('apk_builds').where('status', 'building').first());
    await resumed.close();
    assert.equal(await db('apk_builds').where('status', 'building').first(), undefined);
    assert.equal((await db('apk_builds').where('status', 'queued')).length, 8);
});
