package com.zaka.screenagent

import android.app.Activity
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
        title = getString(R.string.mode_title)
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
        listOf(status, projection, accessibility, settings).forEach { view ->
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

    private fun statusText(): String = when (CaptureMode.get(this)) {
        CaptureMode.ACCESSIBILITY -> "当前模式：takeScreenshot"
        else -> "当前模式：MediaProjection"
    }
}
