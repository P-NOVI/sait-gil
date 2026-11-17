package com.pnovi.saitgil.vision

import android.os.Handler
import android.os.Looper

// 확인용, 머지 전 제거.
// 실제 카메라 인식이 붙기 전에 값이 화면까지 오는지 실기기에서 보려고 가짜 값을 일정 간격으로 보낸다.
// 확인이 끝나면 이 파일과 SaitgilVisionPlugin 의 fake 표시 줄을 함께 지운다.
class FakeVisionTicker(
    private val onFrame: (CrowdFrame) -> Unit,
    private val onAlert: (VisionAlert) -> Unit,
) {
    private val handler = Handler(Looper.getMainLooper())
    private var active = false
    private var index = 0

    private val tick = object : Runnable {
        override fun run() {
            if (!active) return
            val frame = FRAMES[index % FRAMES.size]
            index += 1
            onFrame(frame)
            if (frame.level == CrowdLevel.DANGER) {
                onAlert(VisionAlert(AlertKind.DANGER, "바로 앞에 사람"))
            }
            handler.postDelayed(this, INTERVAL_MS)
        }
    }

    fun start() {
        if (active) return
        active = true
        index = 0
        handler.post(tick)
    }

    fun stop() {
        active = false
        handler.removeCallbacks(tick)
    }

    private companion object {
        const val INTERVAL_MS = 2000L

        // 여유 -> 주의 -> 혼잡 -> 위험 -> 판단 불가 순으로 돈다.
        val FRAMES = listOf(
            CrowdFrame(CrowdLevel.CLEAR, null, listOf(11, 12, 1)),
            CrowdFrame(CrowdLevel.CAUTION, 2.8, listOf(11, 12)),
            CrowdFrame(CrowdLevel.CROWDED, 2.1, listOf(11)),
            CrowdFrame(CrowdLevel.DANGER, 1.2, emptyList()),
            CrowdFrame(CrowdLevel.UNKNOWN, null, emptyList()),
        )
    }
}
