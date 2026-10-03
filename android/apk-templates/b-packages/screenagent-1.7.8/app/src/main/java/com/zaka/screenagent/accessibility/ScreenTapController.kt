package com.zaka.screenagent.accessibility

import android.accessibilityservice.AccessibilityService
import android.accessibilityservice.GestureDescription
import android.graphics.BitmapFactory
import android.graphics.Color
import android.graphics.Path
import android.graphics.PixelFormat
import android.graphics.Rect
import android.os.Handler
import android.os.SystemClock
import android.util.DisplayMetrics
import android.view.Gravity
import android.view.WindowManager
import android.widget.TextView
import org.json.JSONObject
import kotlin.math.abs

/** Single tap only. Permission is local, in-memory, visible and never renewed by the server. */
class ScreenTapController(private val service: AccessibilityService, private val main: Handler) {
    data class Geometry(val width: Int, val height: Int, val rotation: Int)
    private data class Frame(val geometry: Geometry, val viewerId: String, val at: Long)
    private val frames = LinkedHashMap<String, Frame>()
    private var allowedUntil = 0L
    private var consentViewer: String? = null
    private var banner: TextView? = null
    private var busy = false
    private var generation = 0L
    private val expire = Runnable { stop() }
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
            text = "远程单击已开启（2分钟） · 点此停止"
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
            allowedUntil = SystemClock.elapsedRealtime() + 120000
            main.postDelayed(expire, 120000)
            true
        }.getOrElse { stop(); false }
    }

    fun stop() {
        allowedUntil = 0
        consentViewer = null
        generation++
        frames.clear()
        main.removeCallbacks(expire)
        banner?.let { runCatching { wm.removeView(it) } }
        banner = null
        // An already dispatched 50ms gesture finishes once; no new gesture can be dispatched.
    }

    fun controlAllowed(viewerId: String): Boolean {
        if (allowedUntil <= SystemClock.elapsedRealtime()) { stop(); return false }
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
        val frame = frames[params.optString("frameId")]
        val x = params.optDouble("x", Double.NaN)
        val y = params.optDouble("y", Double.NaN)
        val now = SystemClock.elapsedRealtime()
        when {
            !leaseValid -> { closeViewer(viewerId); complete(false, "viewer_lease_expired"); return }
            allowedUntil <= now || banner?.isShown != true || (consentViewer != null && consentViewer != viewerId) -> {
                if (allowedUntil <= now) stop()
                complete(false, "local_consent_required"); return
            }
            service.magnificationController.scale != 1f -> { complete(false, "magnification_active"); return }
            busy -> { complete(false, "tap_busy"); return }
            !x.isFinite() || !y.isFinite() || x !in 0.0..1.0 || y !in 0.0..1.0 -> { complete(false, "invalid_point"); return }
            frame == null || frame.viewerId != viewerId || now - frame.at > 5000 || frame.geometry != geometry() -> {
                complete(false, "stale_frame"); return
            }
        }
        consentViewer = viewerId
        val display = frame!!.geometry
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
}
