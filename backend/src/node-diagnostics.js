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
