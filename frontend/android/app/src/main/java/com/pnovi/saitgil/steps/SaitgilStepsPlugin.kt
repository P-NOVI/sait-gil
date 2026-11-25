package com.pnovi.saitgil.steps

import android.Manifest
import android.content.Context
import android.hardware.Sensor
import android.hardware.SensorEvent
import android.hardware.SensorEventListener
import android.hardware.SensorManager
import android.os.Build
import com.getcapacitor.JSObject
import com.getcapacitor.PermissionState
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.CapacitorPlugin
import com.getcapacitor.annotation.Permission
import com.getcapacitor.annotation.PermissionCallback

/**
 * 걸음 수(TYPE_STEP_COUNTER)를 웹으로 넘긴다. 튄 GPS 위치를 거르는 데 쓴다.
 * 걸음 센서는 부팅 뒤 누적 값을 주므로, start 한 뒤 처음 받은 값을 0 으로 잡아 start 이후 걸음 수만 보낸다.
 * 걸음 수만 넘기고 다른 센서 값은 보내지 않는다.
 */
@CapacitorPlugin(
    name = "SaitgilSteps",
    permissions = [
        Permission(
            strings = [Manifest.permission.ACTIVITY_RECOGNITION],
            alias = SaitgilStepsPlugin.ALIAS,
        ),
    ],
)
class SaitgilStepsPlugin : Plugin() {
    private var listener: SensorEventListener? = null

    // 권한 창이 떠 있는 동안 stop 이 먼저 오면 true. 이후 권한을 허용해도 센서를 켜지 않는다.
    private var stopped = false

    /** 걸음 센서를 쓸 수 있는지 돌려준다. 권한이 없으면 묻는다. */
    @PluginMethod
    fun start(call: PluginCall) {
        stopped = false
        if (stepSensor() == null) {
            call.resolve(available(false))
            return
        }
        if (permitted()) {
            listen(call)
        } else {
            requestPermissionForAlias(ALIAS, call, "onPermission")
        }
    }

    @PermissionCallback
    private fun onPermission(call: PluginCall) {
        if (!stopped && permitted()) {
            listen(call)
        } else {
            call.resolve(available(false))
        }
    }

    /** 센서를 켜지 않고 걸음 권한만 묻는다(앱 첫 실행 안내). 허용했거나 권한이 필요 없는 기기면 granted 가 true 다. */
    @PluginMethod
    fun prepare(call: PluginCall) {
        if (permitted()) {
            call.resolve(granted())
        } else {
            requestPermissionForAlias(ALIAS, call, "onPreparePermission")
        }
    }

    @PermissionCallback
    private fun onPreparePermission(call: PluginCall) {
        call.resolve(granted())
    }

    @PluginMethod
    fun stop(call: PluginCall) {
        stopped = true
        unlisten()
        call.resolve()
    }

    override fun handleOnDestroy() {
        unlisten()
    }

    // 걸음 센서는 Android 10(API 29)부터 권한이 필요하고, 그 아래는 권한 없이 쓴다.
    private fun permitted(): Boolean =
        Build.VERSION.SDK_INT < Build.VERSION_CODES.Q ||
            getPermissionState(ALIAS) == PermissionState.GRANTED

    private fun stepSensor(): Sensor? =
        (context.getSystemService(Context.SENSOR_SERVICE) as SensorManager)
            .getDefaultSensor(Sensor.TYPE_STEP_COUNTER)

    private fun listen(call: PluginCall) {
        val sensor = stepSensor()
        if (sensor == null) {
            call.resolve(available(false))
            return
        }
        unlisten()
        val manager = context.getSystemService(Context.SENSOR_SERVICE) as SensorManager
        var baseline: Float? = null
        val next = object : SensorEventListener {
            override fun onSensorChanged(event: SensorEvent) {
                val total = event.values[0]
                val first = baseline ?: total.also { baseline = it }
                notifyListeners("steps", JSObject().put("steps", (total - first).toDouble()))
            }

            override fun onAccuracyChanged(sensor: Sensor, accuracy: Int) = Unit
        }
        listener = next
        manager.registerListener(next, sensor, SensorManager.SENSOR_DELAY_NORMAL)
        call.resolve(available(true))
    }

    private fun unlisten() {
        val current = listener ?: return
        (context.getSystemService(Context.SENSOR_SERVICE) as SensorManager)
            .unregisterListener(current)
        listener = null
    }

    private fun available(value: Boolean): JSObject = JSObject().put("available", value)

    private fun granted(): JSObject = JSObject().put("granted", permitted())

    companion object {
        const val ALIAS = "activity"
    }
}
