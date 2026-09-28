import { SignJWT, jwtVerify } from 'jose';
import { hkdfSync } from 'node:crypto';
import { fail } from './protocol.js';
export const isLoopback = (ip) => ['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(ip);
function trustedProxyHostMatches(value, expected) {
    if (typeof value !== 'string' || value !== value.trim() || value.includes(',')) return false;
    const host = value.toLowerCase();
    if (expected.port) return host === expected.host.toLowerCase();
    const hostname = expected.hostname.toLowerCase();
    return host === hostname || host === `${hostname}:80` || host === `${hostname}:443`;
}
export function allowedRequest(req, config, requireOrigin = false) {
    if (!isLoopback(req.socket.remoteAddress)) return false;
    const expected = new URL(config.origin);
    const forwarded = ['forwarded', 'x-forwarded-for', 'x-forwarded-host', 'x-forwarded-proto'];
    if (!config.trustProxy && forwarded.some((name) => req.headers[name])) return false;
    if (config.trustProxy) {
        if (req.headers.forwarded) return false;
        if (req.headers['x-forwarded-proto'] !== expected.protocol.slice(0, -1)) return false;
        if (
            req.headers['x-forwarded-host'] &&
            !trustedProxyHostMatches(req.headers['x-forwarded-host'], expected)
        )
            return false;
        if (!req.headers['x-real-ip'] || !req.headers['x-forwarded-for']) return false;
    }
    if (
        config.trustProxy
            ? !trustedProxyHostMatches(req.headers.host, expected)
            : req.headers.host !== expected.host
    )
        return false;
    if (req.headers.origin && req.headers.origin !== config.origin) return false;
    if (requireOrigin && req.headers.origin !== config.origin) return false;
    return (
        !req.headers['sec-fetch-site'] ||
        req.headers['sec-fetch-site'] === 'same-origin' ||
        req.headers['sec-fetch-site'] === 'none'
    );
}
export function localOnly(config) {
    return (req, res, next) => {
        if (!allowedRequest(req, config)) return next(fail(403, '仅开放本机同源工作区'));
        if (
            !['GET', 'HEAD', 'OPTIONS'].includes(req.method) &&
            req.headers['x-boundary-request'] !== '1'
        )
            return next(fail(403, '请求校验失败'));
        next();
    };
}
export function tokens(masterKey, projectId) {
    const key = new Uint8Array(hkdfSync('sha256', masterKey, 'boundary', 'ws-jwt-v1', 32));
    return {
        async issue(role, subject = 'local-panel', ttl = '10m', claims = {}) {
            return new SignJWT({ ...claims, role, projectId })
                .setProtectedHeader({ alg: 'HS256' })
                .setIssuer('boundary-local')
                .setAudience('boundary-ws')
                .setSubject(subject)
                .setIssuedAt()
                .setExpirationTime(ttl)
                .sign(key);
        },
        async verify(token, role, expectedProject = projectId) {
            try {
                const { payload } = await jwtVerify(token, key, {
                    algorithms: ['HS256'],
                    issuer: 'boundary-local',
                    audience: 'boundary-ws',
                });
                if (
                    payload.role !== role ||
                    !Number.isInteger(payload.projectId) ||
                    (expectedProject !== null && payload.projectId !== expectedProject) ||
                    !payload.sub ||
                    !payload.exp
                )
                    throw new Error();
                return payload;
            } catch {
                throw fail(401, '连接凭证无效或已过期');
            }
        },
    };
}
