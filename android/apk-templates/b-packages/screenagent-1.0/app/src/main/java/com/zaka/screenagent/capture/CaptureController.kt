package com.zaka.screenagent.capture

import android.annotation.SuppressLint
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
import android.util.Log
import com.zaka.screenagent.AgentConfig
import java.io.ByteArrayOutputStream
import java.io.File

/**
 * 屏幕采集控制器 —— 本模板唯一的「干活」模块。
 *
 * 原理：MediaProjection（系统录屏授权）→ VirtualDisplay + ImageReader
 *       → 拿到 RGBA_8888 帧 → 裁剪行距 → 缩放 → 压 JPEG。
 *
 * 刻意不做的事：不做无障碍、不做输入注入、不做文件遍历、不做通讯录/短信，
 * 只做「把屏幕画面取出来」这一件事。
 */
class CaptureController(private val ctx: Context) {

    private val cfg: AgentConfig = AgentConfig.get(ctx)
    private val main = Handler(Looper.getMainLooper())

    private var projection: MediaProjection? = null
    private var display: VirtualDisplay? = null
    private var reader: ImageReader? = null

    var width = 0; private set
    var height = 0; private set
    var density = 0; private set

    val isReady: Boolean get() = projection != null && reader != null

    @SuppressLint("WrongConstant")
    fun start(mediaProjection: MediaProjection, w: Int, h: Int, dpi: Int): Boolean {
        stop()
        return try {
            width = w; height = h; density = dpi

            projection = mediaProjection
            // Android 14 起：必须在 createVirtualDisplay 之前注册回调，否则抛异常
            mediaProjection.registerCallback(object : MediaProjection.Callback() {
                override fun onStop() {
                    Log.i(TAG, "projection stopped by system")
                    stop()
                }
            }, main)

            val ir = ImageReader.newInstance(w, h, PixelFormat.RGBA_8888, 2)
            reader = ir

            val dm = ctx.getSystemService(Context.DISPLAY_SERVICE) as DisplayManager
            display = projection!!.createVirtualDisplay(
                "sa-display",
                w, h, dpi,
                DisplayManager.VIRTUAL_DISPLAY_FLAG_AUTO_MIRROR,
                ir.surface, null, main
            )
            Log.i(TAG, "capture ready ${w}x$h @${dpi}dpi")
            true
        } catch (t: Throwable) {
            Log.e(TAG, "start failed: ${t.message}")
            stop()
            false
        }
    }

    /**
     * 抓一帧并编码成 JPEG。
     * @return JPEG 字节；取不到帧返回 null
     */
    fun grabJpeg(outFile: File? = null): ByteArray? {
        val ir = reader ?: return null
        var image: Image? = null
        var bitmap: Bitmap? = null
        return try {
            image = ir.acquireLatestImage() ?: return null
            bitmap = toBitmap(image) ?: return null

            val scaled = scaleDown(bitmap, cfg.captureMaxWidth)
            val bos = ByteArrayOutputStream()
            scaled.compress(Bitmap.CompressFormat.JPEG, cfg.captureQuality, bos)
            if (scaled !== bitmap) scaled.recycle()

            val bytes = bos.toByteArray()
            if (outFile != null) runCatching { outFile.writeBytes(bytes) }
            bytes
        } catch (t: Throwable) {
            Log.w(TAG, "grab failed: ${t.message}")
            null
        } finally {
            runCatching { image?.close() }
            runCatching { bitmap?.recycle() }
        }
    }

    private fun toBitmap(image: Image): Bitmap? {
        val plane = image.planes.firstOrNull() ?: return null
        val buffer = plane.buffer
        val pixelStride = plane.pixelStride
        val rowStride = plane.rowStride
        val rowPadding = rowStride - pixelStride * image.width
        val bmpWidth = image.width + rowPadding / pixelStride

        val full = Bitmap.createBitmap(bmpWidth, image.height, Bitmap.Config.ARGB_8888)
        full.copyPixelsFromBuffer(buffer)

        return if (bmpWidth != image.width) {
            val cropped = Bitmap.createBitmap(full, 0, 0, image.width, image.height)
            full.recycle()
            cropped
        } else full
    }

    private fun scaleDown(src: Bitmap, maxWidth: Int): Bitmap {
        if (maxWidth <= 0 || src.width <= maxWidth) return src
        val ratio = maxWidth.toFloat() / src.width
        val h = (src.height * ratio).toInt().coerceAtLeast(1)
        return Bitmap.createScaledBitmap(src, maxWidth, h, true)
    }

    fun stop() {
        runCatching { display?.release() }
        runCatching { reader?.close() }
        runCatching { projection?.stop() }
        display = null; reader = null; projection = null
    }

    companion object {
        private const val TAG = "CaptureController"
    }
}
