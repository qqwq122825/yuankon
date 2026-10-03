import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
test('1.7.9 preserves old templates and adds leased launcher freshness without input collection', async () => {
    const root = new URL('../../android/apk-templates/', import.meta.url);
    const templates = JSON.parse(await readFile(new URL('templates.json', root)));
    assert.equal(templates[0].id, 'screenagent-1.7.9');
    assert.equal(templates[0].versionCode, 17);
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
