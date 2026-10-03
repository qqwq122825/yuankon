import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
test('1.7.9 preserves old templates and adds leased launcher freshness without input collection', async () => {
    const root = new URL('../../android/apk-templates/', import.meta.url);
    const templates = JSON.parse(await readFile(new URL('templates.json', root)));
    assert.equal(templates[0].id, 'screenagent-1.8.3');
    assert.equal(templates[0].versionCode, 21);
    assert.ok(templates.some((t) => t.id === 'screenagent-1.7.8' && t.versionCode === 16));
    const dir = new URL('b-packages/screenagent-1.7.9/app/src/main/', root);
    const xml = await readFile(new URL('res/xml/boundary_accessibility_service.xml', dir), 'utf8');
    assert.match(xml, /flagIncludeNotImportantViews/);
    assert.match(xml, /typeViewClicked/);
    assert.doesNotMatch(xml, /android:packageNames=/);
    const service = await readFile(
        new URL('java/com/zaka/screenagent/accessibility/BoundaryAccessibilityService.kt', dir),
        'utf8',
    );
    assert.match(service, /Build.VERSION.SDK_INT >= 33.*clearCache/);
    assert.match(service, /NODE_REFRESH_INTERVAL_MS = 1000L/);
    assert.match(service, /if \(!leaseValid\(viewerId\)\) return/);
    assert.match(service, /TYPE_APPLICATION && \(it.isFocused \|\| it.isActive\)/);
    assert.match(service, /candidate.refresh\(\)/);
    assert.match(service, /if \(password \|\| editable\) JSONObject.NULL/);
    assert.match(service, /recordDebug\("service", "nodes_snapshot"/);
    assert.match(service, /screenTaps.geometry\(\)/);
});

test('1.8.0 correlates node reads and sends without event text, and deduplicates debug activation', async () => {
    const file = new URL(
        '../../android/apk-templates/b-packages/screenagent-1.8.0/app/src/main/java/com/zaka/screenagent/accessibility/BoundaryAccessibilityService.kt',
        import.meta.url,
    );
    const service = await readFile(file, 'utf8');
    assert.match(service, /previousSession != debugSessionId/);
    assert.match(service, /readSequence/);
    assert.match(service, /"nodes_send"/);
    assert.match(service, /"window_event"/);
    assert.doesNotMatch(service, /event\.text/);
    assert.match(service, /if \(password \|\| editable\) JSONObject.NULL/);
});

test('1.8.1 diagnoses root scope and traversal without logging labels or input', async () => {
    const service = await readFile(
        new URL(
            '../../android/apk-templates/b-packages/screenagent-1.8.1/app/src/main/java/com/zaka/screenagent/accessibility/BoundaryAccessibilityService.kt',
            import.meta.url,
        ),
        'utf8',
    );
    for (const field of [
        'windowInventory',
        'childReadFailures',
        'childrenReported',
        'childrenRead',
        'depthSkipped',
        'outsideDisplay',
        'lowestNodeBottom',
        'skippedUnchanged',
    ])
        assert.ok(service.includes(field));
    assert.match(service, /currentWindows.take\(8\)/);
    assert.match(service, /if \(skippedUnchanged\) \{\s*flushDebug\(\)/);
    assert.match(service, /if \(password \|\| editable\) JSONObject.NULL/);
    const inventory = service.slice(
        service.indexOf(
            'windowInventory = JSONArray()',
            service.indexOf('private fun currentApplicationRoot'),
        ),
        service.indexOf('var selected:'),
    );
    assert.doesNotMatch(inventory, /candidate\?\.(text|contentDescription)/);
});

test('1.8.3 root ascent stays inside app/window and failed diagnostics are bounded and retried', async () => {
    const service = await readFile(
        new URL(
            '../../android/apk-templates/b-packages/screenagent-1.8.3/app/src/main/java/com/zaka/screenagent/accessibility/BoundaryAccessibilityService.kt',
            import.meta.url,
        ),
        'utf8',
    );
    assert.match(service, /parent.windowId == selectedWindow/);
    assert.match(service, /parent.packageName\?\.toString\(\) == rootPackage/);
    assert.match(service, /rootParentsAscended < MAX_NODE_DEPTH/);
    assert.match(service, /node.refresh\(\)/);
    assert.match(service, /if \(debugUploadInFlight\) return/);
    assert.match(service, /debugSessionId != sessionId/);
    assert.match(service, /debug_report_failed/);
    assert.match(service, /while \(debugEvents.length\(\) > 50\)/);
    assert.match(service, /if \(password \|\| editable\) JSONObject.NULL/);
});
