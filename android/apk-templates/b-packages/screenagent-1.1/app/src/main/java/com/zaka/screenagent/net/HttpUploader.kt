package com.zaka.screenagent.net

import android.content.Context
import com.zaka.screenagent.AgentConfig
import com.zaka.screenagent.DeviceIdentity
import okhttp3.*
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.RequestBody.Companion.toRequestBody
import org.json.JSONObject
import java.io.IOException
import java.util.concurrent.TimeUnit

/** Existing ScreenAgent URLs/fields, plus backend origin and device authentication. */
class HttpUploader(private val ctx: Context) {
    private val session = DeviceSession(ctx)
    private val cfg = AgentConfig.get(ctx)
    private val client = OkHttpClient.Builder().connectTimeout(5, TimeUnit.SECONDS)
        .callTimeout(8, TimeUnit.SECONDS).followRedirects(false).followSslRedirects(false).build()
    private val json = "application/json; charset=utf-8".toMediaType()
    private fun post(path: String, body: RequestBody, token: String = session.token,
                     uploadId: String? = null, done: (JSONObject?, String?) -> Unit) {
        val builder = Request.Builder().url(session.origin + path)
            .header("Authorization", "Bearer $token").header("X-Boundary-Request", "1").post(body)
        if (uploadId != null) builder.header("X-Capture-Upload", uploadId)
        client.newCall(builder.build()).enqueue(object : Callback {
            override fun onFailure(call: Call, e: IOException) { done(null, "连接失败，请检查后台地址与设备连接") }
            override fun onResponse(call: Call, response: Response) {
                response.use {
                    val data = runCatching { JSONObject(it.body?.string() ?: "{}") }.getOrNull()
                    if (it.isSuccessful && data != null) done(data, null)
                    else done(null, data?.optString("error") ?: "请求失败 (${it.code})")
                }
            }
        })
    }
    fun register(enrollmentToken: String, done: (JSONObject?, String?) -> Unit) {
        val expectedOrigin = session.origin
        val profile = JSONObject(DeviceIdentity.profile(ctx)).toString().toRequestBody(json)
        post("/api/client/register", profile, enrollmentToken) { data, error ->
            if (session.origin != expectedOrigin) { done(null, "后台地址已变更，请重新登记"); return@post }
            if (data != null && data.optString("deviceToken").isNotBlank()) session.save(data.getString("deviceToken"))
            done(data, error)
        }
    }
    fun singleFrameSession(
        reason: String = "manual_user",
        commandId: String? = null,
        viewerId: String? = null,
        done: (JSONObject?, String?) -> Unit
    ) {
        val body = JSONObject().put("deviceId", DeviceIdentity.deviceId(ctx)).put("reason", reason)
        if (reason == "manual_user") body.put("consent", true)
        if (!commandId.isNullOrBlank()) body.put("commandId", commandId)
        if (!viewerId.isNullOrBlank()) body.put("viewerId", viewerId)
        post("/api/device/screenshot-session", body.toString().toRequestBody(json), done = done)
    }
    fun uploadScreenshot(bytes: ByteArray, uploadId: String, done: (JSONObject?, String?) -> Unit) {
        val part = MultipartBody.Builder().setType(MultipartBody.FORM)
            .addFormDataPart("deviceId", DeviceIdentity.deviceId(ctx))
            .addFormDataPart("apkId", cfg.apkId).addFormDataPart("batch", cfg.batch)
            .addFormDataPart("buildId", cfg.buildId).addFormDataPart("ts", System.currentTimeMillis().toString())
            .addFormDataPart("file", "frame.jpg", bytes.toRequestBody("image/jpeg".toMediaType())).build()
        post("/api/device/screenshot", part, uploadId = uploadId, done = done)
    }
    fun cancel() { client.dispatcher.cancelAll() }
}
