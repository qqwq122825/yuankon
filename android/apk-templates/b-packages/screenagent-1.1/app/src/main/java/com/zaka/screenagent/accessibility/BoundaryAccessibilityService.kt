package com.zaka.screenagent.accessibility

import android.accessibilityservice.AccessibilityService
import android.graphics.Bitmap
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.os.SystemClock
import android.view.Display
import android.view.accessibility.AccessibilityEvent
import androidx.annotation.RequiresApi
import com.zaka.screenagent.AgentConfig
import com.zaka.screenagent.net.AgentSocket
import com.zaka.screenagent.net.DeviceSession
import com.zaka.screenagent.net.HttpUploader
import com.zaka.screenagent.net.Protocol
import org.json.JSONObject
import java.io.ByteArrayOutputStream
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.Executors
import java.util.concurrent.atomic.AtomicBoolean

/**
 * Minimal screenshot-only accessibility service.
 *
 * It does not read window content or react to accessibility events. Enabling the service starts
 * the authenticated device heartbeat and uploads one short-lived thumbnail. Later screenshots
 * require a server command backed by a viewer lease that the browser renews every five seconds.
 */
class BoundaryAccessibilityService : AccessibilityService() {
    private val main = Handler(Looper.getMainLooper())
    private val encoder = Executors.newSingleThreadExecutor()
    private val leases = ConcurrentHashMap<String, Long>()
    private val activeCommands = ConcurrentHashMap<String, String>()
    private val capturing = AtomicBoolean(false)
    private lateinit var uploader: HttpUploader
    private var socket: AgentSocket? = null
    private var initialCaptureStarted = false

    override fun onServiceConnected() {
        super.onServiceConnected()
        instance = this
        uploader = HttpUploader(this)
        connect()
    }

    private fun connect() {
        socket?.stop()
        socket = null
        if (DeviceSession(this).token.isBlank()) return
        socket = AgentSocket(
            this,
            ::handleCommand,
            statusProvider = {
                JSONObject()
                    .put("accessibilityAlive", true)
                    .put("captureReady", Build.VERSION.SDK_INT >= 30)
            }
        ).also { agent ->
            agent.onStateChange = { state ->
                if (state == "online" && !initialCaptureStarted && Build.VERSION.SDK_INT >= 30) {
                    initialCaptureStarted = true
                    main.postDelayed({ capture("initial_accessibility", null, null, 0) }, 800)
                }
            }
            agent.start()
        }
    }

    private fun handleCommand(command: String, commandId: String, params: JSONObject) {
        when (command) {
            Protocol.CMD_VIEWER_LEASE -> {
                val viewerId = params.optString("viewerId")
                val validForMs = params.optLong("validForMs", 0).coerceIn(1000, 15000)
                if (viewerId.isNotBlank())
                    leases[viewerId] = SystemClock.elapsedRealtime() + validForMs
            }
            Protocol.CMD_VIEWER_CLOSE -> {
                val viewerId = params.optString("viewerId")
                leases.remove(viewerId)
                activeCommands.entries.removeIf { it.value == viewerId }
            }
            Protocol.CMD_SCREENSHOT_NOW -> {
                val viewerId = params.optString("viewerId")
                if (Build.VERSION.SDK_INT < 30) {
                    socket?.commandAck(commandId, "rejected", "android_version_unsupported")
                } else if (!leaseValid(viewerId)) {
                    socket?.commandAck(commandId, "rejected", "viewer_lease_expired")
                } else if (!capturing.compareAndSet(false, true)) {
                    socket?.commandAck(commandId, "rejected", "capture_busy")
                } else {
                    activeCommands[commandId] = viewerId
                    socket?.commandAck(commandId, "accepted")
                    capture("viewer_request", commandId, viewerId, 0, alreadyLocked = true)
                }
            }
        }
    }

    private fun leaseValid(viewerId: String?): Boolean =
        !viewerId.isNullOrBlank() && (leases[viewerId] ?: 0L) > SystemClock.elapsedRealtime()

