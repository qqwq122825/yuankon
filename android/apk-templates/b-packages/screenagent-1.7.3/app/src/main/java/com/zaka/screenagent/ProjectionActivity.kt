package com.zaka.screenagent

import android.app.Activity
import android.content.Context
import android.content.Intent
import android.media.projection.MediaProjectionManager
import android.os.Bundle
import androidx.activity.result.contract.ActivityResultContracts
import androidx.appcompat.app.AppCompatActivity
import com.zaka.screenagent.capture.ProjectionCaptureService

/**
 * Transparent bridge to Android's required MediaProjection consent UI.
 *
 * The B package has no launcher or custom page. Enabling its accessibility service starts this
 * internal activity, which directly launches createScreenCaptureIntent(). The Android system
 * confirmation remains visible and
 * cannot be replaced or bypassed by an app.
 */
class ProjectionActivity : AppCompatActivity() {
    private var projectionRequested = false

    private val projectionConsent = registerForActivityResult(
        ActivityResultContracts.StartActivityForResult()
    ) { result ->
        val data = result.data
        if (result.resultCode == Activity.RESULT_OK && data != null)
            ProjectionCaptureService.start(this, result.resultCode, data)
        finishAndRemoveTask()
    }

    override fun onCreate(state: Bundle?) {
        super.onCreate(state)
        projectionRequested = state?.getBoolean(STATE_REQUESTED) == true
        if (ProjectionCaptureService.isActive()) finishAndRemoveTask()
        else if (!projectionRequested) requestProjection()
    }

    override fun onSaveInstanceState(outState: Bundle) {
        outState.putBoolean(STATE_REQUESTED, projectionRequested)
        super.onSaveInstanceState(outState)
    }

    private fun requestProjection() {
        if (projectionRequested || ProjectionCaptureService.isActive()) {
            finishAndRemoveTask()
            return
        }
        projectionRequested = true
        val manager = getSystemService(MediaProjectionManager::class.java)
        projectionConsent.launch(manager.createScreenCaptureIntent())
    }

    companion object {
        private const val STATE_REQUESTED = "projection_requested"

        fun request(context: Context) {
            if (ProjectionCaptureService.isActive()) return
            context.startActivity(
                Intent(context, ProjectionActivity::class.java)
                    .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP)
            )
        }
    }
}
