package com.pnovi.saitgil.vision

import android.Manifest
import android.util.Log
import com.getcapacitor.JSObject
import com.getcapacitor.PermissionState
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.CapacitorPlugin
import com.getcapacitor.annotation.Permission
import com.getcapacitor.annotation.PermissionCallback
import com.pnovi.saitgil.BuildConfig

/**
 * 카메라 인파 인식을 화면(React)에 이어 주는 플러그인.
 * start 하면 카메라 권한을 받아 후면 카메라를 켜고, 프레임을 분석기로 넘긴다. 모델이 붙기 전에는 결과를 보내지 않는다.
 * 영상은 이 플러그인 밖으로 나가지 않고, 추론 결과만 이벤트(crowdState, alert)로 화면에 넘긴다.
 */
@CapacitorPlugin(
    name = "SaitgilVision",
    permissions = [Permission(alias = SaitgilVisionPlugin.CAMERA, strings = [Manifest.permission.CAMERA])],
)
class SaitgilVisionPlugin : Plugin() {
    private var running = false
    private var camera: CameraSession? = null
    private var preview: DebugPreview? = null

    // 카메라 판정이 붙으면 모드별 인식과 알림 기준에 쓴다.
    private var mode = VisionMode.CROWD
    private var sensitivity = CrowdSensitivity.NORMAL

    @PluginMethod
    fun start(call: PluginCall) {
        val requested = call.getString("sensitivity")
        if (requested != null) {
            sensitivity = CrowdSensitivity.fromWire(requested)
                ?: return call.reject("지원하지 않는 민감도입니다: $requested")
        }
        if (getPermissionState(CAMERA) == PermissionState.GRANTED) {
            startCamera(call)
        } else {
            requestPermissionForAlias(CAMERA, call, "cameraPermissionResult")
        }
    }

    @PermissionCallback
    private fun cameraPermissionResult(call: PluginCall) {
        if (getPermissionState(CAMERA) == PermissionState.GRANTED) {
            startCamera(call)
        } else {
            call.reject(CAMERA_DENIED)
        }
    }

    // 미리보기 뷰를 만들고 보여 주는 일이 있어 메인 스레드에서 처리한다.
    private fun startCamera(call: PluginCall) = activity.runOnUiThread {
        if (BuildConfig.VISION_PREVIEW && preview == null) {
            preview = DebugPreview(activity)
        }
        val session = camera
            ?: CameraSession(context, activity, NO_MODEL, ::emitCrowdState, preview?.view).also { camera = it }
        session.start(
            onStarted = {
                running = true
                preview?.show()
                call.resolve()
            },
            onFailed = { error ->
                // CameraX 원문 오류는 로그에만 남기고 화면에는 안내 문장을 보낸다.
                Log.w(TAG, "카메라를 켜지 못했습니다", error)
                call.reject(CAMERA_FAILED)
            },
        )
    }

    @PluginMethod
    fun stop(call: PluginCall) {
        running = false
        camera?.stop()
        activity.runOnUiThread { preview?.hide() }
        call.resolve()
    }

    @PluginMethod
    fun setMode(call: PluginCall) {
        val requested = call.getString("mode")
        mode = VisionMode.fromWire(requested)
            ?: return call.reject("지원하지 않는 모드입니다: $requested")
        call.resolve(JSObject().put("mode", mode.wire))
    }

    override fun handleOnDestroy() {
        running = false
        camera?.close()
        camera = null
        preview?.remove()
        preview = null
        super.handleOnDestroy()
    }

    private fun emitCrowdState(frame: CrowdFrame) {
        if (running) notifyListeners("crowdState", frame.toJs())
    }

    private fun emitAlert(alert: VisionAlert) {
        if (running) notifyListeners("alert", alert.toJs())
    }

    companion object {
        const val CAMERA = "camera"
        private const val TAG = "SaitgilVision"
        private const val CAMERA_DENIED =
            "카메라 권한이 꺼져 있어 주변 인파를 알릴 수 없습니다. 설정에서 사잇길의 카메라 권한을 허용하세요."
        private const val CAMERA_FAILED = "카메라를 켜지 못해 주변 인파를 알릴 수 없습니다."
    }
}
