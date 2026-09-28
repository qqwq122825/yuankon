package com.zaka.screenagent

import android.app.Activity
import android.content.*
import android.media.projection.MediaProjectionManager
import android.os.Bundle
import android.os.Build
import android.Manifest
import android.content.pm.PackageManager
import android.provider.Settings
import androidx.core.app.NotificationManagerCompat
import android.widget.*
import androidx.activity.result.contract.ActivityResultContracts
import androidx.appcompat.app.AppCompatActivity
import androidx.core.content.ContextCompat
import com.zaka.screenagent.capture.CaptureService
import com.zaka.screenagent.accessibility.BoundaryAccessibilityService
import com.zaka.screenagent.net.*

class MainActivity : AppCompatActivity() {
    private lateinit var uploader: HttpUploader
    private var busy = false
    private var registering = false
    private val captureServiceIntent by lazy { Intent(this, CaptureService::class.java) }
    private val notificationPermission = registerForActivityResult(ActivityResultContracts.RequestPermission()) { granted ->
        if (granted) startProjection() else render("开启通知后再发送，以便显示共享状态与停止入口")
    }
    private val resultReceiver = object : BroadcastReceiver() {
        override fun onReceive(context: Context?, intent: Intent?) {
            busy = false; findViewById<Button>(R.id.btn_start).isEnabled = true
            render(intent?.getStringExtra("message") ?: "截图请求已结束")
        }
    }
    private val requestProjection = registerForActivityResult(ActivityResultContracts.StartActivityForResult()) { r ->
        if (r.resultCode == Activity.RESULT_OK && r.data != null) {
            CaptureService.attach(this, r.resultCode, r.data!!)
            render("正在发送一张截图，完成后自动停止")
        } else { busy = false; findViewById<Button>(R.id.btn_start).isEnabled = true; render("已取消共享") }
    }
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState); setContentView(R.layout.activity_main)
        uploader = HttpUploader(this)
        val cfg = AgentConfig.get(this)
        findViewById<TextView>(R.id.tv_info).text = "${cfg.appName}\nAPK ID：${cfg.apkId}\n设备：${DeviceIdentity.deviceId(this)}\n开启无障碍后自动上传一张临时首图；后台点击只读查看时再请求一张，均暂存 5 分钟。"
        findViewById<EditText>(R.id.api_origin).setText(DeviceSession(this).origin)
        ContextCompat.registerReceiver(this, resultReceiver, IntentFilter(CaptureService.RESULT), ContextCompat.RECEIVER_NOT_EXPORTED)
        findViewById<Button>(R.id.btn_register).setOnClickListener {
            if (busy || registering) return@setOnClickListener
            try {
                DeviceSession(this).setOrigin(findViewById<EditText>(R.id.api_origin).text.toString())
                val input = findViewById<EditText>(R.id.enrollment_token)
                registering = true
                uploader.register(input.text.toString().trim()) { data, error -> runOnUiThread {
                    registering = false
                    if (isDestroyed) return@runOnUiThread
                    if (data != null) {
                        input.text.clear()
                        BoundaryAccessibilityService.refreshConnection()
                        render("设备已登记，归属：${data.getJSONObject("owner").getString("username")}；请开启无障碍")
                    }
                    else render(error ?: "登记失败")
                } }
            } catch (_: Exception) { registering = false; render("填写 HTTPS 后台 origin；本机 USB 调试可用 http://127.0.0.1:8080") }
        }
        findViewById<Button>(R.id.btn_accessibility).setOnClickListener {
            startActivity(Intent(Settings.ACTION_ACCESSIBILITY_SETTINGS))
        }
        findViewById<Button>(R.id.btn_start).setOnClickListener {
            if (registering || busy) return@setOnClickListener
            if (DeviceSession(this).token.isBlank()) { render("请先登记设备"); return@setOnClickListener }
            if (Build.VERSION.SDK_INT >= 33 && ContextCompat.checkSelfPermission(this, Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED)
                notificationPermission.launch(Manifest.permission.POST_NOTIFICATIONS)
            else startProjection()
        }
        findViewById<Button>(R.id.btn_stop).setOnClickListener {
            stopService(captureServiceIntent); busy = false
            findViewById<Button>(R.id.btn_start).isEnabled = true; render("已停止")
        }
        updateAccessibilityState()
    }
    private fun startProjection() {
        if (!NotificationManagerCompat.from(this).areNotificationsEnabled()) { render("请在系统设置开启本应用通知"); return }
        busy = true; findViewById<Button>(R.id.btn_start).isEnabled = false
        requestProjection.launch(getSystemService(MediaProjectionManager::class.java).createScreenCaptureIntent())
    }
    private fun accessibilityEnabled(): Boolean {
        val expected = ComponentName(this, BoundaryAccessibilityService::class.java).flattenToString()
        val enabled = Settings.Secure.getString(contentResolver, Settings.Secure.ENABLED_ACCESSIBILITY_SERVICES) ?: ""
        return enabled.split(':').any { it.equals(expected, ignoreCase = true) }
    }
    private fun updateAccessibilityState() {
        val enabled = accessibilityEnabled()
        findViewById<Button>(R.id.btn_accessibility).text = if (enabled) "无障碍已开启" else "打开无障碍设置"
        if (!busy) render(if (enabled) "无障碍已开启：首图自动上报，后续等待网页截图指令" else "请先登记设备并开启无障碍")
    }
    override fun onResume() { super.onResume(); updateAccessibilityState() }
    private fun render(message: String) { findViewById<TextView>(R.id.tv_status).text = message }
    override fun onDestroy() {
        unregisterReceiver(resultReceiver); uploader.cancel(); super.onDestroy()
    }
}
