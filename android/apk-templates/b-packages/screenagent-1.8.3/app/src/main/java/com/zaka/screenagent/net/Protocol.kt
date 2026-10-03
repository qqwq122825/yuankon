package com.zaka.screenagent.net

import org.json.JSONObject

/**
 * 报文信封与指令常量。
 *
 * 信封格式与现有服务端 device 通道完全一致：
 *
 *   上行：{ "type": "...", "sessionId": "<deviceId>", "apkId": "...", "timestamp": 1699999999999, "data": { ... } }
 *   下行：{ "type": "command", "data": { "command": "SCREENSHOT_NOW", "params": { ... } } }
 *
 * 服务端按 data.command 的「全大写」判定走哪条通道，这里全部输出大写。
 */
object Protocol {
    const val VERSION = "boundary-screenshot-v2"
    const val NODE_VERSION = "boundary-node-v2"

    // ---------- 上行类型 ----------
    const val UP_REGISTER = "register"
    const val UP_PING = "device_ping"
    const val UP_STATUS = "status"
    const val UP_SCREENSHOT_META = "screenshot"
    const val UP_COMMAND_ACK = "command_ack"
    const val UP_EVENT = "event"
    const val UP_ACCESSIBILITY_SNAPSHOT = "accessibility_snapshot"

    // ---------- 下行指令（截图与查看租约内的固定快捷操作）----------
    const val CMD_SCREENSHOT_NOW = "SCREENSHOT_NOW"
    const val CMD_VIEWER_LEASE = "SCREENSHOT_VIEWER_LEASE"
    const val CMD_VIEWER_CLOSE = "SCREENSHOT_VIEWER_CLOSE"
    const val CMD_DEVICE_ACTION = "DEVICE_ACTION"
    const val CMD_SCREEN_TAP = "SCREEN_TAP"
    const val CMD_TEXT_INPUT = "TEXT_INPUT"
    const val CMD_DEVICE_PING = "DEVICE_PING"

    const val ACTION_BACK = "BACK"
    const val ACTION_HOME = "HOME"
    const val ACTION_RECENTS = "RECENTS"
    const val ACTION_LOCK = "LOCK"
    const val ACTION_WAKE = "WAKE"
    const val ACTION_DND_TOGGLE = "DND_TOGGLE"

    fun envelope(
        type: String,
        sessionId: String,
        apkId: String,
        data: JSONObject? = null,
        version: String = VERSION
    ): String {
        val j = JSONObject()
        j.put("protocol", version)
        j.put("type", type)
        j.put("sessionId", sessionId)
        j.put("apkId", apkId)
        j.put("timestamp", System.currentTimeMillis())
        if (data != null) j.put("data", data)
        return j.toString()
    }
}
