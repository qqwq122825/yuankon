import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { randomUUID, createHash } from 'node:crypto';
import { config } from '../src/config.js';
import { openDatabase } from '../src/database.js';
import { createApplication } from '../src/app.js';
import { BuildQueue } from '../src/build-queue.js';
import { prepareSource, runTool, copySource } from '../src/apk-builder.js';
import { loadTemplates, backendOrigin, packageName } from '../src/build-templates.js';

let app, db, settings, dir, base, token, owner;
const completed = [],
    readiness = async () => ({ ready: true, message: 'Synthetic queue fixture' });
async function fixtureRunner(config, job, _template, { signal, stage }) {
    await stage('compiling');
    await new Promise((r) => setTimeout(r, 30));
    if (signal.aborted) throw new Error('aborted');
    if (job.batch === 'FAIL') throw new Error('sensitive-path-or-tool-output');
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
async function call(url, body, credential = token) {
    const response = await fetch(base + url, {
        method: body ? 'POST' : 'GET',
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
    templateId: 'screenagent-1.0',
    domain: 'local',
    appName: 'Test "Name" & <test>',
    homeUrl: 'https://example.com/?q=a&b=2',
    apkId: 'BUILD_FIXTURE',
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
    assert.equal(catalog.body.templates.length, 2);
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
test('real HTTP queue flow is serial, idempotent, keeps ownership and exposes only authenticated fixture downloads', async () => {
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
    assert.ok(!('template_snapshot' in details));
    assert.ok(!('artifact_path' in details));
    assert.equal((await call(details.downloadUrl, null, null)).status, 401);
    assert.match((await call(details.downloadUrl)).body, /^SYNTHETIC-ARTIFACT-NOT-APK/);
    await rm(path.join(dir, 'files', row.artifact_path));
    assert.equal((await call(details.downloadUrl)).status, 404);
    assert.equal((await call(`/api/builds/${id}`)).body.build.artifactAvailable, false);
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
    await db('apk_routes').where('apk_id', 'BUILD_FIXTURE').update({ enabled: false });
    assert.equal((await call('/api/builds', input())).status, 409);
    await db('apk_routes').where('apk_id', 'BUILD_FIXTURE').update({ enabled: true });
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
    };
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
        await prepareSource(settings, job, t, source);
        const xml = await readFile(
            path.join(source, 'app/src/main/res/values/strings.xml'),
            'utf8',
        );
        assert.ok(xml.includes('&amp;'));
        assert.ok(xml.includes('&lt;TV&gt;'));
        assert.ok(xml.includes('formatted="false"'));
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
        assert.equal(assets.buildId, job.id);
        assert.ok(!assets.token);
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
    await symlink(path.join(dir, 'screenagent-1.0'), path.join(dir, 'evil-link'));
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
