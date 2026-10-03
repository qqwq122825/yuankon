// object-fit: contain coordinates; letterboxing never becomes a phone tap.
export function screenshotPoint(clientX, clientY, rect, width, height) {
    if (
        ![clientX, clientY, rect.left, rect.top, rect.width, rect.height, width, height].every(
            Number.isFinite,
        ) ||
        Math.min(rect.width, rect.height, width, height) <= 0
    )
        return null;
    const scale = Math.min(rect.width / width, rect.height / height);
    const x = (clientX - rect.left - (rect.width - width * scale) / 2) / (width * scale);
    const y = (clientY - rect.top - (rect.height - height * scale) / 2) / (height * scale);
    return x >= 0 && x <= 1 && y >= 0 && y <= 1 ? { x, y } : null;
}

// Reader taps share the existing consented SCREEN_TAP channel, never an arbitrary node action.
export function readerTapFrame(snapshot, frame, now = Date.now()) {
    const display = snapshot?.payload?.display;
    const received = Date.parse(snapshot?.received_at);
    const captured = Date.parse(snapshot?.captured_at);
    if (
        snapshot?.source !== 'live' ||
        !frame ||
        !display ||
        ![
            received,
            captured,
            frame.receivedAt,
            frame.capturedAt,
            frame.expiresAt,
            display.width,
            display.height,
            frame.width,
            frame.height,
        ].every(Number.isFinite) ||
        Math.min(display.width, display.height, frame.width, frame.height) <= 0 ||
        now - received < 0 ||
        now - received > 2500 ||
        now - frame.receivedAt < 0 ||
        now - frame.receivedAt > 2500 ||
        frame.expiresAt <= now ||
        Math.abs(captured - frame.capturedAt) > 1500 ||
        Math.abs(display.width / display.height - frame.width / frame.height) > 0.01 ||
        !snapshot.payload.windows?.some((w) => w.active && w.root_status === 'available')
    )
        return null;
    return frame.frameId;
}
