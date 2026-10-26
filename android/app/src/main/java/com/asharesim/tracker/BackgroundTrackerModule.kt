package com.asharesim.tracker

import android.annotation.SuppressLint
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.PowerManager
import android.provider.Settings
import com.asharesim.specs.NativeBackgroundTrackerSpec
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext

class BackgroundTrackerModule(context: ReactApplicationContext) : NativeBackgroundTrackerSpec(context) {
  companion object {
    const val NAME = "BackgroundTracker"
  }

  override fun getName() = NAME

  private fun intent(action: String) =
    Intent(reactApplicationContext, TrackerService::class.java).setAction(action)

  override fun start(title: String, text: String, promise: Promise) {
    try {
      reactApplicationContext.startForegroundService(
        intent(TrackerService.ACTION_START)
          .putExtra(TrackerService.EXTRA_TITLE, title)
          .putExtra(TrackerService.EXTRA_TEXT, text),
      )
      promise.resolve(true)
    } catch (e: Exception) {
      // 例如 App 已经在后台时系统不允许启动前台服务
      promise.reject("TRACKER_START", e.message ?: "启动后台跟踪失败", e)
    }
  }

  override fun update(text: String) {
    if (TrackerService.running) {
      reactApplicationContext.startService(
        intent(TrackerService.ACTION_UPDATE).putExtra(TrackerService.EXTRA_TEXT, text),
      )
    }
  }

  override fun stop() {
    if (TrackerService.running) {
      reactApplicationContext.startService(intent(TrackerService.ACTION_STOP))
    }
  }

  override fun isRunning(promise: Promise) {
    promise.resolve(TrackerService.running)
  }

  override fun userStoppedAt(promise: Promise) {
    val prefs = reactApplicationContext.getSharedPreferences(TrackerService.PREFS, Context.MODE_PRIVATE)
    promise.resolve(prefs.getLong(TrackerService.PREF_USER_STOPPED_AT, 0L).toDouble())
  }

  override fun isIgnoringBatteryOptimizations(promise: Promise) {
    val pm = reactApplicationContext.getSystemService(PowerManager::class.java)
    promise.resolve(pm.isIgnoringBatteryOptimizations(reactApplicationContext.packageName))
  }

  @SuppressLint("BatteryLife")
  override fun requestIgnoreBatteryOptimizations() {
    // 自己装的 App，不上架应用商店，可以直接弹系统对话框
    reactApplicationContext.startActivity(
      Intent(Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS)
        .setData(Uri.parse("package:" + reactApplicationContext.packageName))
        .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK),
    )
  }

  override fun openAppSettings() {
    reactApplicationContext.startActivity(
      Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS)
        .setData(Uri.parse("package:" + reactApplicationContext.packageName))
        .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK),
    )
  }
}
