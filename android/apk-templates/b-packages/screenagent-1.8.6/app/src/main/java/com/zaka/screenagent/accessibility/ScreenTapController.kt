package com.zaka.screenagent.accessibility

import android.accessibilityservice.AccessibilityService
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

/** Single tap and long-press drag. Permission is local, in-memory, visible and never renewed by the server. */
class ScreenTapController(private val service: AccessibilityService, private val main: Handler) {
    data class Geometry(val width: Int, val height: Int, val rotation: Int)
    private data class Frame(val geometry: Geometry, val viewerId: String, val at: Long)
    private val frames = LinkedHashMap<String, Frame>()
    private var locallyAllowed = false
    private var consentViewer: String? = null
    private var banner: TextView? = null
    private var busy = false
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
            busy -> { complete(false, "tap_busy"); return }
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
            busy -> { complete(false, "tap_busy"); return }
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
