package com.asharesim.files

import android.content.ClipData
import android.content.Intent
import android.net.Uri
import android.system.ErrnoException
import android.system.Os
import android.system.OsConstants
import android.util.Base64
import androidx.core.content.FileProvider
import com.asharesim.specs.NativeDocumentStoreSpec
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.UiThreadUtil
import java.io.File
import java.io.IOException
import java.util.UUID
import java.util.concurrent.Executors

/**
 * 导出文件：把内容写到 cacheDir/document_exports/<进程会话>/<随机目录>/<文件名>，通过 FileProvider 交给系统分享面板。
 * 只接受文件名和内容（base64），不接受调用方给的路径。移植自 NovelCreationPartner，去掉了选择文件。
 */
class DocumentStoreModule(context: ReactApplicationContext) : NativeDocumentStoreSpec(context) {
  companion object {
    const val NAME = "DocumentStore"
    const val MAX_BYTES = 10 * 1024 * 1024
    private val MIMES = setOf("text/csv", "text/plain", "application/json")
    // React 重新加载时不变，新的 App 进程是新的导出会话
    private val EXPORT_SESSION = UUID.randomUUID().toString()
  }

  private val executor = Executors.newSingleThreadExecutor()
  @Volatile private var invalidated = false
  @Volatile private var exporting = false

  override fun getName() = NAME

  private fun dispatch(promise: Promise, work: () -> Unit) {
    try {
      executor.execute(work)
    } catch (_: Exception) {
      exporting = false
      promise.reject("DOCUMENT_UNAVAILABLE", "Document operation stopped")
    }
  }

  private fun safeName(name: String): String {
    val safe = name
      .map { c -> if (c.code < 32 || c.code == 127 || c in "/\\:*?\"<>|") '_' else c }
      .joinToString("")
      .trimStart('.')
      .trim()
      .ifBlank { "document" }
    return safe.substring(0, safe.offsetByCodePoints(0, minOf(120, safe.codePointCount(0, safe.length))))
  }

  private fun validBase64(value: String): Boolean {
    if (value.length % 4 != 0) return false
    val end = value.length - (if (value.endsWith("==")) 2 else if (value.endsWith("=")) 1 else 0)
    for (i in 0 until end) {
      val c = value[i]
      if (!(c in 'A'..'Z' || c in 'a'..'z' || c in '0'..'9' || c == '+' || c == '/')) return false
    }
    return true
  }

  private fun exportRoot() = File(reactApplicationContext.cacheDir, "document_exports")

  private fun createDirectory(directory: File) {
    if (directory.isDirectory) return
    try {
      Os.mkdir(directory.absolutePath, 448) // 0700
    } catch (error: ErrnoException) {
      if (!directory.isDirectory) throw error
    }
  }

  private fun storageFull(error: Throwable): Boolean {
    var cause: Throwable? = error
    repeat(8) {
      val current = cause ?: return false
      if (current is ErrnoException && current.errno in setOf(OsConstants.ENOSPC, OsConstants.EDQUOT)) return true
      if (current.message?.let {
          Regex("ENOSPC|EDQUOT|No space left on device|Disk quota exceeded", RegexOption.IGNORE_CASE).containsMatchIn(it)
        } == true
      ) return true
      cause = current.cause
    }
    return false
  }

  private fun cleanPreviousExports() {
    val root = exportRoot()
    if (!root.exists()) return
    val sessions = root.listFiles() ?: throw IOException("Could not inspect export cache")
    sessions.filter { it.name != EXPORT_SESSION }.forEach {
      if (!it.deleteRecursively()) throw IOException("Could not clean export cache")
    }
  }

  override fun cleanupExports(promise: Promise) {
    if (invalidated) {
      promise.reject("DOCUMENT_UNAVAILABLE", "Document operation stopped")
      return
    }
    dispatch(promise) {
      try {
        cleanPreviousExports()
        promise.resolve(null)
      } catch (_: Exception) {
        promise.reject("DOCUMENT_UNAVAILABLE", "Could not clean previous export files")
      }
    }
  }

  override fun writeAndShare(name: String, base64: String, mime: String, promise: Promise) {
    synchronized(this) {
      if (invalidated) {
        promise.reject("DOCUMENT_UNAVAILABLE", "Document operation stopped")
        return
      }
      if (exporting) {
        promise.reject("DOCUMENT_BUSY", "Another export is active")
        return
      }
      exporting = true
    }
    dispatch(promise) {
      var folder: File? = null
      try {
        if (invalidated || base64.length > ((MAX_BYTES + 2L) / 3 * 4) || !validBase64(base64)) throw IllegalArgumentException()
        if (mime !in MIMES) throw IllegalArgumentException()
        val bytes = Base64.decode(base64, Base64.NO_WRAP)
        if (bytes.size > MAX_BYTES) throw IllegalArgumentException()
        val root = exportRoot()
        val session = File(root, EXPORT_SESSION)
        val currentFolder = File(session, UUID.randomUUID().toString())
        folder = currentFolder
        createDirectory(root)
        createDirectory(session)
        createDirectory(currentFolder)
        val fileName = safeName(name)
        val file = File(currentFolder, fileName)
        file.outputStream().use { it.write(bytes) }
        val uri: Uri = FileProvider.getUriForFile(
          reactApplicationContext,
          "${reactApplicationContext.packageName}.documents",
          file,
        )
        UiThreadUtil.runOnUiThread {
          val activity = reactApplicationContext.currentActivity
          if (invalidated || activity == null) {
            exporting = false
            currentFolder.deleteRecursively()
            promise.reject("DOCUMENT_UNAVAILABLE", "No foreground activity")
            return@runOnUiThread
          }
          try {
            val send = Intent(Intent.ACTION_SEND).apply {
              type = mime
              putExtra(Intent.EXTRA_STREAM, uri)
              putExtra(Intent.EXTRA_TITLE, fileName)
              clipData = ClipData.newRawUri(fileName, uri)
              addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
            }
            activity.startActivity(
              Intent.createChooser(send, null).addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION),
            )
            exporting = false
            // 能观察到的只有分享面板打开了；用户最后保存还是取消拿不到
            promise.resolve("opened")
          } catch (_: Exception) {
            exporting = false
            currentFolder.deleteRecursively()
            promise.reject("DOCUMENT_UNAVAILABLE", "Could not open system share")
          }
        }
      } catch (error: Exception) {
        folder?.deleteRecursively()
        exporting = false
        if (storageFull(error)) {
          promise.reject("STORAGE_FULL", "Not enough storage to generate export")
        } else {
          promise.reject("DOCUMENT_INVALID", "Could not generate export within 10 MiB limit")
        }
      }
    }
  }

  override fun invalidate() {
    invalidated = true
    executor.shutdown()
    super.invalidate()
  }
}
