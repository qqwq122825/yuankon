// Readiness is device-reported metadata, not authorization to open a viewer.
export function shouldResumeCapture(previous, current, { viewing, viewerId }) {
    return Boolean(
        viewing &&
        viewerId &&
        !current.is_blacklisted &&
        current.status === 'online' &&
        current.captureReady === true &&
        (previous.captureReady !== true ||
            previous.captureMode !== current.captureMode ||
            previous.status !== 'online'),
    );
}
