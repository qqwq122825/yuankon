package com.zaka.screenagent.accessibility

import android.accessibilityservice.AccessibilityService
import android.annotation.SuppressLint
import android.app.NotificationManager
import android.graphics.Bitmap
import android.graphics.Rect
import android.net.ConnectivityManager
import android.net.Network
import android.os.Build
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.os.PowerManager
import android.os.SystemClock
import android.view.Display
import android.view.accessibility.AccessibilityEvent
import android.view.accessibility.AccessibilityNodeInfo
import com.zaka.screenagent.AgentConfig
import com.zaka.screenagent.CaptureMode
import com.zaka.screenagent.capture.ProjectionCaptureService
import com.zaka.screenagent.net.AgentSocket
import com.zaka.screenagent.net.DeviceSession
import com.zaka.screenagent.net.HttpUploader
import com.zaka.screenagent.net.Protocol
import org.json.JSONArray
import org.json.JSONObject
import java.io.ByteArrayOutputStream
import java.text.SimpleDateFormat
import java.util.ArrayDeque
import java.util.Date
import java.util.Locale
import java.util.TimeZone
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.atomic.AtomicBoolean

/**
 * Device channel, structural-node preview and explicit focused-input accessibility service.
 *
 * Enabling the service starts the authenticated device heartbeat and uploads one short-lived
 * thumbnail. During an explicit browser viewer lease it can additionally publish a bounded,
 * node preview with client-reported fields, including text and descriptions when present. SCREENSHOT_NOW
 * uses the selected page mode: MediaProjection latest frame or AccessibilityService.takeScreenshot.
 * TEXT_INPUT only locates the current focused editable node after an explicit leased command;
 * node contents may be uploaded in leased node snapshots.
 * The launcher page switches capture modes and opens the Android accessibility settings.
 */
