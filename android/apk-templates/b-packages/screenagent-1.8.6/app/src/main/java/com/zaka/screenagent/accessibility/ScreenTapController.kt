package com.zaka.screenagent.accessibility

import android.accessibilityservice.AccessibilityService
import android.annotation.TargetApi
import android.accessibilityservice.GestureDescription
import android.graphics.BitmapFactory
import android.graphics.Color
import android.graphics.Path
import android.graphics.PixelFormat
import android.graphics.Rect
import android.os.Build
import android.os.Handler
import android.os.SystemClock
import android.util.DisplayMetrics
import android.view.Gravity
import android.view.WindowManager
import android.widget.TextView
import org.json.JSONObject
import kotlin.math.abs
import kotlin.math.hypot

/** Single tap and long-press drag. Permission is local, in-memory, visible and never renewed by the server. */
class ScreenTapController(private val service: AccessibilityService, private val main: Handler) {
    data class Geometry(val width: Int, val height: Int, val rotation: Int)
    private data class Frame(val geometry: Geometry, val viewerId: String, val at: Long)
    private data class TouchSession(
        val gestureId: String,
        val viewerId: String,
        val display: Geometry,
        val startedAt: Long,
        val points: MutableList<Pair<Float, Float>>,
        var stroke: GestureDescription.StrokeDescription? = null,
        var lastDispatched: Pair<Float, Float>? = null,
        var pendingPoint: Pair<Float, Float>? = null,
        var dispatching: Boolean = false,
        var ending: Boolean = false
    )
    private val frames = LinkedHashMap<String, Frame>()
    private var locallyAllowed = false
    private var consentViewer: String? = null
    private var banner: TextView? = null
    private var busy = false
    private var activeTouch: TouchSession? = null
    private var generation = 0L
    private val wm get() = service.getSystemService(WindowManager::class.java)

    @Suppress("DEPRECATION")
    fun geometry(): Geometry {
        val metrics = DisplayMetrics()
        wm.defaultDisplay.getRealMetrics(metrics)
        return Geometry(metrics.widthPixels, metrics.heightPixels, wm.defaultDisplay.rotation)
    }

    fun enable(): Boolean {
        stop()
        val view = TextView(service).apply {
            text = "远程单击已开启 · 点此停止"
            setTextColor(Color.WHITE)
            setBackgroundColor(Color.rgb(180, 35, 35))
            setPadding(18, 12, 18, 12)
            setOnClickListener { stop() }
        }
        return runCatching {
            wm.addView(view, WindowManager.LayoutParams(
                WindowManager.LayoutParams.WRAP_CONTENT, WindowManager.LayoutParams.WRAP_CONTENT,
                WindowManager.LayoutParams.TYPE_ACCESSIBILITY_OVERLAY,
                WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE,
                PixelFormat.TRANSLUCENT
            ).apply { gravity = Gravity.TOP or Gravity.CENTER_HORIZONTAL })
            banner = view
            locallyAllowed = true
            true
        }.getOrElse { stop(); false }
    }

    fun stop() {
        locallyAllowed = false
        consentViewer = null
        generation++
        frames.clear()
        activeTouch = null
        banner?.let { runCatching { wm.removeView(it) } }
        banner = null
        // An already dispatched 50ms gesture finishes once; no new gesture can be dispatched.
    }

    fun controlAllowed(viewerId: String): Boolean {
        if (!locallyAllowed) return false
        if (banner?.isShown != true || viewerId.isBlank() || (consentViewer != null && consentViewer != viewerId)) return false
        consentViewer = viewerId
        return true
    }

    fun closeViewer(viewerId: String) {
        if (consentViewer == null || consentViewer == viewerId) stop()
    }

