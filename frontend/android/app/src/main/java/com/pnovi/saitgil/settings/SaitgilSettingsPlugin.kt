package com.pnovi.saitgil.settings

import android.content.Intent
import android.net.Uri
import android.provider.Settings
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
        activity.startActivity(intent)
        call.resolve()
    }
}
