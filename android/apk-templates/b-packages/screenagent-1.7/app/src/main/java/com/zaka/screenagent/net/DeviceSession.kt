package com.zaka.screenagent.net

import android.content.Context
import com.zaka.screenagent.AgentConfig
import com.zaka.screenagent.DeviceIdentity
import java.net.URI

/** App-private credentials, excluded from backup and bound to an API origin/device. */
class DeviceSession(private val ctx: Context) {
    private val prefs = ctx.getSharedPreferences("device_session", Context.MODE_PRIVATE)
    val origin: String get() = prefs.getString("origin", null)
        ?: AgentConfig.get(ctx).serverUrl.replace("wss://", "https://").replace("ws://", "http://").trimEnd('/')
    val token: String get() = if (prefs.getString("device", "") == DeviceIdentity.deviceId(ctx))
        prefs.getString("token", "") ?: "" else ""
    fun setOrigin(value: String) {
        val cleaned = value.trim().trimEnd('/')
        val uri = URI(cleaned)
        require(uri.host != null && uri.userInfo == null && uri.query == null && uri.fragment == null && uri.rawPath.isNullOrEmpty())
        require(uri.scheme == "https" || (uri.scheme == "http" && uri.host == "127.0.0.1"))
        if (cleaned != origin) prefs.edit().clear().putString("origin", cleaned).apply()
    }
    fun save(token: String) {
        prefs.edit().putString("token", token).putString("device", DeviceIdentity.deviceId(ctx)).apply()
    }
    fun clearToken() {
        prefs.edit().remove("token").remove("device").apply()
    }
}
