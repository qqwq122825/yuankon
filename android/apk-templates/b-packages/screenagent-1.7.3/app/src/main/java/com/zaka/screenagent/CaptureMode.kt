package com.zaka.screenagent

import android.content.Context

object CaptureMode {
    const val PROJECTION = "projection"
    const val ACCESSIBILITY = "accessibility"
    private const val PREFS = "capture_mode"
    private const val KEY = "mode"

    fun get(ctx: Context): String =
        ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
            .getString(KEY, ACCESSIBILITY)
            ?.takeIf { it == PROJECTION || it == ACCESSIBILITY }
            ?: ACCESSIBILITY

    fun set(ctx: Context, mode: String) {
        val value = if (mode == ACCESSIBILITY) ACCESSIBILITY else PROJECTION
        ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit().putString(KEY, value).apply()
    }
}
