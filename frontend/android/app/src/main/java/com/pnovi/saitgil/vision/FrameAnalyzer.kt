package com.pnovi.saitgil.vision

import androidx.camera.core.ImageProxy

/**
 * 카메라 프레임 한 장을 인파 결과로 바꾼다. 판단할 근거가 없으면 null 을 돌려 아무것도 보내지 않는다.
 * 프레임은 부르는 쪽이 닫으므로 여기서 닫지 않는다.
 */
fun interface FrameAnalyzer {
    fun analyze(image: ImageProxy): CrowdFrame?
}

/**
 * 모델(YOLO26n)이 붙기 전 분석기. 프레임을 받기만 하고 결과는 보내지 않는다.
 * 판단 불가(unknown)를 보내면 화면이 "주변을 인식할 수 없습니다"라고 잘못 읽으므로 null 을 돌려준다.
 */
val NO_MODEL = FrameAnalyzer { null }
