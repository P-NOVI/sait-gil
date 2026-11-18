package com.pnovi.saitgil.vision

import com.getcapacitor.JSObject
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.CapacitorPlugin

/**
 * 카메라 인파 인식을 화면(React)에 이어 주는 플러그인.
 * 지금은 뼈대라 카메라·모델 없이 명령만 받고, 이벤트는 아직 보내지 않는다.
 * 영상은 이 플러그인 밖으로 나가지 않고, 추론 결과만 이벤트(crowdState, alert)로 화면에 넘긴다.
 */
@CapacitorPlugin(name = "SaitgilVision")
class SaitgilVisionPlugin : Plugin() {
    private var running = false

    // 카메라 판정이 붙으면 모드별 인식과 알림 기준에 쓴다.
    private var mode = VisionMode.CROWD
    private var sensitivity = CrowdSensitivity.NORMAL

    // 안내마다 새로 만들어 지난 안내의 사람 추적을 이어 쓰지 않는다.
    private var analyzer = CrowdAnalyzer()

    @PluginMethod
    fun start(call: PluginCall) {
        val requested = call.getString("sensitivity")
        if (requested != null) {
            sensitivity = CrowdSensitivity.fromWire(requested)
                ?: return call.reject("지원하지 않는 민감도입니다: $requested")
        }
        analyzer = CrowdAnalyzer()
        running = true
        // TODO: 모델이 나오면 CameraX 로 카메라를 열고, LiteRT 추론 결과(person 박스)를 onDetections 로 넘긴다.
        call.resolve()
    }

    @PluginMethod
    fun stop(call: PluginCall) {
        running = false
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
        super.handleOnDestroy()
    }

    /** 추론 한 번의 사람 박스를 판단해 화면으로 보낸다. 카메라 분석 스레드에서 부른다. */
    @Synchronized
    private fun onDetections(frame: DetectionFrame) {
        if (!running) return
        val result = analyzer.analyze(frame)
        emitCrowdState(result.frame)
        result.alert?.let(::emitAlert)
    }

    private fun emitCrowdState(frame: CrowdFrame) {
        if (running) notifyListeners("crowdState", frame.toJs())
    }

    private fun emitAlert(alert: VisionAlert) {
        if (running) notifyListeners("alert", alert.toJs())
    }
}
