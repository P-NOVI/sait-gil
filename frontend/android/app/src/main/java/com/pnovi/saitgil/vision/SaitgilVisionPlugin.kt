package com.pnovi.saitgil.vision

import com.getcapacitor.JSObject
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.CapacitorPlugin

/**
 * 카메라 인파 인식을 화면(React)에 이어 주는 플러그인.
 * 지금은 뼈대라 카메라·모델 없이 명령만 받고, 확인용 가짜 값을 crowdState 로 보낸다.
 * 영상은 이 플러그인 밖으로 나가지 않고, 추론 결과만 이벤트(crowdState, alert)로 화면에 넘긴다.
 */
@CapacitorPlugin(name = "SaitgilVision")
class SaitgilVisionPlugin : Plugin() {
    private var running = false

    // 카메라 판정이 붙으면 모드별 인식과 알림 기준에 쓴다.
    private var mode = VisionMode.CROWD
    private var sensitivity = CrowdSensitivity.NORMAL

    // 확인용, 머지 전 제거
    private val fake = FakeVisionTicker(::emitCrowdState, ::emitAlert)

    @PluginMethod
    fun start(call: PluginCall) {
        val requested = call.getString("sensitivity")
        if (requested != null) {
            sensitivity = CrowdSensitivity.fromWire(requested)
                ?: return call.reject("지원하지 않는 민감도입니다: $requested")
        }
        running = true
        fake.start() // 확인용, 머지 전 제거
        call.resolve()
    }

    @PluginMethod
    fun stop(call: PluginCall) {
        running = false
        fake.stop() // 확인용, 머지 전 제거
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
        fake.stop() // 확인용, 머지 전 제거
        super.handleOnDestroy()
    }

    private fun emitCrowdState(frame: CrowdFrame) {
        if (running) notifyListeners("crowdState", frame.toJs())
    }

    private fun emitAlert(alert: VisionAlert) {
        if (running) notifyListeners("alert", alert.toJs())
    }
}