class BoundaryAccessibilityService : AccessibilityService() {
    private val main = Handler(Looper.getMainLooper())
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
    private var frameGeneration = 0L
    private var nodesDirty = true
    private var lastNodeSnapshotAt = 0L
    private var lastNodeHash: Int? = null
    private var nodeViewerId: String? = null
    private var nodeSnapshotForced = false
    private val viewerFrame = Runnable { captureViewerFrame() }
    private val nodeSnapshot = Runnable {
        val viewerId = nodeViewerId ?: return@Runnable
        val forced = nodeSnapshotForced
        nodeSnapshotForced = false
        publishNodeSnapshot(viewerId, forced)
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
                    .put("captureReady", captureReady())
                    .put("projectionActive", ProjectionCaptureService.isActive())
                    .put("captureMode", CaptureMode.get(this))
            }
        ).also { agent ->
            agent.onStateChange = { state ->
                if (
                    state == "online" &&
                    !initialCaptureStarted &&
                    ProjectionCaptureService.isActive()
                ) {
                    initialCaptureStarted = true
                    main.postDelayed({ captureInitialProjection(0) }, 800)
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
                    val existing = leaseValid(viewerId)
                    leases[viewerId] = SystemClock.elapsedRealtime() + validForMs
                    if (viewerId == streamViewerId) scheduleViewerFrame()
                    scheduleNodeSnapshot(viewerId, force = !existing)
                }
            }
            Protocol.CMD_VIEWER_CLOSE -> {
                val viewerId = params.optString("viewerId")
                leases.remove(viewerId)
                stopViewerStream(viewerId)
                if (nodeViewerId == viewerId) {
                    main.removeCallbacks(nodeSnapshot)
                    nodeViewerId = null
                    lastNodeHash = null
                    nodesDirty = true
                }
            }
            Protocol.CMD_SCREENSHOT_NOW -> {
                val viewerId = params.optString("viewerId")
                if (!captureReady()) {
                    socket?.commandAck(commandId, "rejected", captureUnavailableReason())
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
            Protocol.CMD_DEVICE_ACTION -> handleDeviceAction(
                commandId,
                params.optString("viewerId"),
                params.optString("action").uppercase()
            )
            Protocol.CMD_TEXT_INPUT -> handleTextInput(
                commandId,
                params.optString("viewerId"),
                params.optString("text")
            )
            Protocol.CMD_DEVICE_PING -> socket?.devicePingResult(commandId)
        }
    }

    private fun handleTextInput(commandId: String, viewerId: String, text: String) {
        if (!leaseValid(viewerId)) {
            socket?.textInputResult(commandId, "rejected", "viewer_lease_expired")
            return
        }
        if (text.isBlank() || text.length > 500) {
            socket?.textInputResult(commandId, "rejected", "invalid_text")
            return
        }
        val root = rootInActiveWindow
        val focused = root?.findFocus(AccessibilityNodeInfo.FOCUS_INPUT)
            ?: root?.findFocus(AccessibilityNodeInfo.FOCUS_ACCESSIBILITY)
        val reasonCode = when {
            focused == null -> "input_not_focused"
            !focused.isEditable -> "input_not_editable"
            focused.isPassword -> "sensitive_field"
            else -> {
                val arguments = Bundle().apply {
                    putCharSequence(
                        AccessibilityNodeInfo.ACTION_ARGUMENT_SET_TEXT_CHARSEQUENCE,
                        text
                    )
                }
                if (focused.performAction(AccessibilityNodeInfo.ACTION_SET_TEXT, arguments))
                    "text_set"
                else "set_text_failed"
            }
        }
        socket?.textInputResult(
            commandId,
            if (reasonCode == "text_set") "accepted" else "rejected",
            reasonCode
        )
    }

    private fun handleDeviceAction(commandId: String, viewerId: String, action: String) {
        if (!leaseValid(viewerId)) {
            socket?.deviceActionResult(
                commandId,
                action,
                "rejected",
                "viewer_lease_expired"
            )
            return
        }
        val outcome = when (action) {
            Protocol.ACTION_BACK -> globalAction(GLOBAL_ACTION_BACK)
            Protocol.ACTION_HOME -> globalAction(GLOBAL_ACTION_HOME)
            Protocol.ACTION_RECENTS -> globalAction(GLOBAL_ACTION_RECENTS)
            Protocol.ACTION_LOCK -> if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P)
                globalAction(GLOBAL_ACTION_LOCK_SCREEN)
            else ActionOutcome(false, "android_version_unsupported")
            Protocol.ACTION_WAKE -> ActionOutcome(wakeScreen(), "action_completed")
            Protocol.ACTION_DND_TOGGLE -> toggleDoNotDisturb()
            else -> ActionOutcome(false, "action_failed")
        }
        socket?.deviceActionResult(
            commandId,
            action,
            if (outcome.accepted) "accepted" else "rejected",
            outcome.reasonCode
        )
    }

    private fun globalAction(action: Int): ActionOutcome {
        val accepted = performGlobalAction(action)
        return ActionOutcome(accepted, if (accepted) "action_completed" else "action_failed")
    }

    @Suppress("DEPRECATION")
    private fun wakeScreen(): Boolean = runCatching {
        val power = getSystemService(PowerManager::class.java)
        if (!power.isInteractive) {
            val wakeLock = power.newWakeLock(
                PowerManager.SCREEN_BRIGHT_WAKE_LOCK or PowerManager.ACQUIRE_CAUSES_WAKEUP,
                "BoundaryLab:ViewerWake"
            )
            wakeLock.acquire(3_000L)
        }
        true
    }.getOrDefault(false)

    private fun toggleDoNotDisturb(): ActionOutcome {
        val notifications = getSystemService(NotificationManager::class.java)
        if (!notifications.isNotificationPolicyAccessGranted)
            return ActionOutcome(false, "dnd_permission_required")
        return runCatching {
            val enabled = notifications.currentInterruptionFilter ==
                NotificationManager.INTERRUPTION_FILTER_ALL
            notifications.setInterruptionFilter(
                if (enabled) NotificationManager.INTERRUPTION_FILTER_PRIORITY
                else NotificationManager.INTERRUPTION_FILTER_ALL
            )
            ActionOutcome(true, if (enabled) "dnd_enabled" else "dnd_disabled")
        }.getOrElse { ActionOutcome(false, "action_failed") }
    }

    private data class ActionOutcome(val accepted: Boolean, val reasonCode: String)

    private fun leaseValid(viewerId: String?): Boolean =
        !viewerId.isNullOrBlank() && (leases[viewerId] ?: 0L) > SystemClock.elapsedRealtime()

    private fun streamActive(commandId: String, viewerId: String): Boolean =
        streamCommandId == commandId && streamViewerId == viewerId && leaseValid(viewerId)

    private fun scheduleViewerFrame(delayMs: Long = 0L) {
        if (streamCommandId == null || streamViewerId == null) return
        main.removeCallbacks(viewerFrame)
        main.postDelayed(viewerFrame, delayMs)
    }

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
        captureLatestSelected { bytes ->
            main.post {
                if (!streamActive(commandId, viewerId) || generation != frameGeneration) {
                    releaseViewerFrame(generation)
                } else if (bytes == null) {
                    completeViewerFrame(
                        generation,
                        commandId,
                        viewerId,
                        "failed",
                        "projection_frame_unavailable",
                        50
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

    private fun captureReady(): Boolean = when (CaptureMode.get(this)) {
        CaptureMode.ACCESSIBILITY -> Build.VERSION.SDK_INT >= Build.VERSION_CODES.R
        else -> ProjectionCaptureService.isActive()
    }

    private fun captureUnavailableReason(): String = when (CaptureMode.get(this)) {
        CaptureMode.ACCESSIBILITY -> "accessibility_screenshot_unavailable"
        else -> "projection_permission_required"
    }

    private fun captureLatestSelected(done: (ByteArray?) -> Unit) {
        when (CaptureMode.get(this)) {
            CaptureMode.ACCESSIBILITY -> captureAccessibilityScreenshot(done)
            else -> ProjectionCaptureService.captureLatest(done)
        }
    }

    @SuppressLint("WrongConstant")
    private fun captureAccessibilityScreenshot(done: (ByteArray?) -> Unit) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.R) {
            done(null)
            return
        }
        val executor = java.util.concurrent.Executor { runnable -> main.post(runnable) }
        takeScreenshot(
            Display.DEFAULT_DISPLAY,
            executor,
            object : TakeScreenshotCallback {
                override fun onSuccess(screenshot: ScreenshotResult) {
                    var hardwareBitmap: Bitmap? = null
                    var bitmap: Bitmap? = null
                    var scaled: Bitmap? = null
                    val bytes = runCatching {
                        hardwareBitmap = Bitmap.wrapHardwareBuffer(
                            screenshot.hardwareBuffer,
                            screenshot.colorSpace
                        ) ?: return@runCatching null
                        bitmap = hardwareBitmap!!.copy(Bitmap.Config.ARGB_8888, false)
                        val source = bitmap ?: return@runCatching null
                        val cfg = AgentConfig.get(this@BoundaryAccessibilityService)
                        scaled = if (source.width > cfg.captureMaxWidth) {
                            val height = (source.height * cfg.captureMaxWidth.toFloat() / source.width)
                                .toInt().coerceAtLeast(1)
                            Bitmap.createScaledBitmap(source, cfg.captureMaxWidth, height, true)
                        } else source
                        ByteArrayOutputStream().use { out ->
                            scaled!!.compress(Bitmap.CompressFormat.JPEG, cfg.captureQuality, out)
                            out.toByteArray()
                        }
                    }.getOrNull()
                    runCatching { screenshot.hardwareBuffer.close() }
                    if (scaled !== bitmap) runCatching { scaled?.recycle() }
                    runCatching { bitmap?.recycle() }
                    runCatching { hardwareBitmap?.recycle() }
                    done(bytes)
                }

                override fun onFailure(errorCode: Int) {
                    done(null)
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
        if (result == "uploaded") scheduleNodeSnapshot(viewerId)
        socket?.screenshotResult(commandId, result, reasonCode)
        scheduleViewerFrame(retryDelayMs)
    }

    private fun scheduleNodeSnapshot(viewerId: String, force: Boolean = false) {
        if (!leaseValid(viewerId) || (!force && !nodesDirty)) return
        nodeViewerId = viewerId
        nodeSnapshotForced = nodeSnapshotForced || force
        val remaining = (lastNodeSnapshotAt + NODE_MIN_INTERVAL_MS - SystemClock.elapsedRealtime())
            .coerceAtLeast(0L)
        main.removeCallbacks(nodeSnapshot)
        main.postDelayed(nodeSnapshot, remaining)
    }

    private data class NodeEntry(
        val node: AccessibilityNodeInfo,
        val parentId: String?,
        val depth: Int
    )

    private fun publishNodeSnapshot(viewerId: String, force: Boolean) {
        if (!leaseValid(viewerId)) return
        val started = SystemClock.elapsedRealtime()
        val metrics = resources.displayMetrics
        val windows = JSONArray()
        var truncated = false
        val root = rootInActiveWindow
        val window = JSONObject()
            .put("id", "active")
            .put("type", "application")
            .put("package", root?.packageName?.toString()?.take(200) ?: JSONObject.NULL)
            .put("active", true)
            .put("focused", true)
        val nodes = JSONArray()
        if (root == null) {
            window.put("root_status", "null_root")
        } else {
            window.put("root_status", "available")
            val queue = ArrayDeque<NodeEntry>()
            queue.add(NodeEntry(root, null, 0))
            var nextId = 0
            while (queue.isNotEmpty() && nextId < MAX_NODE_COUNT) {
                val entry = queue.removeFirst()
                val node = entry.node
                val nodeId = "n${nextId++}"
                try {
                    val bounds = Rect()
                    node.getBoundsInScreen(bounds)
                    // 节点直接上报：不再按字段白名单剔除 text/contentDescription。
                    val password = node.isPassword
                    val editable = node.isEditable
                    val text = node.text?.toString()
                    val contentDescription = node.contentDescription?.toString()
                    val textPresent = !text.isNullOrEmpty() || !contentDescription.isNullOrEmpty()
                    nodes.put(
                        JSONObject()
                            .put("id", nodeId)
                            .put("parent_id", entry.parentId ?: JSONObject.NULL)
                            .put(
                                "class_name",
                                node.className?.toString()?.take(200) ?: "android.view.View"
                            )
                            .put(
                                "view_id",
                                node.viewIdResourceName?.take(250) ?: JSONObject.NULL
                            )
                            .put(
                                "bounds",
                                JSONArray(
                                    listOf(
                                        safeCoordinate(bounds.left),
                                        safeCoordinate(bounds.top),
                                        safeCoordinate(bounds.right),
                                        safeCoordinate(bounds.bottom)
                                    )
                                )
                            )
                            .put(
                                "flags",
                                JSONObject()
                                    .put("visible", node.isVisibleToUser)
                                    .put("enabled", node.isEnabled)
                                    .put("clickable", node.isClickable)
                                    .put("scrollable", node.isScrollable)
                                    .put("editable", editable)
                                    .put("password", password)
                                    .put("sensitive", password)
                                    .put("focused", node.isFocused)
                            )
                            .put("text_present", textPresent)
                            .put("text", text ?: JSONObject.NULL)
                            .put("content_description", contentDescription ?: JSONObject.NULL)
                    )
                    if (entry.depth < MAX_NODE_DEPTH) {
                        for (index in 0 until node.childCount) {
                            val child = runCatching { node.getChild(index) }.getOrNull() ?: continue
                            queue.add(NodeEntry(child, nodeId, entry.depth + 1))
                        }
                    } else if (node.childCount > 0) truncated = true
                } finally {
                    runCatching { node.recycle() }
                }
            }
            if (queue.isNotEmpty()) {
                truncated = true
                while (queue.isNotEmpty()) runCatching { queue.removeFirst().node.recycle() }
            }
        }
        window.put("nodes", nodes)
        windows.put(window)
        val structuralHash = windows.toString().hashCode()
        nodesDirty = false
        lastNodeSnapshotAt = SystemClock.elapsedRealtime()
        if (!force && structuralHash == lastNodeHash) return
        lastNodeHash = structuralHash
        val payload = JSONObject()
            .put("schema_version", 1)
            .put("captured_at", isoTimestamp())
            .put(
                "display",
                JSONObject()
                    .put("width", metrics.widthPixels.coerceAtLeast(1))
                    .put("height", metrics.heightPixels.coerceAtLeast(1))
            )
            .put("windows", windows)
            .put("observations", JSONArray())
            .put(
                "diagnostics",
                JSONObject()
                    .put("elapsed_ms", SystemClock.elapsedRealtime() - started)
                    .put("truncated", truncated)
            )
        socket?.accessibilitySnapshot(viewerId, payload)
    }

    private fun safeCoordinate(value: Int): Int = value.coerceIn(-32768, 32768)

    private fun isoTimestamp(): String = SimpleDateFormat(
        "yyyy-MM-dd'T'HH:mm:ss.SSS'Z'",
        Locale.US
    ).apply { timeZone = TimeZone.getTimeZone("UTC") }.format(Date())

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

    private fun captureInitialProjection(attempt: Int) {
        if (CaptureMode.get(this) != CaptureMode.PROJECTION || !ProjectionCaptureService.isActive() ||
            !capturing.compareAndSet(false, true)
        ) return
        uploader.singleFrameSession("initial_accessibility") { grant, _ ->
            main.post {
                if (grant == null) {
                    capturing.set(false)
                    if (attempt < 2 && ProjectionCaptureService.isActive()) {
                        main.postDelayed({ captureInitialProjection(attempt + 1) }, 1000)
                    }
                } else {
                    acquireInitialProjectionFrame(grant.getString("uploadId"), 0)
                }
            }
        }
    }

    private fun acquireInitialProjectionFrame(uploadId: String, attempt: Int) {
        captureLatestSelected { bytes ->
            main.post {
                if (bytes == null && attempt < 20 && ProjectionCaptureService.isActive()) {
                    main.postDelayed({ acquireInitialProjectionFrame(uploadId, attempt + 1) }, 100)
                } else if (bytes == null) {
                    capturing.set(false)
                } else {
                    uploader.uploadScreenshot(bytes, uploadId) { _, _ ->
                        main.post {
                            capturing.set(false)
                            scheduleViewerFrame()
                        }
                    }
                }
            }
        }
    }

    private fun onProjectionStateChanged() {
        val active = ProjectionCaptureService.isActive()
        socket?.send(
            Protocol.UP_STATUS,
            JSONObject()
                .put("type", "device_status")
                .put("accessibilityAlive", true)
                .put("captureReady", captureReady())
                .put("projectionActive", active)
                .put("captureMode", CaptureMode.get(this))
        )
        if (active) {
            if (!initialCaptureStarted) {
                initialCaptureStarted = true
                main.postDelayed({ captureInitialProjection(0) }, 300)
            }
            scheduleViewerFrame()
        } else {
            initialCaptureStarted = false
            streamViewerId?.let {
                stopViewerStream(it, "projection_stopped", notify = true)
            }
        }
    }

    private fun onCaptureModeChanged() {
        val mode = CaptureMode.get(this)
        if (mode == CaptureMode.ACCESSIBILITY) {
            runCatching { ProjectionCaptureService.stop(this) }
        }
        socket?.send(
            Protocol.UP_STATUS,
            JSONObject()
                .put("type", "device_status")
                .put("accessibilityAlive", true)
                .put("captureReady", captureReady())
                .put("projectionActive", ProjectionCaptureService.isActive())
                .put("captureMode", mode)
        )
        scheduleViewerFrame()
    }

    override fun onAccessibilityEvent(event: AccessibilityEvent?) {
        nodesDirty = true
        val viewerId = streamViewerId
            ?: leases.entries.firstOrNull { it.value > SystemClock.elapsedRealtime() }?.key
        if (viewerId != null) scheduleNodeSnapshot(viewerId)
    }
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
        leases.clear()
        activeCommands.clear()
        streamCommandId = null
        streamViewerId = null
        frameGeneration++
        capturing.set(false)
        main.removeCallbacks(nodeSnapshot)
        nodeViewerId = null
        lastNodeHash = null
        super.onDestroy()
    }

    companion object {
        private const val MAX_NODE_COUNT = 250
        private const val MAX_NODE_DEPTH = 24
        private const val NODE_MIN_INTERVAL_MS = 750L
        @Volatile private var instance: BoundaryAccessibilityService? = null
        fun refreshConnection() = instance?.let { service -> service.main.post { service.onCaptureModeChanged() } }
        fun projectionStateChanged() = instance?.let { service ->
            service.main.post { service.onProjectionStateChanged() }
        }
    }
}
