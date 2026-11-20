package com.pnovi.saitgil.audio

import android.media.AudioManager
import android.os.Handler
import android.os.Looper
import com.getcapacitor.JSObject
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.CapacitorPlugin

/**
 * 음성 명령을 듣는 동안 블루투스 이어폰 마이크로 받게 한다(BluetoothMic).
 * 화면은 듣기 전에 startBluetoothMic, 다 들으면 stopBluetoothMic 을 부른다.
 */
@CapacitorPlugin(name = "SaitgilAudio")
class SaitgilAudioPlugin : Plugin() {
    private val main = Handler(Looper.getMainLooper())
    private val mic by lazy {
        BluetoothMic(context, context.getSystemService(AudioManager::class.java))
    }

    @PluginMethod
    fun startBluetoothMic(call: PluginCall) {
        val timeoutMs = call.getLong("timeoutMs")
        if (timeoutMs == null) {
            call.reject(NO_TIMEOUT)
            return
        }
        main.post {
            mic.start(timeoutMs) { connected ->
                call.resolve(JSObject().put("connected", connected))
            }
        }
    }

    @PluginMethod
    fun stopBluetoothMic(call: PluginCall) {
        main.post {
            mic.stop()
            call.resolve()
        }
    }

    override fun handleOnDestroy() {
        mic.stop()
        super.handleOnDestroy()
    }

    companion object {
        private const val NO_TIMEOUT = "timeoutMs 가 없습니다."
    }
}
