package com.zaka.screenagent

import android.Manifest
import android.app.Activity
import android.content.Intent
import android.content.pm.PackageManager
import android.media.projection.MediaProjectionManager
import android.os.Build
import android.os.Bundle
import android.provider.Settings
import android.view.Gravity
import android.view.ViewGroup
import android.widget.Button
import android.widget.LinearLayout
import android.widget.TextView
import androidx.activity.result.contract.ActivityResultContracts
import androidx.appcompat.app.AppCompatActivity
import androidx.core.content.ContextCompat
import com.zaka.screenagent.capture.ProjectionCaptureService

/** Visible, user-started entry point for the Android system screen-sharing consent flow. */
class ProjectionActivity : AppCompatActivity() {
    private lateinit var status: TextView
    private lateinit var start: Button
    private lateinit var stop: Button

    private val projectionConsent = registerForActivityResult(
        ActivityResultContracts.StartActivityForResult()
    ) { result ->
        val data = result.data
        if (result.resultCode == Activity.RESULT_OK && data != null) {
            ProjectionCaptureService.start(this, result.resultCode, data)
            render("系统已授权，正在启动屏幕共享")
        } else render("未开启屏幕共享")
    }

    private val notificationPermission = registerForActivityResult(
        ActivityResultContracts.RequestPermission()
    ) { granted ->
        if (granted) requestProjection()
        else render("需要通知权限来持续显示共享状态和停止入口")
    }

    override fun onCreate(state: Bundle?) {
        super.onCreate(state)
        val cfg = AgentConfig.get(this)
        val content = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            gravity = Gravity.CENTER_HORIZONTAL
            setPadding(48, 64, 48, 48)
        }
        content.addView(TextView(this).apply {
            text = cfg.appName
            textSize = 24f
        }, matchWrap())
        content.addView(TextView(this).apply {
            text = "截图方式：MediaProjection + VirtualDisplay + ImageReader\n每次会话都由 Android 系统确认；共享期间持续显示通知，可随时停止。"
            textSize = 15f
            setPadding(0, 24, 0, 24)
        }, matchWrap())
        status = TextView(this).apply { setPadding(0, 0, 0, 20) }
        content.addView(status, matchWrap())
        start = Button(this).apply {
            text = "开始屏幕共享"
            setOnClickListener { ensureNotificationThenRequest() }
        }
        content.addView(start, matchWrap())
        stop = Button(this).apply {
            text = "停止屏幕共享"
            setOnClickListener {
                ProjectionCaptureService.stop(this@ProjectionActivity)
                render("屏幕共享已停止")
            }
        }
        content.addView(stop, matchWrap())
        content.addView(Button(this).apply {
            text = "打开无障碍设置"
            setOnClickListener { startActivity(Intent(Settings.ACTION_ACCESSIBILITY_SETTINGS)) }
        }, matchWrap())
        setContentView(content)
        renderState()
    }

    override fun onResume() {
        super.onResume()
        if (::status.isInitialized) renderState()
    }

    private fun ensureNotificationThenRequest() {
        if (
            Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU &&
            ContextCompat.checkSelfPermission(this, Manifest.permission.POST_NOTIFICATIONS) !=
            PackageManager.PERMISSION_GRANTED
        ) notificationPermission.launch(Manifest.permission.POST_NOTIFICATIONS)
        else requestProjection()
    }

    private fun requestProjection() {
        val manager = getSystemService(MediaProjectionManager::class.java)
        projectionConsent.launch(manager.createScreenCaptureIntent())
    }

    private fun renderState() = render(
        if (ProjectionCaptureService.isActive()) "屏幕共享已开启；网页查看时上传最新帧"
        else "屏幕共享未开启"
    )

    private fun render(message: String) {
        status.text = message
        val active = ProjectionCaptureService.isActive()
        start.isEnabled = !active
        stop.isEnabled = active
    }

    private fun matchWrap() = LinearLayout.LayoutParams(
        ViewGroup.LayoutParams.MATCH_PARENT,
        ViewGroup.LayoutParams.WRAP_CONTENT
    )
}