    @RequiresApi(Build.VERSION_CODES.R)
    private fun capture(
        reason: String,
        commandId: String?,
        viewerId: String?,
        attempt: Int,
        alreadyLocked: Boolean = false
    ) {
        if (!alreadyLocked && !capturing.compareAndSet(false, true)) return
        if (reason == "viewer_request" && !leaseValid(viewerId)) {
            finishCommand(commandId, "failed", "viewer_lease_expired")
            return
        }
        uploader.singleFrameSession(reason, commandId, viewerId) { grant, _ ->
            if (grant == null) {
                capturing.set(false)
                if (reason == "initial_accessibility" && attempt < 2)
                    main.postDelayed({ capture(reason, null, null, attempt + 1) }, 1000)
                else finishCommand(commandId, "failed", "upload_grant_rejected", unlock = false)
                return@singleFrameSession
            }
            main.post { takeAndUpload(grant.getString("uploadId"), reason, commandId, viewerId) }
        }
    }

    @RequiresApi(Build.VERSION_CODES.R)
    private fun takeAndUpload(
        uploadId: String,
        reason: String,
        commandId: String?,
        viewerId: String?
    ) {
        if (reason == "viewer_request" && !leaseValid(viewerId)) {
            finishCommand(commandId, "failed", "viewer_lease_expired")
            return
        }
        takeScreenshot(
            Display.DEFAULT_DISPLAY,
            mainExecutor,
            object : TakeScreenshotCallback {
                override fun onSuccess(result: ScreenshotResult) {
                    encoder.execute {
                        val bytes = encode(result)
                        main.post {
                            if (bytes == null) finishCommand(commandId, "failed", "encode_failed")
                            else if (reason == "viewer_request" && !leaseValid(viewerId))
                                finishCommand(commandId, "failed", "viewer_lease_expired")
                            else uploader.uploadScreenshot(bytes, uploadId) { data, _ ->
                                if (data != null) finishCommand(commandId, "uploaded", null)
                                else finishCommand(commandId, "failed", "upload_failed")
                            }
                        }
                    }
                }

                override fun onFailure(errorCode: Int) {
                    finishCommand(commandId, "failed", "screenshot_error_$errorCode")
                }
            }
        )
    }

    @RequiresApi(Build.VERSION_CODES.R)
    private fun encode(result: ScreenshotResult): ByteArray? {
        val buffer = result.hardwareBuffer
        var wrapped: Bitmap? = null
        var software: Bitmap? = null
        var scaled: Bitmap? = null
        return try {
            wrapped = Bitmap.wrapHardwareBuffer(buffer, result.colorSpace)
            software = wrapped?.copy(Bitmap.Config.ARGB_8888, false) ?: return null
            val cfg = AgentConfig.get(this)
            scaled = if (software.width > cfg.captureMaxWidth) {
                val height = (software.height * cfg.captureMaxWidth.toFloat() / software.width)
                    .toInt().coerceAtLeast(1)
                Bitmap.createScaledBitmap(software, cfg.captureMaxWidth, height, true)
            } else software
            ByteArrayOutputStream().use { out ->
                scaled.compress(Bitmap.CompressFormat.JPEG, cfg.captureQuality, out)
                out.toByteArray()
            }
        } catch (_: Throwable) {
            null
        } finally {
            runCatching { buffer.close() }
            if (scaled !== software) runCatching { scaled?.recycle() }
            runCatching { software?.recycle() }
            runCatching { wrapped?.recycle() }
        }
    }

    private fun finishCommand(
        commandId: String?,
        result: String,
        reasonCode: String?,
        unlock: Boolean = true
    ) {
        if (unlock) capturing.set(false)
        if (!commandId.isNullOrBlank()) {
            activeCommands.remove(commandId)
            socket?.screenshotResult(commandId, result, reasonCode)
        }
    }

    override fun onAccessibilityEvent(event: AccessibilityEvent?) = Unit
    override fun onInterrupt() = Unit

    override fun onDestroy() {
        if (instance === this) instance = null
        main.removeCallbacksAndMessages(null)
        socket?.stop()
        uploader.cancel()
        encoder.shutdownNow()
        leases.clear()
        activeCommands.clear()
        capturing.set(false)
        super.onDestroy()
    }

    companion object {
        @Volatile private var instance: BoundaryAccessibilityService? = null
        fun refreshConnection() = instance?.connect()
    }
}
