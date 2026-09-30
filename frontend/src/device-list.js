// The cache is scoped to the mounted device page, not persisted across accounts.
export const DEVICE_CACHE_BATCH = 500;
export const DEVICE_PAGE_SIZE = 10;

// Search and ordering still run on the server. Quick filters and UI pages do not.
export function deviceListQuery(query, page = 1) {
    return new URLSearchParams({
        q: String(query.q || ''),
        sort: String(query.sort || 'id'),
        direction: String(query.direction || 'asc'),
        page: String(page),
        perPage: String(DEVICE_CACHE_BATCH),
    }).toString();
}

export function localDevicePage(result, query) {
    if (!result) return null;
    const date = /^\d{4}-\d{2}-\d{2}$/.test(String(query.installedDate || ''))
        ? String(query.installedDate)
        : '';
    const data = result.data.filter((row) => {
        if (date && installationDate(row.installed_at) !== date) return false;
        const online = row.status === 'online' && !row.is_blacklisted;
        if (query.status === 'online' && !online) return false;
        if (query.status === 'offline' && online) return false;
        if (query.a11y === 'enabled' && row.accessibility_enabled !== true) return false;
        if (query.a11y === 'disabled' && row.accessibility_enabled !== false) return false;
        if (['api', 'import', 'sample'].includes(query.source) && row.source !== query.source)
            return false;
        return true;
    });
    const pages = Math.max(1, Math.ceil(data.length / DEVICE_PAGE_SIZE));
    const requestedPage = Number(query.page);
    const page = Math.min(
        pages,
        Number.isSafeInteger(requestedPage) && requestedPage > 0 ? requestedPage : 1,
    );
    return {
        ...result,
        data: data.slice((page - 1) * DEVICE_PAGE_SIZE, page * DEVICE_PAGE_SIZE),
        total: data.length,
        page,
        perPage: DEVICE_PAGE_SIZE,
    };
}

// Installation statistics and the date picker share the project's Beijing day boundary.
export function installationDate(value) {
    const timestamp = Number(value);
    if (!Number.isFinite(timestamp) || timestamp <= 0) return '';
    const date = new Date(timestamp + 8 * 60 * 60 * 1000);
    return Number.isNaN(date.getTime()) ? '' : date.toISOString().slice(0, 10);
}