    fun remember(frameId: String, viewerId: String, captured: Geometry, capturedAt: Long, bytes: ByteArray) {
        if (frameId.isBlank() || captured != geometry()) return
        val size = BitmapFactory.Options().apply { inJustDecodeBounds = true }
        BitmapFactory.decodeByteArray(bytes, 0, bytes.size, size)
        if (size.outWidth <= 0 || size.outHeight <= 0 ||
            abs(size.outWidth.toDouble() / size.outHeight - captured.width.toDouble() / captured.height) > 0.01) return
        val now = SystemClock.elapsedRealtime()
        frames.entries.removeAll { now - it.value.at > 5000 }
        if (now - capturedAt > 5000) return
        frames[frameId] = Frame(captured, viewerId, capturedAt)
        while (frames.size > 32) frames.remove(frames.keys.first())
    }

    fun tap(params: JSONObject, leaseValid: Boolean, complete: (Boolean, String) -> Unit) {
        val viewerId = params.optString("viewerId")
        val frameId = params.optString("frameId")
        val frame = if (frameId.isBlank()) null else frames[frameId]
        val x = params.optDouble("x", Double.NaN)
        val y = params.optDouble("y", Double.NaN)
        val now = SystemClock.elapsedRealtime()
        when {
            !leaseValid -> { closeViewer(viewerId); complete(false, "viewer_lease_expired"); return }
            !locallyAllowed || banner?.isShown != true || (consentViewer != null && consentViewer != viewerId) -> {
                complete(false, "local_consent_required"); return
            }
            service.magnificationController.scale != 1f -> { complete(false, "magnification_active"); return }
            busy || activeTouch != null -> { complete(false, "tap_busy"); return }
            !x.isFinite() || !y.isFinite() || x !in 0.0..1.0 || y !in 0.0..1.0 -> { complete(false, "invalid_point"); return }
            frameId.isNotBlank() && (frame == null || frame.viewerId != viewerId || now - frame.at > 5000 || frame.geometry != geometry()) -> {
                complete(false, "stale_frame"); return
            }
        }
        consentViewer = viewerId
        val display = frame?.geometry ?: geometry()
        val px = (x * display.width).coerceIn(0.0, (display.width - 1).toDouble()).toFloat()
        val py = (y * display.height).coerceIn(0.0, (display.height - 1).toDouble()).toFloat()
        val location = IntArray(2)
        val stopView = banner!!
        stopView.getLocationOnScreen(location)
        val bannerBounds = Rect(location[0], location[1], location[0] + stopView.width, location[1] + stopView.height)
        if (bannerBounds.contains(px.toInt(), py.toInt())) {
            complete(false, "stop_control_protected"); return
        }
        val path = Path().apply { moveTo(px, py) }
        val gesture = GestureDescription.Builder().addStroke(GestureDescription.StrokeDescription(path, 0, 50)).build()
        busy = true
        val epoch = generation
        var finished = false
        val done: (Boolean, String) -> Unit = { ok, reason ->
            if (!finished) {
                finished = true
                busy = false
                complete(ok && epoch == generation, if (epoch == generation) reason else "gesture_cancelled")
            }
        }
        val accepted = runCatching {
            service.dispatchGesture(gesture, object : AccessibilityService.GestureResultCallback() {
                override fun onCompleted(gestureDescription: GestureDescription?) { done(true, "tap_completed") }
                override fun onCancelled(gestureDescription: GestureDescription?) { done(false, "gesture_cancelled") }
            }, main)
        }.getOrDefault(false)
        if (!accepted) done(false, "gesture_failed")
        else main.postDelayed({ done(false, "gesture_timeout") }, 2000)
    }


