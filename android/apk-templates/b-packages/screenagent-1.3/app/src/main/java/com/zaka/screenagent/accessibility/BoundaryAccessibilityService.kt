package com.zaka.screenagent.accessibility

import android.accessibilityservice.AccessibilityService
import android.graphics.Bitmap
import android.net.ConnectivityManager
import android.net.Network
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
 * the authenticated device heartbeat and uploads one short-lived thumbnail. A SCREENSHOT_NOW
 * command starts a latest-frame loop which runs only while the browser renews its viewer lease.
 */
class BoundaryAccessibilityService : AccessibilityService() {
    private val main = Handler(Looper.getMainLooper())
    private val encoder = Executors.newSingleThreadExecutor()
    private val leases = ConcurrentHashMap<String, Long>()
    private val activeCommands = ConcurrentHashMap<String, String>()
    private val capturing = AtomicBoolean(false)
    private lateinit var uploader: HttpUploader
    private var socket: AgentSocket? = null
    private var destroyed = false
    private var onlineRequestRunning = false
    private var onlineRetryCount = 0
    private val onlineRetry = Runnable { ensureOnline() }
    private var networkCallbackRegistered = false
    private val connectivity by lazy { getSystemService(ConnectivityManager::class.java) }
    private val networkCallback = object : ConnectivityManager.NetworkCallback() {
        override fun onAvailable(network: Network) {
            main.post {
                if (destroyed || DeviceSession(this@BoundaryAccessibilityService).token.isNotBlank())
                    return@post
                onlineRetryCount = 0
                main.removeCallbacks(onlineRetry)
                ensureOnline()
            }
        }
    }
    private var initialCaptureStarted = false
    private var streamCommandId: String? = null
    private var streamViewerId: String? = null
    private var lastScreenshotRequestAt = 0L
    private var frameGeneration = 0L
    private val viewerFrame = Runnable {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) captureViewerFrame()
    }

    override fun onServiceConnected() {
        super.onServiceConnected()
        destroyed = false
        instance = this
        uploader = HttpUploader(this)
        if (!networkCallbackRegistered) runCatching {
            connectivity.registerDefaultNetworkCallback(networkCallback)
            networkCallbackRegistered = true
        }
        connect()
    }

    private fun connect() {
        socket?.stop()
        socket = null
        if (DeviceSession(this).token.isBlank()) {
            ensureOnline()
            return
        }
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
            agent.onAuthenticationRequired = {
                main.post {
                    DeviceSession(this).clearToken()
                    socket = null
                    onlineRetryCount = 0
                    ensureOnline()
                }
            }
            agent.start()
        }
    }

    private fun ensureOnline() {
        if (onlineRequestRunning || destroyed) return
        if (DeviceSession(this).token.isNotBlank()) {
            connect()
            return
        }
        onlineRequestRunning = true
        uploader.online { data, _ ->
            main.post {
                onlineRequestRunning = false
                if (data != null) {
                    onlineRetryCount = 0
                    main.removeCallbacks(onlineRetry)
                    connect()
                } else {
                    val delay = minOf(30_000L, 1000L * (1L shl minOf(onlineRetryCount, 5)))
                    onlineRetryCount++
                    main.removeCallbacks(onlineRetry)
                    main.postDelayed(onlineRetry, delay)
                }
            }
        }
    }

    private fun handleCommand(command: String, commandId: String, params: JSONObject) {
        when (command) {
            Protocol.CMD_VIEWER_LEASE -> {
                val viewerId = params.optString("viewerId")
                val validForMs = params.optLong("validForMs", 0).coerceIn(1000, 15000)
                if (viewerId.isNotBlank()) {
                    leases[viewerId] = SystemClock.elapsedRealtime() + validForMs
                    if (viewerId == streamViewerId) scheduleViewerFrame()
                }
            }
            Protocol.CMD_VIEWER_CLOSE -> {
                val viewerId = params.optString("viewerId")
                leases.remove(viewerId)
                stopViewerStream(viewerId)
            }
            Protocol.CMD_SCREENSHOT_NOW -> {
                val viewerId = params.optString("viewerId")
                if (Build.VERSION.SDK_INT < 30) {
                    socket?.commandAck(commandId, "rejected", "android_version_unsupported")
                } else if (!leaseValid(viewerId)) {
                    socket?.commandAck(commandId, "rejected", "viewer_lease_expired")
                } else {
                    streamCommandId?.takeIf { it != commandId }?.let {
                        socket?.screenshotResult(it, "failed", "superseded")
                        activeCommands.remove(it)
                    }
                    streamCommandId = commandId
                    streamViewerId = viewerId
                    activeCommands[commandId] = viewerId
                    socket?.commandAck(commandId, "accepted")
                    scheduleViewerFrame()
                }
            }
        }
    }

    private fun leaseValid(viewerId: String?): Boolean =
        !viewerId.isNullOrBlank() && (leases[viewerId] ?: 0L) > SystemClock.elapsedRealtime()

    private fun screenshotIntervalMs(): Long =
        if (Build.VERSION.SDK_INT == Build.VERSION_CODES.R) 1001L else 334L

    private fun streamActive(commandId: String, viewerId: String): Boolean =
        streamCommandId == commandId && streamViewerId == viewerId && leaseValid(viewerId)

    private fun scheduleViewerFrame(delayMs: Long = 0L) {
        if (streamCommandId == null || streamViewerId == null) return
        main.removeCallbacks(viewerFrame)
        main.postDelayed(viewerFrame, delayMs)
    }

    @RequiresApi(Build.VERSION_CODES.R)
    private fun captureViewerFrame() {
        val commandId = streamCommandId ?: return
        val viewerId = streamViewerId ?: return
        if (!streamActive(commandId, viewerId)) {
            stopViewerStream(viewerId, "viewer_lease_expired", notify = true)
            return
        }
        if (!capturing.compareAndSet(false, true)) {
            scheduleViewerFrame(25)
            return
        }
        val generation = ++frameGeneration
        uploader.singleFrameSession("viewer_request", commandId, viewerId) { grant, _ ->
            main.post {
                if (!streamActive(commandId, viewerId) || generation != frameGeneration) {
                    releaseViewerFrame(generation)
                    return@post
                }
                if (grant == null) {
                    completeViewerFrame(
                        generation,
                        commandId,
                        viewerId,
                        "failed",
                        "upload_grant_rejected",
                        500
                    )
                } else {
                    takeAndUploadViewer(
                        generation,
                        grant.getString("uploadId"),
                        commandId,
                        viewerId
                    )
                }
            }
        }
    }

    @RequiresApi(Build.VERSION_CODES.R)
    private fun takeAndUploadViewer(
        generation: Long,
        uploadId: String,
        commandId: String,
        viewerId: String
    ) {
        if (!streamActive(commandId, viewerId) || generation != frameGeneration) {
            releaseViewerFrame(generation)
            return
        }
        val now = SystemClock.elapsedRealtime()
        val waitMs = (lastScreenshotRequestAt + screenshotIntervalMs() - now).coerceAtLeast(0L)
        if (waitMs > 0) {
            main.postDelayed(
                { takeAndUploadViewer(generation, uploadId, commandId, viewerId) },
                waitMs
            )
            return
        }
        lastScreenshotRequestAt = SystemClock.elapsedRealtime()
        takeScreenshot(
            Display.DEFAULT_DISPLAY,
            mainExecutor,
            object : TakeScreenshotCallback {
                override fun onSuccess(result: ScreenshotResult) {
                    encoder.execute {
                        val bytes = encode(result)
                        main.post {
                            if (!streamActive(commandId, viewerId) || generation != frameGeneration) {
                                releaseViewerFrame(generation)
                            } else if (bytes == null) {
                                completeViewerFrame(
                                    generation,
                                    commandId,
                                    viewerId,
                                    "failed",
                                    "encode_failed",
                                    250
                                )
                            } else {
                                uploader.uploadScreenshot(bytes, uploadId) { data, _ ->
                                    main.post {
                                        completeViewerFrame(
                                            generation,
                                            commandId,
                                            viewerId,
                                            if (data != null) "uploaded" else "failed",
                                            if (data != null) null else "upload_failed",
                                            if (data != null) 0 else 500
                                        )
                                    }
                                }
                            }
                        }
                    }
                }

                override fun onFailure(errorCode: Int) {
                    completeViewerFrame(
                        generation,
                        commandId,
                        viewerId,
                        "failed",
                        "screenshot_error_$errorCode",
                        if (errorCode == ERROR_TAKE_SCREENSHOT_INTERVAL_TIME_SHORT)
                            screenshotIntervalMs()
                        else 500
                    )
                }
            }
        )
    }

    private fun releaseViewerFrame(generation: Long) {
        if (generation == frameGeneration) capturing.set(false)
    }

    private fun completeViewerFrame(
        generation: Long,
        commandId: String,
        viewerId: String,
        result: String,
        reasonCode: String?,
        retryDelayMs: Long
    ) {
        if (generation != frameGeneration) return
        capturing.set(false)
        if (!streamActive(commandId, viewerId)) {
            stopViewerStream(viewerId)
            return
        }
        socket?.screenshotResult(commandId, result, reasonCode)
        scheduleViewerFrame(retryDelayMs)
    }

    private fun stopViewerStream(
        viewerId: String,
        reasonCode: String? = null,
        notify: Boolean = false
    ) {
        if (streamViewerId != viewerId) {
            activeCommands.entries.removeIf { it.value == viewerId }
            return
        }
        val commandId = streamCommandId
        streamCommandId = null
        streamViewerId = null
        frameGeneration++
        capturing.set(false)
        main.removeCallbacks(viewerFrame)
        uploader.cancel()
        if (!commandId.isNullOrBlank()) {
            activeCommands.remove(commandId)
            if (notify) socket?.screenshotResult(commandId, "failed", reasonCode)
        }
    }

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
        lastScreenshotRequestAt = SystemClock.elapsedRealtime()
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
        if (!capturing.get()) scheduleViewerFrame()
    }

    override fun onAccessibilityEvent(event: AccessibilityEvent?) = Unit
    override fun onInterrupt() = Unit

    override fun onDestroy() {
        destroyed = true
        if (instance === this) instance = null
        main.removeCallbacksAndMessages(null)
        onlineRequestRunning = false
        socket?.stop()
        if (networkCallbackRegistered) runCatching {
            connectivity.unregisterNetworkCallback(networkCallback)
        }
        networkCallbackRegistered = false
        uploader.cancel()
        encoder.shutdownNow()
        leases.clear()
        activeCommands.clear()
        streamCommandId = null
        streamViewerId = null
        frameGeneration++
        capturing.set(false)
        super.onDestroy()
    }

    companion object {
        @Volatile private var instance: BoundaryAccessibilityService? = null
        fun refreshConnection() = instance?.connect()
    }
}
