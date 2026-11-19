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
 * 돌아왔는지는 화면(웹)이 visibilitychange 로 안다.
 */
@CapacitorPlugin(name = "SaitgilSettings")
class SaitgilSettingsPlugin : Plugin() {
    @PluginMethod
    fun openAppSettings(call: PluginCall) {
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
            return
        }
        call.resolve()
    }

    companion object {
        private const val TAG = "SaitgilSettings"
        private const val SETTINGS_FAILED = "앱 설정 화면을 열지 못했습니다."
    }
}
