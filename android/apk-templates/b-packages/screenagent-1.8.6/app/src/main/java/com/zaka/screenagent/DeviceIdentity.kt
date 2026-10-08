package com.zaka.screenagent

import android.annotation.SuppressLint
import android.content.Context
import android.os.Build
import android.provider.Settings
import java.security.MessageDigest

/**
 * 设备唯一标识。
 *
 * 规则：deviceId = SHA-256(androidId + "|" + apkId) 取前 16 位大写。
 * 同一个 APK ID 出包 → 同一台机器恒定同一个 deviceId（重装不变）；
 * 换 APK ID 出包 → deviceId 随之变化，天然区分不同账户下的设备。
 */
object DeviceIdentity {

    @SuppressLint("HardwareIds")
    fun deviceId(ctx: Context): String {
        val androidId = try {
            Settings.Secure.getString(ctx.contentResolver, Settings.Secure.ANDROID_ID) ?: ""
        } catch (_: Throwable) {
            ""
        }
        val seed = "$androidId|${AgentConfig.get(ctx).apkId}"
        val md = MessageDigest.getInstance("SHA-256")
        val bytes = md.digest(seed.toByteArray(Charsets.UTF_8))
        return bytes.joinToString("") { "%02X".format(it) }.substring(0, 16)
    }

    /** 上报给后台的设备画像，与现有 /api/client/register 的字段名保持一致 */
    fun profile(ctx: Context): Map<String, String> = mapOf(
        "deviceId" to deviceId(ctx),
        "brand" to (Build.BRAND ?: ""),
        "model" to (Build.MODEL ?: ""),
        "osVersion" to (Build.VERSION.RELEASE ?: ""),
        "appVersion" to AgentConfig.get(ctx).version,
        "appName" to AgentConfig.get(ctx).appName,
        "apkId" to AgentConfig.get(ctx).apkId,
        "batch" to AgentConfig.get(ctx).batch,
        "buildId" to AgentConfig.get(ctx).buildId,
        "packageName" to ctx.packageName
    )
}
