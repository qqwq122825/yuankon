import { WebSocketServer, WebSocket } from 'ws';
import { z } from 'zod';
import { allowedRequest } from './security.js';
import {
    panelSchema,
    statusSchema,
    fail,
    wireDevice,
    deviceIdSchema,
    DEVICE_ACTIONS,
} from './protocol.js';

export function attachWebSockets(
    server,
    store,
    auth,
    config,
    { dev = false, accounts, ingress } = {},
) {
    const panels = new WebSocketServer({
        noServer: true,
        maxPayload: 16 * 1024,
        perMessageDeflate: false,
    });
    const devices = new WebSocketServer({
        noServer: true,
        maxPayload: 128 * 1024,
        perMessageDeflate: false,
    });
    const connections = new Map();
    const pendingDevicePings = new Map();
    const send = (ws, value) => {
        if (ws.readyState === WebSocket.OPEN) {
            if (ws.bufferedAmount > 1024 * 1024) ws.close(1013, 'slow_consumer');
            else {
                ws.send(JSON.stringify(value));
                return true;
            }
        }
        return false;
    };
    const logout = (ws, reason) => {
        send(ws, {
            type: 'forced_logout',
            code: reason,
            message:
                reason === 'kicked'
                    ? '账号已在另一端登录'
                    : reason === 'password_changed'
                      ? '密码已更新，请重新登录'
                      : '登录已失效，请重新登录',
        });
        ws.close(4001, reason);
    };
    const expireTicket = (ws) => {
        send(ws, { type: 'forced_logout', code: 'ticket_expired', message: '连接凭证已过期' });
        ws.close(4001, 'ticket_expired');
    };
    const onSessionChanged = ({ userId, reason, keepSid, onlySid }) => {
        for (const ws of panels.clients)
            if (
                Number(ws.principal.sub) === userId &&
                ws.principal.sid !== keepSid &&
                (!onlySid || ws.principal.sid === onlySid)
            )
                logout(ws, reason);
    };
    accounts.on('sessionChanged', onSessionChanged);
    const broadcast = async (value) => {
        await Promise.all(
            [...panels.clients].map(async (ws) => {
                if (Date.now() >= ws.principal.exp * 1000) return expireTicket(ws);
                try {
                    await accounts.resolveSession(ws.principal);
                    send(ws, value);
                } catch {
                    logout(ws, 'session_expired');
                }
            }),
        );
    };
    const publish = async (id, type = 'device_status_update') =>
        broadcast({ type, data: wireDevice(await store.device(id, true)), timestamp: Date.now() });
    const publishSubscribers = (id, value) => {
        for (const panel of panels.clients) if (panel.subscriptions?.has(id)) send(panel, value);
    };
    const sendDeviceCommand = (id, command, commandId, params) => {
        const socket = connections.get(id);
        return Boolean(
            socket &&
            send(socket, {
                protocol: 'boundary-screenshot-v2',
                type: 'command',
                data: { command, commandId, params },
                timestamp: Date.now(),
            }),
        );
    };
    const closeViewer = (panel, id, reason = 'viewer_closed') => {
        const viewer = panel.viewers?.get(id);
        if (!viewer) return;
        panel.viewers.delete(id);
        ingress?.cancelCapture(viewer.device, viewer.viewerId);
        sendDeviceCommand(id, 'SCREENSHOT_VIEWER_CLOSE', viewer.viewerId, {
            viewerId: viewer.viewerId,
            reason,
        });
    };
    server.on('upgrade', async (req, socket, head) => {
        if (dev && req.headers['sec-websocket-protocol'] === 'vite-hmr') return;
        try {
            const url = new URL(req.url, config.origin),
                panel = url.pathname === '/ws/panel';
            if (!panel && !['/ws/device', '/ws/session'].includes(url.pathname))
                throw fail(404, 'unknown_channel');
            if (!allowedRequest(req, config, panel)) throw fail(403, 'origin_check');
            const token = panel
                ? url.searchParams.get('token')
                : req.headers.authorization?.replace(/^Bearer /, '');
            const principal = panel
                ? await accounts.verifyPanel(token)
                : await auth.verify(token, 'device', null);
            if (!panel) {
                const device = await store.device(principal.sub, true);
                if (device.source !== 'api' || device.project_id !== principal.projectId)
                    throw fail(403, 'device_source');
                await ingress?.resolve(principal);
            }
            const hub = panel ? panels : devices;
            if (hub.clients.size >= (panel ? 32 : 128)) throw fail(429, 'connection_limit');
            hub.handleUpgrade(req, socket, head, (ws) => {
                ws.principal = principal;
                hub.emit('connection', ws, req);
            });
        } catch (e) {
            socket.write(`HTTP/1.1 ${e.status || 401} Rejected\r\nConnection: close\r\n\r\n`);
            socket.destroy();
        }
    });
    function setup(ws, handler) {
        ws.alive = true;
        ws.rate = { at: Date.now(), count: 0 };
        ws.pending = 0;
        let chain = Promise.resolve();
        ws.on('pong', () => {
            ws.alive = true;
        });
        ws.on('error', () => {});
        ws.on('message', (raw, binary) => {
            if (Date.now() - ws.rate.at > 1000) ws.rate = { at: Date.now(), count: 0 };
            if (++ws.rate.count > 30 || ws.pending >= 30) return ws.close(1008, 'rate_limit');
            if (binary)
                return send(ws, {
                    type: 'error',
                    code: 'unsupported_binary',
                    message: '当前版本接收状态 JSON',
                });
            ws.pending++;
            chain = chain
                .then(async () => {
                    if (ws.readyState !== WebSocket.OPEN) return;
                    if (Date.now() >= ws.principal.exp * 1000) return expireTicket(ws);
                    try {
                        if (ws.principal.role === 'panel')
                            await accounts.resolveSession(ws.principal);
                        await handler(JSON.parse(raw.toString()), raw.length);
                    } catch (e) {
                        if (e.status === 401) {
                            logout(ws, 'session_expired');
                            return;
                        }
                        const code = e.status === 404 ? 'not_found' : 'invalid_message';
                        send(ws, {
                            type: 'error',
                            code,
                            message: e.status === 404 ? '设备不存在' : '报文格式或能力未启用',
                        });
                        await store.audit(
                            'invalid_message',
                            ws.principal.role === 'panel' ? 'panel' : 'device',
                            null,
                            raw.length,
                        );
                    }
                })
                .catch(() => ws.close(1011, 'internal_error'))
                .finally(() => {
                    ws.pending--;
                });
        });
    }
    panels.on('connection', (ws) => {
        ws.subscriptions = new Set();
        ws.viewers = new Map();
        send(ws, {
            type: 'connected',
            data: {
                mode: 'authenticated-local',
                protocol: 'boundary-node-v1',
                screenshotProtocol: 'boundary-screenshot-v2',
                capabilities: [
                    'status',
                    'read_only_subscription',
                    'GET_DEVICE_STATE',
                    'SCREENSHOT_NOW',
                    'DEVICE_ACTION',
                    'TEXT_INPUT',
                    'capture_viewer_lease',
                    'accessibility_snapshot',
                ],
            },
        });
        setup(ws, async (raw, size) => {
            const message = panelSchema.parse(raw);
            if (message.type === 'ping') return send(ws, { type: 'pong', timestamp: Date.now() });
            if (message.type === 'get_bot_list') {
                const rows = await store.devices();
                return send(ws, {
                    type: 'bot_list',
                    data: rows
                        .map((r) => store.dto(r))
                        .filter((d) => d.status === 'online')
                        .map(wireDevice),
                });
            }
            const device = await store.device(message.sessionId, true);
            if (message.type === 'subscribe') {
                if (ws.subscriptions.size >= 20 && !ws.subscriptions.has(device.public_id))
                    throw fail(422, 'subscription_limit');
                ws.subscriptions.add(device.public_id);
                send(ws, {
                    type: 'subscribed',
                    sessionId: device.public_id,
                    data: { readOnly: true },
                });
                send(ws, {
                    type: 'get_device_state_response',
                    sessionId: device.public_id,
                    data: wireDevice(device),
                    cached: true,
                });
            } else if (message.type === 'unsubscribe') {
                closeViewer(ws, device.public_id, 'viewer_unsubscribed');
                ws.subscriptions.delete(device.public_id);
                send(ws, { type: 'unsubscribed', sessionId: device.public_id });
            } else if (message.type === 'capture_viewer_heartbeat') {
                if (!ws.subscriptions.has(device.public_id)) throw fail(409, '请先订阅设备状态');
                const expiresAt = Date.now() + 12000;
                ws.viewers.set(device.public_id, {
                    device,
                    viewerId: message.data.viewerId,
                    expiresAt,
                });
                ingress?.renewCapture(device, message.data.viewerId, expiresAt);
                const deviceOnline = sendDeviceCommand(
                    device.public_id,
                    'SCREENSHOT_VIEWER_LEASE',
                    message.data.viewerId,
                    {
                        viewerId: message.data.viewerId,
                        validForMs: 12000,
                    },
                );
                send(ws, {
                    type: 'capture_viewer_lease',
                    sessionId: device.public_id,
                    data: { viewerId: message.data.viewerId, expiresAt, deviceOnline },
                });
            } else if (message.type === 'capture_viewer_close') {
                const viewer = ws.viewers.get(device.public_id);
                if (viewer?.viewerId === message.data.viewerId)
                    closeViewer(ws, device.public_id, 'viewer_closed');
                send(ws, {
                    type: 'capture_viewer_closed',
                    sessionId: device.public_id,
                    data: { viewerId: message.data.viewerId },
                });
            } else if (message.type === 'command' && message.data.command === 'DEVICE_PING') {
                if (!connections.has(device.public_id)) throw fail(409, '设备当前离线');
                const sentAt = Date.now();
                pendingDevicePings.set(message.data.commandId, sentAt);
                if (
                    !sendDeviceCommand(device.public_id, 'DEVICE_PING', message.data.commandId, {})
                ) {
                    pendingDevicePings.delete(message.data.commandId);
                    throw fail(409, '设备当前离线');
                }
                send(ws, {
                    type: 'command_dispatched',
                    sessionId: device.public_id,
                    data: {
                        command: 'DEVICE_PING',
                        commandId: message.data.commandId,
                        sentAt,
                    },
                });
            } else if (message.type === 'command' && message.data.command === 'SCREENSHOT_NOW') {
                const viewer = ws.viewers.get(device.public_id);
                if (
                    !viewer ||
                    viewer.viewerId !== message.data.params.viewerId ||
                    viewer.expiresAt <= Date.now()
                )
                    throw fail(410, '截图查看租约已结束');
                if (!connections.has(device.public_id)) throw fail(409, '设备当前离线');
                ingress?.requestCapture(device, {
                    commandId: message.data.commandId,
                    viewerId: viewer.viewerId,
                    actorId: ws.principal.sub,
                });
                if (
                    !sendDeviceCommand(device.public_id, 'SCREENSHOT_NOW', message.data.commandId, {
                        viewerId: viewer.viewerId,
                        expiresAt: viewer.expiresAt,
                    })
                ) {
                    ingress?.cancelCapture(device, viewer.viewerId);
                    throw fail(409, '设备当前离线');
                }
                send(ws, {
                    type: 'command_dispatched',
                    sessionId: device.public_id,
                    data: {
                        command: 'SCREENSHOT_NOW',
                        commandId: message.data.commandId,
                        viewerId: viewer.viewerId,
                    },
                });
            } else if (message.type === 'command' && message.data.command === 'DEVICE_ACTION') {
                const viewer = ws.viewers.get(device.public_id);
                if (
                    !viewer ||
                    viewer.viewerId !== message.data.params.viewerId ||
                    viewer.expiresAt <= Date.now()
                )
                    throw fail(410, '截图查看租约已结束');
                if (!connections.has(device.public_id)) throw fail(409, '设备当前离线');
                if (
                    !sendDeviceCommand(device.public_id, 'DEVICE_ACTION', message.data.commandId, {
                        viewerId: viewer.viewerId,
                        action: message.data.params.action,
                    })
                )
                    throw fail(409, '设备当前离线');
                send(ws, {
                    type: 'command_dispatched',
                    sessionId: device.public_id,
                    data: {
                        command: 'DEVICE_ACTION',
                        commandId: message.data.commandId,
                        viewerId: viewer.viewerId,
                        action: message.data.params.action,
                    },
                });
            } else if (message.type === 'command' && message.data.command === 'TEXT_INPUT') {
                const viewer = ws.viewers.get(device.public_id);
                if (
                    !viewer ||
                    viewer.viewerId !== message.data.params.viewerId ||
                    viewer.expiresAt <= Date.now()
                )
                    throw fail(410, '截图查看租约已结束');
                if (!connections.has(device.public_id)) throw fail(409, '设备当前离线');
                if (
                    !sendDeviceCommand(device.public_id, 'TEXT_INPUT', message.data.commandId, {
                        viewerId: viewer.viewerId,
                        text: message.data.params.text,
                    })
                )
                    throw fail(409, '设备当前离线');
                // 面板回执和审计仅记录路由元数据，不回显或单独记录本次文本正文。
                send(ws, {
                    type: 'command_dispatched',
                    sessionId: device.public_id,
                    data: {
                        command: 'TEXT_INPUT',
                        commandId: message.data.commandId,
                        viewerId: viewer.viewerId,
                    },
                });
            } else {
                send(ws, {
                    type: 'get_device_state_response',
                    sessionId: device.public_id,
                    data: wireDevice(device),
                    cached: true,
                });
            }
            await store.audit(
                message.type === 'command' ? message.data.command : message.type,
                'panel',
                device.public_id,
                size,
            );
        });
        ws.on('close', () => {
            for (const id of [...ws.viewers.keys()]) closeViewer(ws, id, 'panel_disconnected');
        });
    });
    devices.on('connection', (ws) => {
        const id = ws.principal.sub;
        const old = connections.get(id);
        connections.set(id, ws);
        old?.close(4001, 'session_expired');
        store
            .audit('device_ws_connected', 'device', id, 0, 'up', {
                method: 'WS',
                path: '/ws/device',
                status: 101,
                durationMs: 0,
            })
            .catch(() => {});
        setup(ws, async (raw, size) => {
            if (connections.get(id) !== ws) throw fail(401, 'superseded');
            const managed = await ingress?.resolve(ws.principal);
            if (ws.principal.jti) {
                if (
                    (raw.sessionId && raw.sessionId !== id) ||
                    (raw.botId && raw.botId !== id) ||
                    (raw.apkId && raw.apkId !== managed.apk_id)
                )
                    throw fail(403, 'identity_mismatch');
                if (raw.type === 'register') {
                    await store.audit('device_ws_register', 'device', id, size);
                    send(ws, {
                        type: 'register_ack',
                        data: {
                            deviceId: id,
                            apkId: managed.apk_id,
                            ownerAccountId: managed.owner_account_id,
                            debug: ingress?.debugState(managed),
                        },
                    });
                    return;
                }
                if (
                    raw.type === 'device_ping' ||
                    (raw.type === 'status' && raw.data?.type === 'device_status')
                ) {
                    await ingress.status(managed, { ...(raw.data || {}), deviceId: id });
                    await store.audit('device_heartbeat', 'device', id, size);
                    send(ws, {
                        type: 'status_ack',
                        timestamp: Date.now(),
                        data: { debug: ingress?.debugState(managed) },
                    });
                    return;
                }
                if (raw.type === 'accessibility_snapshot') {
                    const envelope = z
                        .object({
                            protocol: z.literal('boundary-node-v2'),
                            type: z.literal('accessibility_snapshot'),
                            sessionId: deviceIdSchema,
                            apkId: z.string().max(64).optional(),
                            timestamp: z.number().int().optional(),
                            data: z
                                .object({
                                    viewerId: z.string().uuid(),
                                    payload: z.unknown(),
                                })
                                .strict(),
                        })
                        .strict()
                        .parse(raw);
                    if (
                        envelope.sessionId !== id ||
                        (envelope.apkId && envelope.apkId !== managed.apk_id)
                    )
                        throw fail(403, 'identity_mismatch');
                    const snapshot = await ingress.receiveAccessibilitySnapshot(
                        managed,
                        envelope.data.viewerId,
                        envelope.data.payload,
                    );
                    publishSubscribers(id, {
                        type: 'accessibility_snapshot_ready',
                        sessionId: id,
                        data: {
                            snapshotId: snapshot.id,
                            viewerId: snapshot.viewerId,
                            capturedAt: snapshot.captured_at,
                            nodeCount: snapshot.node_count,
                            windowCount: snapshot.window_count,
                        },
                        timestamp: Date.now(),
                    });
                    send(ws, {
                        type: 'accessibility_snapshot_ack',
                        data: { snapshotId: snapshot.id, viewerId: snapshot.viewerId },
                    });
                    return;
                }
                if (raw.type === 'command_ack' || raw.type === 'screenshot_result') {
                    const metadata = {
                        protocol: z
                            .enum(['boundary-screenshot-v1', 'boundary-screenshot-v2'])
                            .optional(),
                        sessionId: deviceIdSchema.optional(),
                        apkId: z.string().max(64).optional(),
                        timestamp: z.number().int().optional(),
                    };
                    const reasonCode = z
                        .string()
                        .regex(/^[a-z0-9_]{1,60}$/)
                        .optional();
                    const envelope = z
                        .union([
                            z
                                .object({
                                    ...metadata,
                                    type: z.enum(['command_ack', 'screenshot_result']),
                                    data: z
                                        .object({
                                            command: z.literal('SCREENSHOT_NOW'),
                                            commandId: z.string().uuid(),
                                            result: z.enum([
                                                'accepted',
                                                'rejected',
                                                'uploaded',
                                                'failed',
                                            ]),
                                            reasonCode,
                                        })
                                        .strict(),
                                })
                                .strict(),
                            z
                                .object({
                                    ...metadata,
                                    type: z.literal('command_ack'),
                                    data: z
                                        .object({
                                            command: z.literal('DEVICE_PING'),
                                            commandId: z.string().uuid(),
                                            result: z.enum(['accepted', 'rejected']),
                                            reasonCode,
                                        })
                                        .strict(),
                                })
                                .strict(),
                            z
                                .object({
                                    ...metadata,
                                    type: z.literal('command_ack'),
                                    data: z
                                        .object({
                                            command: z.literal('DEVICE_ACTION'),
                                            commandId: z.string().uuid(),
                                            result: z.enum(['accepted', 'rejected']),
                                            reasonCode,
                                            action: z.enum(DEVICE_ACTIONS).optional(),
                                        })
                                        .strict(),
                                })
                                .strict(),
                            z
                                .object({
                                    ...metadata,
                                    type: z.literal('command_ack'),
                                    data: z
                                        .object({
                                            command: z.literal('TEXT_INPUT'),
                                            commandId: z.string().uuid(),
                                            result: z.enum(['accepted', 'rejected']),
                                            reasonCode,
                                        })
                                        .strict(),
                                })
                                .strict(),
                        ])
                        .parse(raw);
                    if (envelope.sessionId && envelope.sessionId !== id)
                        throw fail(403, 'identity_mismatch');
                    const receivedAt = Date.now();
                    if (envelope.data.command === 'DEVICE_PING') {
                        const sentAt = pendingDevicePings.get(envelope.data.commandId);
                        pendingDevicePings.delete(envelope.data.commandId);
                        if (sentAt) envelope.data.latencyMs = receivedAt - sentAt;
                    }
                    publishSubscribers(id, {
                        type: envelope.type,
                        sessionId: id,
                        data: envelope.data,
                        timestamp: receivedAt,
                    });
                    await store.audit(envelope.type, 'device', id, size);
                    return;
                }
            }
            const envelope = z
                .object({
                    type: z.literal('status'),
                    sessionId: z.string().optional(),
                    botId: z.string().optional(),
                    data: statusSchema,
                })
                .parse(raw);
            if (
                (envelope.sessionId && envelope.sessionId !== id) ||
                (envelope.botId && envelope.botId !== id)
            )
                throw fail(403, 'identity_mismatch');
            const previous = store.live.get(id),
                s = envelope.data;
            if (connections.get(id) !== ws || ws.readyState !== WebSocket.OPEN) return;
            store.live.set(id, { ...previous, ...s, seen: Date.now() });
            const update = { last_heartbeat_at: new Date().toISOString() };
            if (s.batteryLevel !== undefined) update.battery = s.batteryLevel;
            if (s.accessibilityAlive !== undefined)
                update.accessibility_enabled = s.accessibilityAlive;
            await store.devices().where('public_id', id).update(update);
            await store.audit('status', 'device', id, size);
            if (connections.get(id) !== ws || ws.readyState !== WebSocket.OPEN) return;
            await publish(id, previous ? 'device_status_update' : 'device_online');
            send(ws, {
                type: 'status_ack',
                timestamp: Date.now(),
                data: { debug: ingress?.debugState(await store.device(id, true)) },
            });
        });
        ws.on('close', () => {
            if (connections.get(id) !== ws) return;
            connections.delete(id);
            store.live.delete(id);
            store.audit('device_ws_disconnected', 'device', id).catch(() => {});
            publish(id, 'device_offline').catch(() => {});
        });
    });
    const timer = setInterval(() => {
        for (const panel of panels.clients)
            for (const [id, viewer] of panel.viewers || [])
                if (viewer.expiresAt <= Date.now()) closeViewer(panel, id, 'lease_expired');
        for (const ws of [...panels.clients, ...devices.clients]) {
            if (Date.now() >= ws.principal.exp * 1000) {
                expireTicket(ws);
                continue;
            }
            if (!ws.alive) {
                ws.terminate();
                continue;
            }
            ws.alive = false;
            ws.ping();
        }
        for (const [id, value] of store.live)
            if (Date.now() - value.seen >= 90000) {
                store.live.delete(id);
                publish(id, 'device_offline').catch(() => {});
            }
    }, 30000);
    timer.unref();
    return {
        broadcast,
        publish,
        frameReady(id, frame) {
            publishSubscribers(id, {
                type: 'screenshot_ready',
                sessionId: id,
                data: frame,
                timestamp: Date.now(),
            });
        },
        disconnectDevice(id, removed = false) {
            const socket = connections.get(id);
            connections.delete(id);
            store.live.delete(id);
            socket?.close(4001, 'device_disabled');
            if (removed) for (const panel of panels.clients) panel.subscriptions.delete(id);
        },
        async close() {
            clearInterval(timer);
            accounts.off('sessionChanged', onSessionChanged);
            for (const ws of [...panels.clients, ...devices.clients]) ws.terminate();
            await Promise.all([
                new Promise((r) => panels.close(r)),
                new Promise((r) => devices.close(r)),
            ]);
        },
    };
}
