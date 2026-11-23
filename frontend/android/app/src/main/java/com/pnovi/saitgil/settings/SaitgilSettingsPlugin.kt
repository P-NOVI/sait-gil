package com.pnovi.saitgil.settings

import android.content.ActivityNotFoundException
import android.content.Intent
import android.net.Uri
import android.provider.Settings
import android.util.Log
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.CapacitorPlugin

/**
 * 사잇길 앱 설정 화면(권한)을 연다.
 * 위치 권한을 거절해 Android 가 더 묻지 않을 때, 사용자가 설정에서 직접 켜도록 한다.
 * 사용자가 앱으로 돌아와 앱이 다시 보이면(onResume) 호출을 끝낸다.
 */
@CapacitorPlugin(name = "SaitgilSettings")
class SaitgilSettingsPlugin : Plugin() {
    // 설정 화면에서 돌아오기를 기다리는 호출. 메인 스레드에서만 읽고 쓴다.
    private var returning: PluginCall? = null

    @PluginMethod
    fun openAppSettings(call: PluginCall) {
        activity.runOnUiThread {
            val intent = Intent(
                Settings.ACTION_APPLICATION_DETAILS_SETTINGS,
                Uri.fromParts("package", context.packageName, null),
            )
            try {
                activity.startActivity(intent)
            } catch (error: ActivityNotFoundException) {
                // 설정 화면이 없는 기기. 화면은 실패를 받으면 열지 않고 다시 찾는다.
                Log.w(TAG, "앱 설정 화면을 열지 못했습니다", error)
                call.reject(SETTINGS_FAILED)
                return@runOnUiThread
            }
            // 앞서 기다리던 호출이 남아 있으면 함께 끝낸다.
            returning?.resolve()
            returning = call
        }
    }

    override fun handleOnResume() {
        returning?.resolve()
        returning = null
    }

    companion object {
        private const val TAG = "SaitgilSettings"
        private const val SETTINGS_FAILED = "앱 설정 화면을 열지 못했습니다."
    }
}
