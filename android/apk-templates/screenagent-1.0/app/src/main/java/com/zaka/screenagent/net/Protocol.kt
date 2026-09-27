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

    // ---------- 上行类型 ----------
    const val UP_REGISTER = "register"
    const val UP_PING = "device_ping"
    const val UP_STATUS = "status"
    const val UP_SCREENSHOT_META = "screenshot"
    const val UP_COMMAND_ACK = "command_ack"
    const val UP_EVENT = "event"

    // ---------- 下行指令（本模板只实现截图相关）----------
    const val CMD_PING = "PING"
    const val CMD_SCREENSHOT_NOW = "SCREENSHOT_NOW"      // 立即抓一帧并回传
    const val CMD_START_CAPTURE = "START_CAPTURE"        // 开启定时抓帧
    const val CMD_STOP_CAPTURE = "STOP_CAPTURE"          // 停止定时抓帧
    const val CMD_UPDATE_CONFIG = "UPDATE_CAPTURE_CONFIG" // 动态改间隔/画质
    const val CMD_SCREEN_INFO = "GET_SCREEN_INFO"        // 回传分辨率/亮度等

    fun envelope(
        type: String,
        sessionId: String,
        apkId: String,
        data: JSONObject? = null
    ): String {
        val j = JSONObject()
        j.put("type", type)
        j.put("sessionId", sessionId)
        j.put("apkId", apkId)
        j.put("timestamp", System.currentTimeMillis())
        if (data != null) j.put("data", data)
        return j.toString()
    }
}