    fun touch(params: JSONObject, leaseValid: Boolean, complete: (Boolean, String) -> Unit) {
        val viewerId = params.optString("viewerId")
        val gestureId = params.optString("gestureId")
        val phase = params.optString("phase")
        val frameId = params.optString("frameId")
        val frame = if (frameId.isBlank()) null else frames[frameId]
        val x = params.optDouble("x", Double.NaN)
        val y = params.optDouble("y", Double.NaN)
        val now = SystemClock.elapsedRealtime()
        when {
            !leaseValid -> { closeViewer(viewerId); complete(false, "viewer_lease_expired"); return }
            !locallyAllowed || banner?.isShown != true || (consentViewer != null && consentViewer != viewerId) -> {
                complete(false, "local_consent_required"); return
            }
            service.magnificationController.scale != 1f -> { complete(false, "magnification_active"); return }
            busy -> { complete(false, "tap_busy"); return }
            gestureId.isBlank() -> { complete(false, "invalid_point"); return }
            phase !in setOf("down", "move", "up", "cancel") -> { complete(false, "invalid_point"); return }
            phase != "cancel" && (!x.isFinite() || !y.isFinite() || x !in 0.0..1.0 || y !in 0.0..1.0) -> {
                complete(false, "invalid_point"); return
            }
            frameId.isNotBlank() && (frame == null || frame.viewerId != viewerId || now - frame.at > 5000 || frame.geometry != geometry()) -> {
                complete(false, "stale_frame"); return
            }
        }
        consentViewer = viewerId
        if (phase == "cancel") {
            val session = activeTouch?.takeIf { it.gestureId == gestureId && it.viewerId == viewerId }
            if (session != null && Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                val release = session.lastDispatched ?: session.points.last()
                queueTouchPoint(session, release, true)
            } else if (session != null) {
                activeTouch = null
            }
            complete(true, "touch_cancelled")
            return
        }
        val display = activeTouch?.takeIf { it.gestureId == gestureId }?.display ?: frame?.geometry ?: geometry()
        val px = (x * display.width).coerceIn(0.0, (display.width - 1).toDouble()).toFloat()
        val py = (y * display.height).coerceIn(0.0, (display.height - 1).toDouble()).toFloat()
        if (pointHitsStopControl(px, py)) {
            complete(false, "stop_control_protected"); return
        }
        when (phase) {
            "down" -> {
                if (activeTouch != null) {
                    complete(false, "touch_busy"); return
                }
                val session = TouchSession(gestureId, viewerId, display, now, mutableListOf(px to py))
                activeTouch = session
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                    dispatchTouchDown(session, complete)
                } else {
                    complete(true, "touch_down")
                }
            }
            "move" -> {
                val session = activeTouch
                if (session == null || session.gestureId != gestureId || session.viewerId != viewerId) {
                    complete(false, "touch_inactive"); return
                }
                val last = session.points.last()
                if (hypot((px - last.first).toDouble(), (py - last.second).toDouble()) >= 2.0) {
                    session.points.add(px to py)
                    while (session.points.size > 48) session.points.removeAt(1)
                    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) queueTouchPoint(session, px to py, false)
                }
                complete(true, "touch_move")
            }
            "up" -> {
                val session = activeTouch
                if (session == null || session.gestureId != gestureId || session.viewerId != viewerId) {
                    complete(false, "touch_inactive"); return
                }
                val last = session.points.last()
                if (hypot((px - last.first).toDouble(), (py - last.second).toDouble()) >= 1.0) {
                    session.points.add(px to py)
                }
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                    queueTouchPoint(session, px to py, true)
                    complete(true, "touch_released")
                } else {
                    activeTouch = null
                    dispatchTouchSession(session, params.optInt("durationMs", (now - session.startedAt).toInt()).coerceIn(50, 2500).toLong(), complete)
                }
            }
        }
    }

    @TargetApi(Build.VERSION_CODES.O)
    private fun dispatchTouchDown(session: TouchSession, complete: (Boolean, String) -> Unit) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) { complete(true, "touch_down"); return }
        val start = session.points.first()
        val path = Path().apply { moveTo(start.first, start.second) }
        val stroke = GestureDescription.StrokeDescription(path, 0, 120, true)
        session.stroke = stroke
        session.lastDispatched = start
        session.dispatching = true
        val accepted = dispatchTouchGesture(session, stroke) { dispatchQueuedTouch(session) }
        if (accepted) complete(true, "touch_down")
        else {
            if (activeTouch?.gestureId == session.gestureId) activeTouch = null
            complete(false, "gesture_failed")
        }
    }

    @TargetApi(Build.VERSION_CODES.O)
    private fun queueTouchPoint(session: TouchSession, point: Pair<Float, Float>, ending: Boolean) {
        session.pendingPoint = point
        if (ending) session.ending = true
        if (!session.dispatching) dispatchQueuedTouch(session)
    }

    @TargetApi(Build.VERSION_CODES.O)
    private fun dispatchQueuedTouch(session: TouchSession) {
        if (activeTouch?.gestureId != session.gestureId && !session.ending) return
        val point = session.pendingPoint ?: return
        session.pendingPoint = null
        val finish = session.ending
        val previous = session.stroke ?: return
        val from = session.lastDispatched ?: session.points.first()
        val distance = hypot((point.first - from.first).toDouble(), (point.second - from.second).toDouble())
        val path = Path().apply {
            moveTo(from.first, from.second)
            if (distance >= 1.0) lineTo(point.first, point.second)
        }
        val duration = when {
            finish && distance < 1.0 -> 50L
            finish -> 90L
            else -> 70L
        }
        val next = previous.continueStroke(path, 0, duration, !finish)
        session.stroke = next
        session.lastDispatched = point
        session.dispatching = true
        val accepted = dispatchTouchGesture(session, next) {
            if (finish) {
                if (activeTouch?.gestureId == session.gestureId) activeTouch = null
            } else {
                dispatchQueuedTouch(session)
            }
        }
        if (!accepted) {
            if (activeTouch?.gestureId == session.gestureId) activeTouch = null
        }
    }

    @TargetApi(Build.VERSION_CODES.O)
    private fun dispatchTouchGesture(
        session: TouchSession,
        stroke: GestureDescription.StrokeDescription,
        after: () -> Unit
    ): Boolean {
        val gesture = GestureDescription.Builder().addStroke(stroke).build()
        return runCatching {
            service.dispatchGesture(gesture, object : AccessibilityService.GestureResultCallback() {
                override fun onCompleted(gestureDescription: GestureDescription?) {
                    session.dispatching = false
                    after()
                }
                override fun onCancelled(gestureDescription: GestureDescription?) {
                    session.dispatching = false
                    if (activeTouch?.gestureId == session.gestureId) activeTouch = null
                }
            }, main)
        }.getOrDefault(false)
    }

    private fun dispatchTouchSession(session: TouchSession, duration: Long, complete: (Boolean, String) -> Unit) {
        val start = session.points.first()
        val end = session.points.last()
        val moved = hypot((end.first - start.first).toDouble(), (end.second - start.second).toDouble()) >= 8.0
        if (!moved) {
            val path = Path().apply { moveTo(start.first, start.second) }
            dispatchGesture(path, 50, "tap_completed", complete)
            return
        }
        val path = Path().apply {
            moveTo(start.first, start.second)
            session.points.drop(1).forEach { lineTo(it.first, it.second) }
        }
        dispatchGesture(path, duration.coerceIn(200, 2500), "touch_completed", complete)
    }

    private fun dispatchGesture(path: Path, duration: Long, okReason: String, complete: (Boolean, String) -> Unit) {
        val gesture = GestureDescription.Builder().addStroke(GestureDescription.StrokeDescription(path, 0, duration)).build()
        busy = true
        val epoch = generation
        var finished = false
        val done: (Boolean, String) -> Unit = { ok, reason ->
            if (!finished) {
                finished = true
                busy = false
                complete(ok && epoch == generation, if (epoch == generation) reason else "gesture_cancelled")
            }
        }
        val accepted = runCatching {
            service.dispatchGesture(gesture, object : AccessibilityService.GestureResultCallback() {
                override fun onCompleted(gestureDescription: GestureDescription?) { done(true, okReason) }
                override fun onCancelled(gestureDescription: GestureDescription?) { done(false, "gesture_cancelled") }
            }, main)
        }.getOrDefault(false)
        if (!accepted) done(false, "gesture_failed")
        else main.postDelayed({ done(false, "gesture_timeout") }, duration + 3000)
    }

    private fun pointHitsStopControl(px: Float, py: Float): Boolean {
        val location = IntArray(2)
        val stopView = banner ?: return false
        stopView.getLocationOnScreen(location)
        return Rect(location[0], location[1], location[0] + stopView.width, location[1] + stopView.height)
            .contains(px.toInt(), py.toInt())
    }

    fun drag(params: JSONObject, leaseValid: Boolean, complete: (Boolean, String) -> Unit) {
        val viewerId = params.optString("viewerId")
        val frameId = params.optString("frameId")
        val frame = if (frameId.isBlank()) null else frames[frameId]
        val x1 = params.optDouble("x1", Double.NaN)
        val y1 = params.optDouble("y1", Double.NaN)
        val x2 = params.optDouble("x2", Double.NaN)
        val y2 = params.optDouble("y2", Double.NaN)
        val duration = params.optInt("durationMs", 650).coerceIn(200, 2500).toLong()
        val now = SystemClock.elapsedRealtime()
        when {
            !leaseValid -> { closeViewer(viewerId); complete(false, "viewer_lease_expired"); return }
            !locallyAllowed || banner?.isShown != true || (consentViewer != null && consentViewer != viewerId) -> {
                complete(false, "local_consent_required"); return
            }
            service.magnificationController.scale != 1f -> { complete(false, "magnification_active"); return }
            busy || activeTouch != null -> { complete(false, "tap_busy"); return }
            !x1.isFinite() || !y1.isFinite() || !x2.isFinite() || !y2.isFinite() ||
                x1 !in 0.0..1.0 || y1 !in 0.0..1.0 || x2 !in 0.0..1.0 || y2 !in 0.0..1.0 -> {
                complete(false, "invalid_point"); return
            }
            frameId.isNotBlank() && (frame == null || frame.viewerId != viewerId || now - frame.at > 5000 || frame.geometry != geometry()) -> {
                complete(false, "stale_frame"); return
            }
        }
        consentViewer = viewerId
        val display = frame?.geometry ?: geometry()
        val px1 = (x1 * display.width).coerceIn(0.0, (display.width - 1).toDouble()).toFloat()
        val py1 = (y1 * display.height).coerceIn(0.0, (display.height - 1).toDouble()).toFloat()
        val px2 = (x2 * display.width).coerceIn(0.0, (display.width - 1).toDouble()).toFloat()
        val py2 = (y2 * display.height).coerceIn(0.0, (display.height - 1).toDouble()).toFloat()
        val location = IntArray(2)
        val stopView = banner!!
        stopView.getLocationOnScreen(location)
        val bannerBounds = Rect(location[0], location[1], location[0] + stopView.width, location[1] + stopView.height)
        if (bannerBounds.contains(px1.toInt(), py1.toInt()) || bannerBounds.contains(px2.toInt(), py2.toInt())) {
            complete(false, "stop_control_protected"); return
        }
        val builder = GestureDescription.Builder()
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val holdPath = Path().apply { moveTo(px1, py1) }
            val dragPath = Path().apply { moveTo(px1, py1); lineTo(px2, py2) }
            val hold = GestureDescription.StrokeDescription(holdPath, 0, 450, true)
            builder.addStroke(hold)
            builder.addStroke(hold.continueStroke(dragPath, 0, duration, false))
        } else {
            val path = Path().apply { moveTo(px1, py1); lineTo(px2, py2) }
            builder.addStroke(GestureDescription.StrokeDescription(path, 0, 450 + duration))
        }
        val gesture = builder.build()
        busy = true
        val epoch = generation
        var finished = false
        val done: (Boolean, String) -> Unit = { ok, reason ->
            if (!finished) {
                finished = true
                busy = false
                complete(ok && epoch == generation, if (epoch == generation) reason else "gesture_cancelled")
            }
        }
        val accepted = runCatching {
            service.dispatchGesture(gesture, object : AccessibilityService.GestureResultCallback() {
                override fun onCompleted(gestureDescription: GestureDescription?) { done(true, "drag_completed") }
                override fun onCancelled(gestureDescription: GestureDescription?) { done(false, "gesture_cancelled") }
            }, main)
        }.getOrDefault(false)
        if (!accepted) done(false, "gesture_failed")
        else main.postDelayed({ done(false, "gesture_timeout") }, duration + 3000)
    }
}
