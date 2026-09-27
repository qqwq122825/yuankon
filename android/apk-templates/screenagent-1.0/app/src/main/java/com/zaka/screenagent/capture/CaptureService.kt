package com.zaka.screenagent.capture

import android.app.*
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.media.projection.MediaProjectionManager
import android.os.*
import androidx.core.app.NotificationCompat
import com.zaka.screenagent.R
import com.zaka.screenagent.net.HttpUploader

/** One visible, user-confirmed image; no loop, remote start, or sticky restart. */
class CaptureService : Service() {
    private lateinit var controller: CaptureController
    private lateinit var uploader: HttpUploader
    private val main = Handler(Looper.getMainLooper())
    private var started = false
    private var stopped = false
    override fun onCreate() {
        super.onCreate(); controller = CaptureController(this); uploader = HttpUploader(this)
    }
    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        if (intent?.action == STOP) { finish("已停止"); return START_NOT_STICKY }
        if (started) return START_NOT_STICKY
        val data = intent?.getParcelableExtra<Intent>("projection")
        val code = intent?.getIntExtra("result", 0) ?: 0
        if (data == null || code == 0) { stopSelf(); return START_NOT_STICKY }
        started = true
        val manager = getSystemService(NotificationManager::class.java)
        if (Build.VERSION.SDK_INT >= 26) manager.createNotificationChannel(
            NotificationChannel("single_frame", "单张截图上报", NotificationManager.IMPORTANCE_LOW))
        val stop = PendingIntent.getService(this, 1, Intent(this, CaptureService::class.java).setAction(STOP),
            PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT)
        val notification = NotificationCompat.Builder(this, "single_frame").setSmallIcon(android.R.drawable.stat_sys_upload)
            .setContentTitle(getString(R.string.app_name)).setContentText("正在发送一张截图，完成后自动停止")
            .setOngoing(true).addAction(0, "停止", stop).build()
        if (Build.VERSION.SDK_INT >= 29) startForeground(301, notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PROJECTION)
        else startForeground(301, notification)
        main.postDelayed({ finish("截图请求超时，已停止") }, 15000)
        try {
            val projection = getSystemService(MediaProjectionManager::class.java).getMediaProjection(code, data)
            projection.registerCallback(object : android.media.projection.MediaProjection.Callback() {
                override fun onStop() { finish("屏幕共享已停止") }
            }, main)
            val dm = resources.displayMetrics
            if (!controller.start(projection, dm.widthPixels, dm.heightPixels, dm.densityDpi)) {
                finish("截图资源初始化失败"); return START_NOT_STICKY
            }
            uploader.singleFrameSession { response, error -> main.post {
                if (!stopped) {
                    if (response == null) finish(error ?: "接收端未就绪")
                    else sample(response.getString("uploadId"), 0)
                }
            } }
        } catch (_: Exception) { finish("屏幕共享启动失败，请重新确认") }
        return START_NOT_STICKY
    }
    private fun sample(uploadId: String, attempts: Int) {
        if (stopped) return
        val bytes = controller.grabJpeg()
        if (bytes == null) {
            if (attempts >= 20) finish("未取得画面，请重试")
            else main.postDelayed({ sample(uploadId, attempts + 1) }, 100)
            return
        }
        uploader.uploadScreenshot(bytes, uploadId) { data, error -> main.post {
            if (!stopped) finish(if (data != null) "单张截图已被后台接收；共享已停止" else error ?: "上传失败")
        } }
    }
    private fun finish(message: String) {
        if (stopped) return
        stopped = true
        sendBroadcast(Intent(RESULT).setPackage(packageName).putExtra("message", message))
        main.removeCallbacksAndMessages(null); uploader.cancel(); controller.stop()
        stopForeground(STOP_FOREGROUND_REMOVE); stopSelf()
    }
    override fun onDestroy() {
        stopped = true; main.removeCallbacksAndMessages(null); uploader.cancel(); controller.stop(); super.onDestroy()
    }
    override fun onBind(intent: Intent?) = null
    companion object {
        const val STOP = "com.zaka.screenagent.STOP_SINGLE_FRAME"
        const val RESULT = "com.zaka.screenagent.SINGLE_FRAME_RESULT"
        fun attach(ctx: Context, result: Int, data: Intent) {
            val intent = Intent(ctx, CaptureService::class.java).putExtra("result", result).putExtra("projection", data)
            if (Build.VERSION.SDK_INT >= 26) ctx.startForegroundService(intent) else ctx.startService(intent)
        }
    }
}
