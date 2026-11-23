package com.pnovi.saitgil.audio

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.media.AudioDeviceInfo
import android.media.AudioManager
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.os.SystemClock
import android.util.Log
import androidx.annotation.RequiresApi
import androidx.core.content.ContextCompat

/**
 * 블루투스 이어폰 마이크 연결(SCO).
 * Android 음성 인식기는 마이크를 고르지 않아, 이 연결을 켜야 블루투스 이어폰 마이크로 듣는다.
 * Android 12 이상은 통화 장치를 이어폰으로 고르고(setCommunicationDevice), 그 아래는 SCO 를 직접 켠다.
 * 메인 스레드에서만 쓴다.
 */
internal class BluetoothMic(
    private val context: Context,
    private val audio: AudioManager,
) {
    private val main = Handler(Looper.getMainLooper())

    // 연결을 켰는지. 켠 것은 stop 으로 되돌린다.
    private var active = false
    private var connected = false

    // 연결되기를 기다리는 쪽. 기다리지 않으면 null
    private var waiting: ((Boolean) -> Unit)? = null
    private var startedAtMs = 0L
    private var timeoutMs = 0L
    private val timeout = Runnable {
        Log.w(TAG, "블루투스 마이크를 ${timeoutMs}ms 안에 연결하지 못해 폰 마이크로 듣습니다")
        finish(false)
    }

    // Android 11 이하: SCO 상태 방송을 받는다.
    private var scoReceiver: BroadcastReceiver? = null

    // Android 12 이상: AudioManager.OnCommunicationDeviceChangedListener. 아래 버전에는 없는 타입이라 Any 로 둔다.
    private var deviceListener: Any? = null

    /**
     * 블루투스 이어폰 마이크로 바꾼다. 연결되면 done(true).
     * 이어폰이 없거나 timeoutMs 안에 연결되지 않으면 되돌리고 done(false) 로 폰 마이크로 듣게 한다.
     */
    fun start(timeoutMs: Long, done: (Boolean) -> Unit) {
        when {
            connected -> {
                done(true)
                return
            }
            waiting != null -> {
                // 앞서 기다리던 쪽은 폰 마이크로 듣게 하고, 같은 연결을 이어서 기다린다.
                waiting?.invoke(false)
                waiting = done
                return
            }
            // 켜 둔 연결이 끊겼으면 정리하고 다시 켠다.
            active -> stop()
        }
        val started = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            startCommunicationDevice()
        } else {
            startSco()
        }
        if (!started) {
            Log.i(TAG, "블루투스 이어폰 마이크가 없어 폰 마이크로 듣습니다")
            done(false)
            return
        }
        active = true
        waiting = done
        startedAtMs = SystemClock.elapsedRealtime()
        this.timeoutMs = timeoutMs
        main.postDelayed(timeout, timeoutMs)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S && bluetoothIsCommunicationDevice()) {
            onConnected()
        }
    }

    /** 원래 마이크로 되돌린다. 기다리던 쪽은 폰 마이크로 듣게 한다. */
    fun stop() {
        main.removeCallbacks(timeout)
        waiting?.let {
            waiting = null
            it(false)
        }
        if (!active) {
            return
        }
        active = false
        connected = false
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            stopCommunicationDevice()
        } else {
            stopSco()
        }
    }

    private fun onConnected() {
        if (!active || connected) {
            return
        }
        connected = true
        Log.i(TAG, "블루투스 마이크를 연결했습니다 (${SystemClock.elapsedRealtime() - startedAtMs}ms)")
        finish(true)
    }

    private fun finish(ok: Boolean) {
        main.removeCallbacks(timeout)
        val done = waiting
        waiting = null
        if (!ok) {
            stop()
        }
        done?.invoke(ok)
    }

    @Suppress("DEPRECATION")
    private fun startSco(): Boolean {
        val hasInput = audio.getDevices(AudioManager.GET_DEVICES_INPUTS)
            .any { it.type == AudioDeviceInfo.TYPE_BLUETOOTH_SCO }
        if (!audio.isBluetoothScoAvailableOffCall || !hasInput) {
            return false
        }
        val receiver = object : BroadcastReceiver() {
            override fun onReceive(context: Context, intent: Intent) {
                // 등록하자마자 오는 지난 상태는 이번 연결과 상관없다.
                if (isInitialStickyBroadcast) {
                    return
                }
                when (intent.getIntExtra(AudioManager.EXTRA_SCO_AUDIO_STATE, AudioManager.SCO_AUDIO_STATE_ERROR)) {
                    AudioManager.SCO_AUDIO_STATE_CONNECTED -> {
                        audio.isBluetoothScoOn = true
                        onConnected()
                    }
                    AudioManager.SCO_AUDIO_STATE_DISCONNECTED -> connected = false
                }
            }
        }
        ContextCompat.registerReceiver(
            context,
            receiver,
            IntentFilter(AudioManager.ACTION_SCO_AUDIO_STATE_UPDATED),
            ContextCompat.RECEIVER_NOT_EXPORTED,
        )
        scoReceiver = receiver
        audio.startBluetoothSco()
        return true
    }

    @Suppress("DEPRECATION")
    private fun stopSco() {
        scoReceiver?.let { context.unregisterReceiver(it) }
        scoReceiver = null
        audio.isBluetoothScoOn = false
        audio.stopBluetoothSco()
    }

    @RequiresApi(Build.VERSION_CODES.S)
    private fun startCommunicationDevice(): Boolean {
        val device = audio.availableCommunicationDevices
            .firstOrNull { it.type == AudioDeviceInfo.TYPE_BLUETOOTH_SCO }
            ?: return false
        val listener = AudioManager.OnCommunicationDeviceChangedListener { changed ->
            if (changed?.type == AudioDeviceInfo.TYPE_BLUETOOTH_SCO) {
                onConnected()
            } else if (connected) {
                connected = false
            }
        }
        audio.addOnCommunicationDeviceChangedListener(context.mainExecutor, listener)
        if (!audio.setCommunicationDevice(device)) {
            audio.removeOnCommunicationDeviceChangedListener(listener)
            return false
        }
        deviceListener = listener
        return true
    }

    @RequiresApi(Build.VERSION_CODES.S)
    private fun stopCommunicationDevice() {
        (deviceListener as? AudioManager.OnCommunicationDeviceChangedListener)?.let {
            audio.removeOnCommunicationDeviceChangedListener(it)
        }
        deviceListener = null
        audio.clearCommunicationDevice()
    }

    @RequiresApi(Build.VERSION_CODES.S)
    private fun bluetoothIsCommunicationDevice(): Boolean =
        audio.communicationDevice?.type == AudioDeviceInfo.TYPE_BLUETOOTH_SCO

    companion object {
        private const val TAG = "SaitgilAudio"
    }
}
