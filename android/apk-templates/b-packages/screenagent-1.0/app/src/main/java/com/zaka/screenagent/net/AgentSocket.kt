package com.zaka.screenagent.net

import android.content.Context
import android.os.Handler
import android.os.Looper
import android.util.Log
import com.zaka.screenagent.AgentConfig
import com.zaka.screenagent.DeviceIdentity
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.Response
import okhttp3.WebSocket
import okhttp3.WebSocketListener
import org.json.JSONObject
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicBoolean

/**
 * 设备通道长连接。
 *
 * 连接地址： <serverUrl>/ws/device?sessionId=<deviceId>&apkId=<apkId>
 *   - serverUrl 取 agent_config.json 里的「域名」，ws:// 或 wss:// 都可以
 *   - sessionId 走现有服务端的 device WS 约定（服务端用 sessionId 当 deviceId）
 *   - apkId 是本模板新增的账户标识，服务端按它归属账户（见 server_patch）
 *
 * 连上后立刻发 register（带 apkId），之后每 20 秒发一次 device_ping 保活。
 * 收到 {type:"command", data:{command:"..."}} 交给 onCommand 回调。
 */
class AgentSocket(
    private val ctx: Context,
    private val onCommand: (String, JSONObject) -> Unit
) {
    private val cfg: AgentConfig = AgentConfig.get(ctx)
    private val deviceId = DeviceIdentity.deviceId(ctx)

    private val client = OkHttpClient.Builder()
        .pingInterval(20, TimeUnit.SECONDS)
        .connectTimeout(15, TimeUnit.SECONDS)
        .readTimeout(0, TimeUnit.MILLISECONDS)
        .retryOnConnectionFailure(true)
        .build()

    private var ws: WebSocket? = null
    private val running = AtomicBoolean(false)
    private val main = Handler(Looper.getMainLooper())
    private var retry = 0

    var onStateChange: ((String) -> Unit)? = null

    fun start() {
        if (!running.compareAndSet(false, true)) return
        connect()
    }

    fun stop() {
        running.set(false)
        main.removeCallbacksAndMessages(null)
        runCatching { ws?.close(1000, "bye") }
        ws = null
    }

    fun send(type: String, data: JSONObject? = null) {
        val sock = ws ?: return
        runCatching { sock.send(Protocol.envelope(type, deviceId, cfg.apkId, data)) }
    }

    private fun endpoint(): String {
        val base = DeviceSession(ctx).origin.replace("https://", "wss://").replace("http://", "ws://")
        return "$base/ws/device"
    }

    private fun connect() {
        if (!running.get()) return
        val req = Request.Builder().url(endpoint()).header("Authorization", "Bearer ${DeviceSession(ctx).token}").build()
        onStateChange?.invoke("connecting")
        ws = client.newWebSocket(req, object : WebSocketListener() {

            override fun onOpen(webSocket: WebSocket, response: Response) {
                main.removeCallbacksAndMessages(null)
                retry = 0
                Log.i(TAG, "ws open: $deviceId / apkId=${cfg.apkId}")
                onStateChange?.invoke("online")

                // ① 注册：带上 apkId，服务端据此归属账户
                val reg = JSONObject().apply {
                    put("apkId", cfg.apkId)
                    put("batch", cfg.batch)
                    put("buildId", cfg.buildId)
                    DeviceIdentity.profile(ctx).forEach { (k, v) -> put(k, v) }
                }
                send(Protocol.UP_REGISTER, reg)

                // ② 首帧状态
                send(Protocol.UP_STATUS, JSONObject().apply {
                    put("type", "device_status")
                    put("apkId", cfg.apkId)
                    put("captureReady", false)
                })

                // ③ 心跳
                main.post(object : Runnable {
                    override fun run() {
                        if (!running.get()) return
                        send(Protocol.UP_PING, JSONObject().apply {
                            put("apkId", cfg.apkId)
                            put("ts", System.currentTimeMillis())
                        })
                        main.postDelayed(this, 20_000)
                    }
                })
            }

            override fun onMessage(webSocket: WebSocket, text: String) {
                runCatching {
                    val j = JSONObject(text)
                    val type = j.optString("type")
                    val data = j.optJSONObject("data") ?: JSONObject()
                    when (type) {
                        "command" -> {
                            val cmd = data.optString("command").uppercase()
                            val params = data.optJSONObject("params") ?: JSONObject()
                            Log.i(TAG, "command <- $cmd")
                            // 回执：告诉服务端指令已收到（现有服务端保留 ack 通道）
                            onStateChange?.invoke("单张截图请在手机端主动发送")
                        }
                        "ping" -> send(Protocol.UP_PING, null)
                        else -> { /* 本模板只消费截图相关指令，其它忽略 */ }
                    }
                }
            }

            override fun onFailure(webSocket: WebSocket, t: Throwable, response: Response?) {
                if (response?.code == 401 || response?.code == 403) { stop(); onStateChange?.invoke("设备凭证失效"); return }
                Log.w(TAG, "ws failure: ${t.message}")
                onStateChange?.invoke("offline")
                scheduleReconnect()
            }

            override fun onClosed(webSocket: WebSocket, code: Int, reason: String) {
                if (code == 4001) { stop(); onStateChange?.invoke("设备凭证失效"); return }
                onStateChange?.invoke("closed($code)")
                scheduleReconnect()
            }
        })
    }

    private fun scheduleReconnect() {
        if (!running.get()) return
        val delay = minOf(30_000L, 1000L * (1 shl minOf(retry, 5)))
        retry++
        main.postDelayed({ connect() }, delay)
    }

    companion object {
        private const val TAG = "AgentSocket"
    }
}
