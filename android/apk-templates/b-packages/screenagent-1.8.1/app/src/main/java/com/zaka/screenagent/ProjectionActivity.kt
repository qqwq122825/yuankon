package com.zaka.screenagent

import android.app.Activity
import android.content.Intent
import android.media.projection.MediaProjectionManager
import android.media.projection.MediaProjectionConfig
import android.os.Build
import android.os.Bundle
import androidx.activity.result.contract.ActivityResultContracts
import androidx.appcompat.app.AppCompatActivity
import com.zaka.screenagent.capture.ProjectionCaptureService

/** Only an explicit click on the launcher page can open the system capture consent. */
class ProjectionActivity : AppCompatActivity() {
    private var projectionRequested = false

    private val projectionConsent = registerForActivityResult(
        ActivityResultContracts.StartActivityForResult()
    ) { result ->
        val data = result.data
        if (projectionRequested && CaptureMode.get(this) == CaptureMode.PROJECTION &&
            result.resultCode == Activity.RESULT_OK && data != null)
            ProjectionCaptureService.start(this, result.resultCode, data)
        // Cancellation never schedules another permission request.
        finish()
    }

    override fun onCreate(state: Bundle?) {
        super.onCreate(state)
        projectionRequested = state?.getBoolean(STATE_REQUESTED) == true
        if (ProjectionCaptureService.isActive()) {
            finish()
            return
        }
        // Rotation can receive the outstanding result, but must not launch a second dialog.
        if (projectionRequested) return
        // A stale intent, restored task or service launch has no current in-memory click ticket.
        if (!ProjectionConsentGate.consume(intent.getStringExtra(EXTRA_CLICK_TICKET)) ||
            CaptureMode.get(this) != CaptureMode.PROJECTION) {
            finish()
            return
        }
        requestProjection()
    }

    override fun onSaveInstanceState(outState: Bundle) {
        outState.putBoolean(STATE_REQUESTED, projectionRequested)
        super.onSaveInstanceState(outState)
    }

    private fun requestProjection() {
        if (projectionRequested || ProjectionCaptureService.isActive()) return
        projectionRequested = true
        val manager = getSystemService(MediaProjectionManager::class.java)
        projectionConsent.launch(if (Build.VERSION.SDK_INT >= 34)
            manager.createScreenCaptureIntent(MediaProjectionConfig.createConfigForDefaultDisplay())
        else manager.createScreenCaptureIntent())
    }

    companion object {
        private const val STATE_REQUESTED = "projection_requested"
        private const val EXTRA_CLICK_TICKET = "projection_click_ticket"

        // Activity-only entry point: background services cannot call this using their context.
        fun request(activity: Activity) {
            if (activity.isFinishing || activity.isDestroyed || ProjectionCaptureService.isActive()) return
            val ticket = ProjectionConsentGate.issue()
            try {
                activity.startActivity(
                    Intent(activity, ProjectionActivity::class.java)
                        .putExtra(EXTRA_CLICK_TICKET, ticket)
                )
            } catch (error: RuntimeException) {
                ProjectionConsentGate.cancel()
                throw error
            }
        }
    }
}
