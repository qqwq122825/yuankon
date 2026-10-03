package com.zaka.screenagent.accessibility

import android.accessibilityservice.AccessibilityService
import android.content.Intent
import android.graphics.Color
import android.graphics.PixelFormat
import android.os.Handler
import android.os.SystemClock
import android.view.Gravity
import android.view.WindowManager
import android.widget.TextView

/** Explicit, memory-only desktop diagnostics. Server commands cannot grant or renew consent. */
class DesktopNodeConsent(private val service: AccessibilityService, private val main: Handler) {
    private var expiresAt = 0L
    private var banner: TextView? = null
    private var homePackage: String? = null
    private val expiry = Runnable { stop() }
    private val wm get() = service.getSystemService(WindowManager::class.java)

    fun enable(): Boolean {
        stop()
        val home = Intent(Intent.ACTION_MAIN).addCategory(Intent.CATEGORY_HOME)
        homePackage = service.packageManager.resolveActivity(home, 0)?.activityInfo?.packageName
        if (homePackage == null || homePackage == "android") return false
        val view = TextView(service).apply {
            text = "桌面节点诊断中（5分钟）· 点此停止"
            setTextColor(Color.WHITE)
            setBackgroundColor(Color.rgb(25, 90, 140))
            setPadding(18, 12, 18, 12)
            setOnClickListener { stop() }
        }
        return runCatching {
            wm.addView(view, WindowManager.LayoutParams(
                WindowManager.LayoutParams.WRAP_CONTENT, WindowManager.LayoutParams.WRAP_CONTENT,
                WindowManager.LayoutParams.TYPE_ACCESSIBILITY_OVERLAY,
                WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE,
                PixelFormat.TRANSLUCENT
            ).apply { gravity = Gravity.BOTTOM or Gravity.CENTER_HORIZONTAL })
            banner = view
            expiresAt = SystemClock.elapsedRealtime() + 300_000L
            main.postDelayed(expiry, 300_000L)
            true
        }.getOrElse { stop(); false }
    }

    fun active(): Boolean = expiresAt > SystemClock.elapsedRealtime() && banner?.isShown == true
    fun allows(packageName: String?): Boolean = active() && packageName != null &&
        (packageName == homePackage || packageName == service.packageName)

    fun stop() {
        expiresAt = 0L
        homePackage = null
        main.removeCallbacks(expiry)
        banner?.let { runCatching { wm.removeView(it) } }
        banner = null
    }
}
