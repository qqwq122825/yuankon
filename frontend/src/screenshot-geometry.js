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
