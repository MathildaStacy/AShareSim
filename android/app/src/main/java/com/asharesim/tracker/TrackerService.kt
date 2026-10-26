package com.asharesim.tracker

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.Build
import com.asharesim.MainActivity
import com.asharesim.R
import com.facebook.react.HeadlessJsTaskService
import com.facebook.react.bridge.Arguments
import com.facebook.react.jstasks.HeadlessJsTaskConfig
import com.facebook.react.jstasks.HeadlessJsTaskContext

/**
 * 后台跟踪挂单的前台服务。
 *
 * - 类型是 specialUse：Android 15 起 dataSync 类型每 24 小时最多跑 6 小时，盖不住 9:15–15:30。
 * - 继承 HeadlessJsTaskService：有 Headless JS 任务在跑时，RN 的 JS 定时器在后台也照常触发
 *   （JavaTimerManager 只在没有任务时暂停），父类同时持有 CPU 唤醒锁，锁屏也不睡。
 * - 被系统或用户杀掉后不自动重启（START_NOT_STICKY），下次打开 App 用分时数据补撮合。
 * - 通知上有「停止跟踪」：记下时间，JS 当天不再自动开启。
 */
class TrackerService : HeadlessJsTaskService() {
  companion object {
    const val TASK = "AShareSimTracker"
    const val CHANNEL = "tracker"
    const val NOTIFICATION_ID = 1530
    const val ACTION_START = "com.asharesim.tracker.START"
    const val ACTION_UPDATE = "com.asharesim.tracker.UPDATE"
    const val ACTION_STOP = "com.asharesim.tracker.STOP"
    const val ACTION_USER_STOP = "com.asharesim.tracker.USER_STOP"
    const val EXTRA_TITLE = "title"
    const val EXTRA_TEXT = "text"
    const val PREFS = "tracker"
    const val PREF_USER_STOPPED_AT = "userStoppedAt"

    @Volatile var running = false
      private set
  }

  private var title = "AShareSim"
  private var taskId: Int? = null

  override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
    when (intent?.action) {
      ACTION_STOP, ACTION_USER_STOP -> {
        if (intent.action == ACTION_USER_STOP) {
          getSharedPreferences(PREFS, Context.MODE_PRIVATE)
            .edit()
            .putLong(PREF_USER_STOPPED_AT, System.currentTimeMillis())
            .apply()
        }
        shutdown()
        return START_NOT_STICKY
      }
      ACTION_UPDATE -> {
        if (running) {
          notify(intent.getStringExtra(EXTRA_TEXT) ?: "")
        }
        return START_NOT_STICKY
      }
    }
    title = intent?.getStringExtra(EXTRA_TITLE) ?: title
    val notification = build(intent?.getStringExtra(EXTRA_TEXT) ?: "")
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE) {
      startForeground(NOTIFICATION_ID, notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_SPECIAL_USE)
    } else {
      startForeground(NOTIFICATION_ID, notification)
    }
    if (!running) {
      running = true
      super.onStartCommand(intent, flags, startId)
    }
    return START_NOT_STICKY
  }

  override fun getTaskConfig(intent: Intent?): HeadlessJsTaskConfig =
    // 超时 0 表示不限时；allowedInForeground：App 在前台时也跑，前后台切换不用重启任务
    HeadlessJsTaskConfig(TASK, Arguments.createMap(), 0, true)

  override fun onHeadlessJsTaskStart(taskId: Int) {
    super.onHeadlessJsTaskStart(taskId)
    this.taskId = taskId
  }

  override fun onHeadlessJsTaskFinish(taskId: Int) {
    super.onHeadlessJsTaskFinish(taskId)
    shutdown()
  }

  override fun onDestroy() {
    running = false
    super.onDestroy()
  }

  private fun shutdown() {
    running = false
    // 用户在通知上点了停止：结束 JS 任务，JS 定时器在后台恢复暂停
    val id = taskId
    val context = reactContext
    taskId = null
    if (id != null && context != null) {
      val tasks = HeadlessJsTaskContext.getInstance(context)
      if (tasks.isTaskRunning(id)) {
        tasks.finishTask(id)
      }
    }
    stopForeground(STOP_FOREGROUND_REMOVE)
    stopSelf()
  }

  private fun notify(text: String) {
    getSystemService(NotificationManager::class.java).notify(NOTIFICATION_ID, build(text))
  }

  private fun build(text: String): Notification {
    val manager = getSystemService(NotificationManager::class.java)
    if (manager.getNotificationChannel(CHANNEL) == null) {
      manager.createNotificationChannel(
        NotificationChannel(CHANNEL, "后台跟踪挂单", NotificationManager.IMPORTANCE_LOW).apply {
          description = "有未成交委托时在后台继续刷新行情、模拟撮合"
          setShowBadge(false)
        },
      )
    }
    val flags = PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT
    val open = PendingIntent.getActivity(
      this, 0, Intent(this, MainActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP), flags,
    )
    val stop = PendingIntent.getService(
      this, 1, Intent(this, TrackerService::class.java).setAction(ACTION_USER_STOP), flags,
    )
    return Notification.Builder(this, CHANNEL)
      .setSmallIcon(R.mipmap.ic_launcher)
      .setContentTitle(title)
      .setContentText(text)
      .setStyle(Notification.BigTextStyle().bigText(text))
      .setContentIntent(open)
      .setOngoing(true)
      .setOnlyAlertOnce(true)
      .setCategory(Notification.CATEGORY_PROGRESS)
      .addAction(Notification.Action.Builder(null, "停止跟踪", stop).build())
      .build()
  }
}
