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
        'android/apk-templates/b-packages/screenagent-1.7.4/app/src/main',
    );
    const manifest = await readFile(path.join(screenagent, 'AndroidManifest.xml'), 'utf8');
    const screenagentConfig = await readFile(
        path.join(screenagent, 'assets/agent_config.json'),
        'utf8',
    );
    const agentRuntimeConfig = await readFile(
        path.join(screenagent, 'java/com/zaka/screenagent/Config.kt'),
        'utf8',
    );
    const installer = path.join(
        ROOT,
        'android/apk-templates/a-packages/installer-1.2/app/src/main',
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
    const projectionActivity = await readFile(
        path.join(screenagent, 'java/com/zaka/screenagent/ProjectionActivity.kt'),
        'utf8',
    );
    const mainActivity = await readFile(
        path.join(screenagent, 'java/com/zaka/screenagent/MainActivity.kt'),
        'utf8',
    );
    const projectionService = await readFile(
        path.join(screenagent, 'java/com/zaka/screenagent/capture/ProjectionCaptureService.kt'),
        'utf8',
    );
    const projectionController = await readFile(
        path.join(screenagent, 'java/com/zaka/screenagent/capture/ProjectionController.kt'),
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
    assert.match(manifest, /android\.permission\.WAKE_LOCK/);
    assert.match(manifest, /android\.permission\.ACCESS_NOTIFICATION_POLICY/);
    assert.match(manifest, /android\.permission\.FOREGROUND_SERVICE_MEDIA_PROJECTION/);
    assert.match(manifest, /android:foregroundServiceType="mediaProjection"/);
    assert.match(manifest, /<activity\b/);
    assert.match(manifest, /android\.intent\.action\.MAIN/);
    assert.match(manifest, /android\.intent\.category\.LAUNCHER/);
    assert.match(manifest, /android:exported="false"/);
    assert.doesNotMatch(screenagentConfig, /webUrl/);
    assert.match(installerManifest, /android\.intent\.action\.MAIN/);
    assert.match(installerManifest, /android\.intent\.category\.LAUNCHER/);
    assert.match(installerManifest, /android\.permission\.INTERNET/);
    assert.match(installerActivity, /new WebView\(this\)/);
    assert.match(installerActivity, /webView\.loadUrl\(config\.getString\("homeUrl"\)\)/);
    assert.match(installerManifest, /__PAYLOAD_PACKAGE_NAME__/);
    assert.match(
        installerActivity,
        /getApplicationInfo\(config\.getString\("payloadPackageName"\), 0\)/,
    );
    assert.match(installerActivity, /install\.setText\("安装 B 包"\)/);
    assert.match(installerActivity, /"2\. 打开无障碍"/);
    assert.match(installerActivity, /Settings\.ACTION_APPLICATION_DETAILS_SETTINGS/);
    assert.match(installerActivity, /Build\.VERSION_CODES\.TIRAMISU/);
    assert.match(installerActivity, /允许受限设置/);
    assert.match(installerActivity, /Settings\.Secure\.ENABLED_ACCESSIBILITY_SERVICES/);
    assert.match(installerActivity, /Settings\.ACTION_ACCESSIBILITY_SETTINGS/);
    assert.match(installerActivity, /ACCESSIBILITY_AFTER_INSTALL/);
    assert.doesNotMatch(installerActivity, /打开 B 包设置/);
    assert.doesNotMatch(installerActivity, /openHomePage/);
    assert.match(metadata, /canTakeScreenshot="true"/);
    assert.match(metadata, /canRetrieveWindowContent="true"/);
    assert.match(metadata, /flagRetrieveInteractiveWindows\|flagReportViewIds/);
    assert.match(service, /CMD_VIEWER_LEASE/);
    assert.doesNotMatch(service, /ProjectionActivity\.request\(this\)/);
    assert.match(mainActivity, /ProjectionActivity\.request\(this@MainActivity\)/);
    assert.match(service, /takeScreenshot\(/);
    assert.match(manifest, /MainActivity/);
    assert.match(service, /initial_accessibility/);
    assert.doesNotMatch(service, /screenshotIntervalMs|waitMs/);
    assert.match(service, /takeScreenshot\(/);
    assert.match(service, /ProjectionCaptureService\.captureLatest/);
    assert.match(service, /if \(data != null\) 0 else 500/);
    assert.match(projectionActivity, /createScreenCaptureIntent\(\)/);
    assert.doesNotMatch(projectionActivity, /RequestPermission|POST_NOTIFICATIONS/);
    assert.doesNotMatch(projectionActivity, /setContentView|Button|TextView/);
    assert.match(projectionService, /getMediaProjection\(resultCode, data\)/);
    assert.match(projectionService, /startForeground\(/);
    assert.match(projectionController, /ImageReader\.newInstance\(/);
    assert.match(projectionController, /createVirtualDisplay\(/);
    assert.match(projectionController, /acquireLatestImage\(\)/);
    assert.match(projectionController, /image\?\.close\(\)/);
    assert.ok(
        projectionController.indexOf('registerCallback') <
            projectionController.indexOf('createVirtualDisplay'),
    );
    assert.match(service, /CMD_DEVICE_ACTION/);
    assert.match(service, /CMD_TEXT_INPUT/);
    assert.match(service, /MAX_NODE_COUNT = 250/);
    assert.match(service, /scheduleNodeSnapshot/);
    assert.match(service, /accessibilitySnapshot\(viewerId, payload\)/);
    assert.match(service, /\.put\("text"/);
    assert.match(service, /\.put\("content_description"/);
    assert.match(socket, /fun accessibilitySnapshot\(viewerId: String, payload: JSONObject\)/);
    assert.match(socket, /Protocol\.NODE_VERSION/);
    assert.match(service, /FOCUS_INPUT/);
    assert.match(service, /ACTION_SET_TEXT/);
    assert.match(service, /isPassword/);
    assert.match(service, /text\.length > 500/);
    assert.doesNotMatch(socket, /put\("text"/);
    assert.match(service, /GLOBAL_ACTION_BACK/);
    assert.match(service, /GLOBAL_ACTION_HOME/);
    assert.match(service, /GLOBAL_ACTION_RECENTS/);
    assert.match(service, /GLOBAL_ACTION_LOCK_SCREEN/);
    assert.match(service, /ACCESS_NOTIFICATION_POLICY|isNotificationPolicyAccessGranted/);
    assert.match(service, /SCREEN_BRIGHT_WAKE_LOCK/);
    assert.match(screenagentConfig, /"maxWidth": 540/);
    assert.match(screenagentConfig, /"quality": 50/);
    assert.doesNotMatch(screenagentConfig, /"intervalMs"/);
    assert.doesNotMatch(agentRuntimeConfig, /captureIntervalMs|var interval =/);
    assert.match(service, /scheduleViewerFrame/);
    assert.match(service, /onServiceConnected[\s\S]*connect\(\)/);
    assert.match(service, /ensureOnline\(\)/);
    assert.match(service, /uploader\.online/);
    assert.match(service, /registerDefaultNetworkCallback/);
    assert.match(service, /accessibilityAlive", true/);
    assert.match(socket, /registerDefaultNetworkCallback/);
    assert.match(socket, /onAuthenticationRequired/);
    assert.match(socket, /send\(Protocol\.UP_STATUS/);
    assert.match(socket, /send\(Protocol\.UP_PING/);
    assert.match(socket, /main\.postDelayed\(this, 20_000\)/);
    for (const version of ['1.0', '1.1', '1.2', '1.3', '1.4'])
        await assert.rejects(() =>
            access(path.join(ROOT, `android/apk-templates/b-packages/screenagent-${version}`)),
        );
});
test('template sourceDir accepts version folders but stays inside the unified template root', async () => {
    const base = (await loadTemplates(ROOT))[0];
    assert.equal(
        templateSchema.parse({ ...base, sourceDir: 'b-packages/screenagent-1.7.4' }).sourceDir,
        'b-packages/screenagent-1.7.4',
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

test('1.7.5 screen sharing consent and API debug are explicit', async () => {
    const template = (await loadTemplates(ROOT))[0];
    assert.equal(template.id, 'screenagent-1.7.5');
    assert.equal(template.versionName, '1.7.5');
    assert.equal(template.versionCode, 13);
    const asset = JSON.parse(
        await readFile(
            path.join(
                await templateSource(ROOT, template),
                'app/src/main/assets/agent_config.json',
            ),
            'utf8',
        ),
    );
    assert.equal(asset.version, template.versionName);
    const source = path.join(await templateSource(ROOT, template), 'app/src/main');
    const java = path.join(source, 'java/com/zaka/screenagent');
    const service = await readFile(
        path.join(java, 'accessibility/BoundaryAccessibilityService.kt'),
        'utf8',
    );
    const projection = await readFile(path.join(java, 'ProjectionActivity.kt'), 'utf8');
    const main = await readFile(path.join(java, 'MainActivity.kt'), 'utf8');
    const mode = await readFile(path.join(java, 'CaptureMode.kt'), 'utf8');
    const gate = await readFile(path.join(java, 'ProjectionConsentGate.kt'), 'utf8');
    const manifest = await readFile(path.join(source, 'AndroidManifest.xml'), 'utf8');
    assert.doesNotMatch(service, /ProjectionActivity|createScreenCaptureIntent|startActivity/);
    assert.match(service, /debugReport/);
    assert.match(service, /mediaprojection/);
    assert.match(service, /taskscreenshot/);
    assert.match(main, /setOnClickListener[\s\S]*ProjectionActivity\.request\(this@MainActivity\)/);
    assert.equal((main.match(/ProjectionActivity\.request/g) || []).length, 1);
    assert.match(main, /BuildConfig\.VERSION_NAME/);
    assert.match(main, /ProjectionConsentGate\.cancel\(\)/);
    assert.match(main, /ProjectionCaptureService\.stop\(this@MainActivity\)/);
    assert.match(mode, /getString\(KEY, ACCESSIBILITY\)/);
    assert.match(projection, /fun request\(activity: Activity\)/);
    assert.match(
        projection,
        /ProjectionConsentGate\.consume\(intent\.getStringExtra\(EXTRA_CLICK_TICKET\)\)/,
    );
    assert.match(projection, /if \(projectionRequested\) return/);
    assert.match(projection, /CaptureMode\.get\(this\) == CaptureMode\.PROJECTION/);
    assert.match(gate, /@Synchronized fun consume/);
    assert.match(gate, /ticket == null \|\| ticket != pending/);
    assert.match(gate, /pending = null/);
    assert.doesNotMatch(gate, /SharedPreferences/);
    assert.doesNotMatch(manifest, /POST_NOTIFICATIONS/);
    const activity = manifest.match(/<activity[^>]*ProjectionActivity[^>]*\/>/)[0];
    assert.match(activity, /android:exported="false"/);
    assert.doesNotMatch(activity, /singleTask/);
});
