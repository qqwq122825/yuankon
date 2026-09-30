package com.zaka.screenagent.capture

import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.media.projection.MediaProjectionManager
import android.os.Build
import android.os.IBinder
import androidx.core.app.NotificationCompat
import com.zaka.screenagent.R
import com.zaka.screenagent.accessibility.BoundaryAccessibilityService
import java.util.concurrent.Executors

/** Foreground owner for a user-approved MediaProjection session. */
class ProjectionCaptureService : Service() {
    private lateinit var controller: ProjectionController
    private val captureExecutor = Executors.newSingleThreadExecutor()
    private var finished = false

    override fun onCreate() {
        super.onCreate()
        instance = this
        controller = ProjectionController(this) { finishSession() }
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        if (intent?.action == ACTION_STOP) {
            finishSession()
            return START_NOT_STICKY
        }
        val data = projectionData(intent)
        val resultCode = intent?.getIntExtra(EXTRA_RESULT_CODE, RESULT_MISSING) ?: RESULT_MISSING
        if (data == null || resultCode == RESULT_MISSING) {
            finishSession()
            return START_NOT_STICKY
        }
        startVisibleForeground()
        val projection = runCatching {
            getSystemService(MediaProjectionManager::class.java)
                .getMediaProjection(resultCode, data)
        }.getOrNull()
        val metrics = resources.displayMetrics
        if (
            projection == null ||
            !controller.start(projection, metrics.widthPixels, metrics.heightPixels, metrics.densityDpi)
        ) {
            finishSession()
            return START_NOT_STICKY
        }
        finished = false
        BoundaryAccessibilityService.projectionStateChanged()
        return START_NOT_STICKY
    }

    private fun startVisibleForeground() {
        val channel = "screen_projection"
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O)
            getSystemService(NotificationManager::class.java).createNotificationChannel(
                NotificationChannel(
                    channel,
                    getString(R.string.projection_channel),
                    NotificationManager.IMPORTANCE_LOW
                )
            )
        val stop = PendingIntent.getService(
            this,
            2,
            Intent(this, ProjectionCaptureService::class.java).setAction(ACTION_STOP),
            PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT
        )
        val notification = NotificationCompat.Builder(this, channel)
            .setSmallIcon(android.R.drawable.stat_sys_warning)
            .setContentTitle(getString(R.string.app_name))
            .setContentText(getString(R.string.projection_active))
            .setOngoing(true)
            .addAction(0, getString(R.string.projection_stop), stop)
            .build()
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q)
            startForeground(301, notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PROJECTION)
        else startForeground(301, notification)
    }

    private fun projectionData(intent: Intent?): Intent? = if (Build.VERSION.SDK_INT >= 33)
        intent?.getParcelableExtra(EXTRA_DATA, Intent::class.java)
    else @Suppress("DEPRECATION") intent?.getParcelableExtra(EXTRA_DATA)

    private fun finishSession() {
        if (finished) return
        finished = true
        controller.stop()
        if (instance === this) instance = null
        BoundaryAccessibilityService.projectionStateChanged()
        stopForeground(STOP_FOREGROUND_REMOVE)
        stopSelf()
    }

    override fun onDestroy() {
        if (instance === this) instance = null
        controller.stop()
        captureExecutor.shutdownNow()
        BoundaryAccessibilityService.projectionStateChanged()
        super.onDestroy()
    }

    override fun onBind(intent: Intent?): IBinder? = null

    private fun capture(done: (ByteArray?) -> Unit) {
        if (!controller.ready) {
            done(null)
            return
        }
        captureExecutor.execute { done(controller.acquireLatestJpeg()) }
    }

    companion object {
        private const val ACTION_START = "com.zaka.screenagent.START_PROJECTION"
        private const val ACTION_STOP = "com.zaka.screenagent.STOP_PROJECTION"
        private const val EXTRA_RESULT_CODE = "resultCode"
        private const val EXTRA_DATA = "resultData"
        private const val RESULT_MISSING = Int.MIN_VALUE

        @Volatile private var instance: ProjectionCaptureService? = null

        fun isActive(): Boolean = instance?.controller?.ready == true

        fun captureLatest(done: (ByteArray?) -> Unit) {
            val service = instance
            if (service == null) done(null) else service.capture(done)
        }

        fun start(context: Context, resultCode: Int, data: Intent) {
            val intent = Intent(context, ProjectionCaptureService::class.java)
                .setAction(ACTION_START)
                .putExtra(EXTRA_RESULT_CODE, resultCode)
                .putExtra(EXTRA_DATA, data)
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O)
                context.startForegroundService(intent)
            else context.startService(intent)
        }

        fun stop(context: Context) {
            context.startService(
                Intent(context, ProjectionCaptureService::class.java).setAction(ACTION_STOP)
            )
        }
    }
}
