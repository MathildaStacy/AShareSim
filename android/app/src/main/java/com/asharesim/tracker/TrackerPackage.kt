package com.asharesim.tracker

import com.facebook.react.BaseReactPackage
import com.facebook.react.bridge.NativeModule
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.module.model.ReactModuleInfo
import com.facebook.react.module.model.ReactModuleInfoProvider

class TrackerPackage : BaseReactPackage() {
  override fun getModule(name: String, reactContext: ReactApplicationContext): NativeModule? =
    if (name == BackgroundTrackerModule.NAME) BackgroundTrackerModule(reactContext) else null

  override fun getReactModuleInfoProvider() = ReactModuleInfoProvider {
    mapOf(
      BackgroundTrackerModule.NAME to
        ReactModuleInfo(BackgroundTrackerModule.NAME, BackgroundTrackerModule.NAME, false, false, false, true),
    )
  }
}
