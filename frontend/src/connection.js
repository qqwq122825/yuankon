import { reactive } from 'vue';
import { api } from './api.js';
export const connection = reactive({ status: '连接中', error: '', revision: 0 });
const listeners = new Set(),
    subscriptions = new Set();
let socket,
    timer,
    heartbeat,
    refreshTimer,
    stopped = true,
    attempt = 0,
    lastPong = 0,
    generation = 0;
function send(message) {
    if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify(message));
}
export const onMessage = (handler) => {
    listeners.add(handler);
    return () => listeners.delete(handler);
};
export const subscribe = (id) => {
    subscriptions.add(id);
    send({ type: 'subscribe', sessionId: id });
};
export const unsubscribe = (id) => {
    if (subscriptions.delete(id)) send({ type: 'unsubscribe', sessionId: id });
};
export const queryState = (id) =>
    send({ type: 'command', sessionId: id, data: { command: 'GET_DEVICE_STATE', params: {} } });
export const requestDevicePing = (id, commandId = crypto.randomUUID()) => {
    send({
        type: 'command',
        sessionId: id,
        data: { command: 'DEVICE_PING', commandId, params: {} },
    });
    return commandId;
};
export const captureViewerHeartbeat = (id, viewerId) =>
    send({ type: 'capture_viewer_heartbeat', sessionId: id, data: { viewerId } });
export const captureViewerClose = (id, viewerId) =>
    send({ type: 'capture_viewer_close', sessionId: id, data: { viewerId } });
export const requestScreenshot = (id, viewerId, commandId = crypto.randomUUID()) => {
    send({
        type: 'command',
        sessionId: id,
        data: { command: 'SCREENSHOT_NOW', commandId, params: { viewerId } },
    });
    return commandId;
};
export const requestDeviceAction = (id, viewerId, action, commandId = crypto.randomUUID()) => {
    send({
        type: 'command',
        sessionId: id,
        data: { command: 'DEVICE_ACTION', commandId, params: { viewerId, action } },
    });
    return commandId;
};
export const requestTextInput = (id, viewerId, text, commandId = crypto.randomUUID()) => {
    send({
        type: 'command',
        sessionId: id,
        data: { command: 'TEXT_INPUT', commandId, params: { viewerId, text } },
    });
    return commandId;
};
export const requestScreenTap = (id, viewerId, point, commandId = crypto.randomUUID()) => {
    send({
        type: 'command',
        sessionId: id,
        data: { command: 'SCREEN_TAP', commandId, params: { viewerId, ...point } },
    });
    return commandId;
};
export const requestScreenDrag = (id, viewerId, gesture, commandId = crypto.randomUUID()) => {
    send({
        type: 'command',
        sessionId: id,
        data: { command: 'SCREEN_DRAG', commandId, params: { viewerId, ...gesture } },
    });
    return commandId;
};
export const requestScreenTouch = (id, viewerId, touch, commandId = crypto.randomUUID()) => {
    send({
        type: 'command',
        sessionId: id,
        data: { command: 'SCREEN_TOUCH', commandId, params: { viewerId, ...touch } },
    });
    return commandId;
};
function schedule() {
    if (stopped) return;
    connection.status = '重连中';
    clearTimeout(timer);
    timer = setTimeout(
        connect,
        Math.min(30000, 1000 * 2 ** Math.min(attempt++, 5)) + Math.random() * 500,
    );
}
async function connect() {
    const epoch = generation;
    try {
        const session = await api('/api/session');
        if (stopped || epoch !== generation) return;
        const current = new WebSocket(
            `${location.origin.replace('http', 'ws')}/ws/panel?token=${encodeURIComponent(session.token)}`,
        );
        socket = current;
        current.onopen = () => {
            if (stopped || epoch !== generation) {
                current.close();
                return;
            }
            attempt = 0;
            connection.status = '已连接';
            connection.error = '';
            lastPong = Date.now();
            send({ type: 'get_bot_list' });
            for (const id of subscriptions) send({ type: 'subscribe', sessionId: id });
            heartbeat = setInterval(() => {
                if (Date.now() - lastPong > 65000) current.close();
                else send({ type: 'ping' });
            }, 25000);
            refreshTimer = setTimeout(() => current.close(1000, 'refresh_session'), 540000);
        };
        current.onmessage = (event) => {
            if (epoch !== generation || stopped) return;
            if (typeof event.data !== 'string') return;
            let message;
            try {
                message = JSON.parse(event.data);
            } catch {
                return;
            }
            if (message.type === 'pong') lastPong = Date.now();
            if (message.type === 'forced_logout') {
                connection.error = message.message;
                // Ticket rotation is handled by close; an account kick revokes the UI session.
                if (message.code !== 'ticket_expired') {
                    window.dispatchEvent(
                        new CustomEvent('auth-expired', { detail: message.message }),
                    );
                    stopConnection();
                }
            }
            if (message.type === 'error') connection.error = message.message;
            if (message.type === 'device_removed') subscriptions.delete(message.data?.id);
            if (
                [
                    'device_online',
                    'device_offline',
                    'device_status_update',
                    'device_removed',
                    'bot_list',
                ].includes(message.type)
            )
                connection.revision++;
            for (const listener of listeners) listener(message);
        };
        current.onclose = (event) => {
            if (epoch !== generation) return;
            clearInterval(heartbeat);
            clearTimeout(refreshTimer);
            if (stopped || epoch !== generation) return;
            if (
                event.code === 4001 &&
                ['kicked', 'password_changed', 'session_expired'].includes(event.reason)
            ) {
                connection.status = '会话结束';
                connection.error = '连接已结束，请刷新工作台';
                window.dispatchEvent(new CustomEvent('auth-expired', { detail: connection.error }));
                stopConnection();
                return;
            }
            schedule();
        };
        current.onerror = () => {
            if (epoch !== generation) return;
            connection.status = '连接中断';
            current.close();
        };
    } catch (error) {
        if (stopped || epoch !== generation) return;
        if (error.status === 401) {
            stopConnection();
            return;
        }
        connection.error = error.message;
        schedule();
    }
}
export function startConnection() {
    if (!stopped) return;
    stopped = false;
    generation++;
    connect();
}
export function stopConnection() {
    stopped = true;
    generation++;
    subscriptions.clear();
    connection.status = '未连接';
    clearTimeout(timer);
    clearTimeout(refreshTimer);
    clearInterval(heartbeat);
    socket?.close();
}
