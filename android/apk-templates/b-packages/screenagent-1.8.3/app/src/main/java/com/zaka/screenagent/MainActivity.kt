package com.zaka.screenagent

import android.app.Activity
import android.app.AlertDialog
import android.content.Intent
import android.os.Bundle
import android.provider.Settings
import android.view.Gravity
import android.view.ViewGroup
import android.widget.Button
import android.widget.LinearLayout
import android.widget.TextView
import android.widget.Toast
import com.zaka.screenagent.accessibility.BoundaryAccessibilityService
import com.zaka.screenagent.capture.ProjectionCaptureService

class MainActivity : Activity() {
    private lateinit var status: TextView

    override fun onCreate(state: Bundle?) {
        super.onCreate(state)
        title = "${getString(R.string.mode_title)} · v${BuildConfig.VERSION_NAME}"
        val layout = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            gravity = Gravity.CENTER_HORIZONTAL
            setPadding(48, 72, 48, 48)
            layoutParams = ViewGroup.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.MATCH_PARENT
            )
        }
        status = TextView(this).apply {
            textSize = 18f
            gravity = Gravity.CENTER
            text = statusText()
        }
        val projection = Button(this).apply {
            text = getString(R.string.mode_projection)
            setOnClickListener {
                CaptureMode.set(this@MainActivity, CaptureMode.PROJECTION)
                status.text = statusText()
                Toast.makeText(this@MainActivity, R.string.mode_projection_desc, Toast.LENGTH_SHORT).show()
                ProjectionActivity.request(this@MainActivity)
                BoundaryAccessibilityService.refreshConnection()
            }
        }
        val accessibility = Button(this).apply {
            text = getString(R.string.mode_accessibility)
            setOnClickListener {
                ProjectionConsentGate.cancel()
                CaptureMode.set(this@MainActivity, CaptureMode.ACCESSIBILITY)
                status.text = statusText()
                Toast.makeText(this@MainActivity, R.string.mode_accessibility_desc, Toast.LENGTH_SHORT).show()
                ProjectionCaptureService.stop(this@MainActivity)
                BoundaryAccessibilityService.refreshConnection()
            }
        }
        val settings = Button(this).apply {
            text = "打开无障碍设置"
            setOnClickListener { startActivity(Intent(Settings.ACTION_ACCESSIBILITY_SETTINGS)) }
        }
        val taps = Button(this).apply {
            text = "运行操作"
            setOnClickListener {
                AlertDialog.Builder(this@MainActivity)
                    .setTitle("允许网页单击此手机？")
                    .setMessage("当前网页查看者可在截图上单击手机。授权在当前查看会话持续有效，没有固定时限，屏幕持续显示停止入口；关闭查看或断线后停止。截图授权与单击授权独立。")
                    .setNegativeButton("取消", null)
                    .setPositiveButton("开启") { _, _ ->
                        val enabled = BoundaryAccessibilityService.enableLocalTaps()
                        Toast.makeText(this@MainActivity, if (enabled) "已开启，可点屏幕顶部停止" else "请先开启无障碍服务", Toast.LENGTH_LONG).show()
                    }.show()
            }
        }
        val stopTaps = Button(this).apply {
            text = "停止操作"
            setOnClickListener { BoundaryAccessibilityService.stopLocalTaps() }
        }
        listOf(status, projection, accessibility, settings, taps, stopTaps).forEach { view ->
            layout.addView(view, LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.WRAP_CONTENT
            ).apply { bottomMargin = 24 })
        }
        setContentView(layout)
    }

    override fun onResume() {
        super.onResume()
        if (::status.isInitialized) status.text = statusText()
    }

    private fun statusText(): String = "v${BuildConfig.VERSION_NAME} · " + when (CaptureMode.get(this)) {
        CaptureMode.PROJECTION -> if (ProjectionCaptureService.isActive())
            "当前模式：MediaProjection（已授权）"
        else "当前模式：MediaProjection（点击按钮授权）"
        else -> "当前模式：takeScreenshot（无屏幕共享弹窗）"
    }
}
