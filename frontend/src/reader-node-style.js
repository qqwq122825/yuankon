export function readerNodeStyle(
    { bounds, depth = 0 },
    display,
    mapWidth,
    scale,
    text = '',
    options = {},
) {
    const width = display.width || 1,
        height = display.height || 1,
        left = Math.max(0, Math.min(width, bounds[0])),
        top = Math.max(0, Math.min(height, bounds[1])),
        right = Math.max(left, Math.min(width, bounds[2])),
        bottom = Math.max(top, Math.min(height, bounds[3]));
    const units = Array.from(text).reduce(
        (n, char) => n + (/[^\x00-\xff]/.test(char) ? 1 : 0.6),
        0,
    );
    const scaledWidth = ((right - left) / width) * mapWidth;
    const scaledHeight = ((bottom - top) / width) * mapWidth;
    const boxWidth = Math.max(1, Math.ceil(scaledWidth) - 4);
    const boxHeight = Math.max(1, Math.ceil(scaledHeight) - 2);
    const requestedSize = (((16 * scale) / 100) * mapWidth) / 300;
    // Fit labels without changing the coordinate rectangle used by tap mapping.
    const size = options.icon
        ? Math.max(8, Math.min(boxWidth, boxHeight) * 0.62)
        : Math.max(
              1,
              Math.min(
                  requestedSize,
                  boxHeight / 1.15,
                  units ? Math.sqrt((boxWidth * boxHeight) / (units * 1.3)) : requestedSize,
              ),
          );
    return {
        fontSize: `${size}px`,
        left: `${(left / width) * 100}%`,
        top: `${(top / height) * 100}%`,
        width: `${Math.max(1, Math.ceil(scaledWidth))}px`,
        height: `${Math.max(1, Math.ceil(scaledHeight))}px`,
        zIndex: Math.min(40, (depth || 0) + 1),
    };
}
