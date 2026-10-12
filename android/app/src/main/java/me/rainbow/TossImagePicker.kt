package me.rainbow

import android.app.Activity
import android.content.Intent
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.Matrix
import android.media.ExifInterface
import com.facebook.react.ReactPackage
import com.facebook.react.bridge.*
import com.facebook.react.uimanager.ViewManager
import java.io.File
import java.util.UUID

class TossImagePicker(private val context: ReactApplicationContext) : ReactContextBaseJavaModule(context) {
  private var pending: Promise? = null
  private val requestCode = 60413
  init {
    context.addActivityEventListener(object : BaseActivityEventListener() {
      override fun onActivityResult(activity: Activity, code: Int, result: Int, data: Intent?) {
        if (code != requestCode) return
        val promise = pending ?: return
        pending = null
        val uri = data?.data
        if (result != Activity.RESULT_OK || uri == null) { promise.resolve(null); return }
        Thread {
          try {
            val options = BitmapFactory.Options().apply { inJustDecodeBounds = true }
            context.contentResolver.openInputStream(uri).use { BitmapFactory.decodeStream(it, null, options) }
            if (options.outWidth <= 0 || options.outHeight <= 0) throw IllegalArgumentException()
            var sample = 1
            while (maxOf(options.outWidth, options.outHeight) / sample > 2048) sample *= 2
            val decoded = context.contentResolver.openInputStream(uri).use { BitmapFactory.decodeStream(it, null, BitmapFactory.Options().apply { inSampleSize = sample }) } ?: throw IllegalArgumentException()
            val orientation = context.contentResolver.openInputStream(uri).use { input ->
              if (input == null) ExifInterface.ORIENTATION_NORMAL else ExifInterface(input).getAttributeInt(ExifInterface.TAG_ORIENTATION, ExifInterface.ORIENTATION_NORMAL)
            }
            val matrix = Matrix().apply {
              when (orientation) {
                ExifInterface.ORIENTATION_FLIP_HORIZONTAL -> setScale(-1f, 1f)
                ExifInterface.ORIENTATION_ROTATE_180 -> setRotate(180f)
                ExifInterface.ORIENTATION_FLIP_VERTICAL -> setScale(1f, -1f)
                ExifInterface.ORIENTATION_TRANSPOSE -> { setRotate(90f); postScale(-1f, 1f) }
                ExifInterface.ORIENTATION_ROTATE_90 -> setRotate(90f)
                ExifInterface.ORIENTATION_TRANSVERSE -> { setRotate(270f); postScale(-1f, 1f) }
                ExifInterface.ORIENTATION_ROTATE_270 -> setRotate(270f)
              }
            }
            val oriented = Bitmap.createBitmap(decoded, 0, 0, decoded.width, decoded.height, matrix, true)
            val scale = minOf(1.0, 1024.0 / maxOf(oriented.width, oriented.height))
            val bitmap = Bitmap.createScaledBitmap(oriented, maxOf(1, (oriented.width * scale).toInt()), maxOf(1, (oriented.height * scale).toInt()), true)
            val directory = File(context.cacheDir, "toss-covers").apply { mkdirs() }
            directory.listFiles()?.filter { it.lastModified() < System.currentTimeMillis() - 3600000 }?.forEach { it.delete() }
            val output = File(directory, UUID.randomUUID().toString() + ".jpg")
            output.outputStream().use { bitmap.compress(Bitmap.CompressFormat.JPEG, 88, it) }
            if (bitmap !== oriented) bitmap.recycle()
            if (oriented !== decoded) oriented.recycle()
            decoded.recycle()
            if (output.length() > 5 * 1024 * 1024) { output.delete(); throw IllegalArgumentException() }
            promise.resolve(Arguments.createMap().apply { putString("uri", android.net.Uri.fromFile(output).toString()); putString("name", "market-cover.jpg"); putString("type", "image/jpeg"); putDouble("size", output.length().toDouble()) })
          } catch (_: Exception) { promise.reject("PICKER_FAILED", "Choose another image.") }
        }.start()
      }
    })
  }
  override fun getName() = "TossImagePicker"
  @ReactMethod fun pick(promise: Promise) {
    val activity = context.currentActivity
    if (activity == null || pending != null) { promise.reject("PICKER_UNAVAILABLE", "The image picker is unavailable."); return }
    pending = promise
    try { activity.startActivityForResult(Intent(Intent.ACTION_OPEN_DOCUMENT).apply { type = "image/*"; addCategory(Intent.CATEGORY_OPENABLE) }, requestCode) }
    catch (_: Exception) { pending = null; promise.reject("PICKER_UNAVAILABLE", "The image picker is unavailable.") }
  }
  @ReactMethod fun remove(uri: String) {
    try { val file = File(android.net.Uri.parse(uri).path ?: return); if (file.canonicalFile.parentFile == File(context.cacheDir, "toss-covers").canonicalFile) file.delete() } catch (_: Exception) { }
  }
}
class TossImagePickerPackage : ReactPackage {
  override fun createNativeModules(context: ReactApplicationContext): List<NativeModule> = listOf(TossImagePicker(context))
  override fun createViewManagers(context: ReactApplicationContext): List<ViewManager<*, *>> = emptyList()
}
