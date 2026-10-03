// Debug-session-only structural records. No raw labels, input, view IDs or banking body.
function bounded(value) {
    let result = '';
    for (const character of value) {
        if (Buffer.byteLength(result + character) > 80) break;
        result += character;
    }
    return result;
}
export function nodeDiagnosticEvents(frame) {
    const all = frame.payload.windows.flatMap((window) =>
        window.nodes.map((node) => ({ window, node })),
    );
    const records = all.slice(0, 200).map(({ window, node }) => ({
        id: bounded(node.id),
        parentId: node.parent_id == null ? null : bounded(node.parent_id),
        windowId: bounded(window.id),
        className: bounded(node.class_name),
        bounds: node.bounds,
        visible: node.flags.visible ?? null,
        clickable: node.flags.clickable ?? null,
        editable: node.flags.editable ?? null,
        password: node.flags.password ?? null,
        sensitive: node.flags.sensitive ?? null,
        textPresent: !!node.text_present,
        targetIconMatch:
            window.package === 'com.android.launcher3' &&
            !node.flags.password &&
            !node.flags.editable &&
            !node.flags.sensitive &&
            [node.text, node.content_description].some(
                (value) =>
                    typeof value === 'string' && /^yono\s+lite(?:\b|[.…])/i.test(value.trim()),
            ),
    }));
    const matched = records.filter((node) => node.targetIconMatch).map((node) => node.id);
    const events = [];
    for (let i = 0; i < records.length;) {
        let count = Math.min(6, records.length - i);
        while (count > 1 && Buffer.byteLength(JSON.stringify(records.slice(i, i + count))) > 3400)
            count--;
        events.push({
            source: 'service',
            stage: 'nodes_structure',
            message: 'redacted received node structure',
            details: {
                snapshotId: frame.id,
                capturedAt: frame.captured_at,
                offset: i,
                totalNodeCount: all.length,
                recordedNodeCount: records.length,
                recordsTruncated: all.length > 200,
                targetIconMatches: matched.length,
                nodeRecords: records.slice(i, i + count),
            },
        });
        i += count;
    }
    return events;
}

// Fixed metadata only: never serialize error messages, received text or rejected values.
export function nodeRejectionEvent(input, error) {
    const reasons = new Map([
        ['节点坐标无效', 'invalid_bounds'],
        ['节点引用或深度无效', 'invalid_tree_reference'],
        ['节点结构无效', 'invalid_node_structure'],
        ['实时节点快照超出边界', 'live_snapshot_limit'],
        ['阅读器查看租约已结束', 'viewer_lease_expired'],
        ['websocket_payload_limit', 'websocket_payload_limit'],
    ]);
    const allowed = new Set([
        'windows',
        'nodes',
        'bounds',
        'id',
        'parent_id',
        'class_name',
        'view_id',
        'flags',
        'text',
        'content_description',
        'contentDescription',
        'display',
        'width',
        'height',
        'captured_at',
        'diagnostics',
        'observations',
        'schema_version',
        'type',
        'package',
        'active',
        'focused',
        'root_status',
    ]);
    const issues = Array.isArray(error.issues)
        ? error.issues.slice(0, 5).map((issue) => ({
              code: /^[a-z_]{1,40}$/.test(issue.code) ? issue.code : 'validation',
              path: (issue.path || [])
                  .slice(0, 12)
                  .map((part) =>
                      Number.isInteger(part) ? part : allowed.has(part) ? part : 'field',
                  )
                  .join('.'),
          }))
        : [];
    const windows = Array.isArray(input?.windows) ? input.windows : [];
    const count = windows.reduce(
        (sum, window) => sum + (Array.isArray(window?.nodes) ? window.nodes.length : 0),
        0,
    );
    const details = {
        capturedAt:
            typeof input?.captured_at === 'string' &&
            input.captured_at.length <= 80 &&
            Number.isFinite(Date.parse(input.captured_at))
                ? input.captured_at
                : null,
        nodeCount: count,
        payloadBytes: Buffer.byteLength(JSON.stringify(input) || ''),
        reasonCode:
            reasons.get(error.message) || (issues.length ? 'schema_validation' : 'receive_failure'),
        validationIssues: JSON.stringify(issues),
    };
    return {
        source: 'websocket',
        stage: 'nodes_rejected',
        level: 'warn',
        message: 'server rejected node snapshot',
        details,
    };
}
