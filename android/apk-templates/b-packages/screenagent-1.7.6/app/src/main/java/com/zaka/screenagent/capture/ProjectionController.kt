package com.zaka.screenagent.capture

import android.content.Context
import android.graphics.Bitmap
import android.graphics.PixelFormat
import android.hardware.display.DisplayManager
import android.hardware.display.VirtualDisplay
import android.media.Image
import android.media.ImageReader
import android.media.projection.MediaProjection
import android.os.Handler
import android.os.Looper
import com.zaka.screenagent.AgentConfig
import java.io.ByteArrayOutputStream

/** One MediaProjection session and one VirtualDisplay/ImageReader pipeline. */
class ProjectionController(
    private val context: Context,
    private val stopped: () -> Unit
) {
    private val main = Handler(Looper.getMainLooper())
    private var projection: MediaProjection? = null
    private var display: VirtualDisplay? = null
    private var reader: ImageReader? = null
    private var callback: MediaProjection.Callback? = null

    val ready: Boolean
        @Synchronized get() = projection != null && display != null && reader != null

    @Synchronized
    fun start(mediaProjection: MediaProjection, width: Int, height: Int, densityDpi: Int): Boolean {
        release(stopProjection = true)
        return try {
            val projectionCallback = object : MediaProjection.Callback() {
                override fun onStop() {
                    release(stopProjection = false)
                    stopped()
                }
            }
            mediaProjection.registerCallback(projectionCallback, main)
            callback = projectionCallback
            projection = mediaProjection
            val imageReader = ImageReader.newInstance(width, height, PixelFormat.RGBA_8888, 2)
            reader = imageReader
            display = mediaProjection.createVirtualDisplay(
                "boundary-screen",
                width,
                height,
                densityDpi,
                DisplayManager.VIRTUAL_DISPLAY_FLAG_AUTO_MIRROR,
                imageReader.surface,
                null,
                main
            )
            display != null
        } catch (_: Throwable) {
            release(stopProjection = true)
            false
        }
    }

    @Synchronized
    fun acquireLatestJpeg(): ByteArray? {
        val imageReader = reader ?: return null
        var image: Image? = null
        var bitmap: Bitmap? = null
        var scaled: Bitmap? = null
        return try {
            image = imageReader.acquireLatestImage() ?: return null
            bitmap = imageToBitmap(image) ?: return null
            val cfg = AgentConfig.get(context)
            scaled = if (bitmap.width > cfg.captureMaxWidth) {
                val height = (bitmap.height * cfg.captureMaxWidth.toFloat() / bitmap.width)
                    .toInt().coerceAtLeast(1)
                Bitmap.createScaledBitmap(bitmap, cfg.captureMaxWidth, height, true)
            } else bitmap
            ByteArrayOutputStream().use { out ->
                scaled.compress(Bitmap.CompressFormat.JPEG, cfg.captureQuality, out)
                out.toByteArray()
            }
        } catch (_: Throwable) {
            null
        } finally {
            runCatching { image?.close() }
            if (scaled !== bitmap) runCatching { scaled?.recycle() }
            runCatching { bitmap?.recycle() }
        }
    }

    private fun imageToBitmap(image: Image): Bitmap? {
        val plane = image.planes.firstOrNull() ?: return null
        val pixelStride = plane.pixelStride
        val rowStride = plane.rowStride
        val paddedWidth = image.width + (rowStride - pixelStride * image.width) / pixelStride
        val full = Bitmap.createBitmap(paddedWidth, image.height, Bitmap.Config.ARGB_8888)
        full.copyPixelsFromBuffer(plane.buffer)
        if (paddedWidth == image.width) return full
        val cropped = Bitmap.createBitmap(full, 0, 0, image.width, image.height)
        full.recycle()
        return cropped
    }

    @Synchronized
    fun stop() = release(stopProjection = true)

    private fun release(stopProjection: Boolean) {
        val currentProjection = projection
        val currentCallback = callback
        display?.release()
        reader?.close()
        display = null
        reader = null
        projection = null
        callback = null
        if (currentProjection != null && currentCallback != null)
            runCatching { currentProjection.unregisterCallback(currentCallback) }
        if (stopProjection) runCatching { currentProjection?.stop() }
    }
}
