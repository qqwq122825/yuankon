export async function api(url, options = {}) {
    const { authFailureEvent = true, ...fetchOptions } = options;
    const response = await fetch(url, {
        ...fetchOptions,
        headers: {
            ...(options.body
                ? { 'Content-Type': 'application/json', 'X-Boundary-Request': '1' }
                : {}),
            ...options.headers,
        },
        credentials: 'same-origin',
    });
    const data = await response.json();
    if (response.status === 401 && authFailureEvent && !url.startsWith('/api/auth/login'))
        window.dispatchEvent(new CustomEvent('auth-expired', { detail: '登录已失效，请重新登录' }));
    if (!response.ok)
        throw Object.assign(new Error(data.error || '请求失败'), { status: response.status });
    return data;
}
export const mutate = (url, method, body = {}) => api(url, { method, body: JSON.stringify(body) });
export const sourceLabel = (s) =>
    ({ sample: '合成示例', import: '历史记录', api: '设备 API' })[s] || s;
export const formatDate = (v) =>
    v
        ? new Date(v.includes?.('T') ? v : v.replace?.(' ', 'T') || v).toLocaleString('zh-CN', {
              hour12: false,
          })
        : '—';

export function normalizeWireDevice(device) {
    return {
        id: device.localId,
        public_id: device.id,
        name: device.name,
        brand: device.model,
        android_version: device.osVersion,
        status: device.status,
        battery: device.batteryLevel,
        accessibility_enabled: device.accessibilityAlive,
        isLocked: device.isLocked,
        isScreenOn: device.isScreenOn,
        lastSeen: device.lastSeen,
        note: device.remark,
        source: device.source,
        is_blacklisted: Boolean(device.isBlacklisted),
    };
}
