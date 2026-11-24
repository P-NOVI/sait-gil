package com.pnovi.saitgil.vision

import androidx.camera.core.ImageProxy

/**
 * 카메라 프레임 한 장을 추론해 박스를 뽑는다. 뽑을 수 없으면 null 을 돌려 아무것도 보내지 않는다.
 * 프레임은 부르는 쪽이 닫으므로 여기서 닫지 않는다. 카메라 분석 스레드 하나에서만 부른다.
 */
fun interface FrameAnalyzer {
    fun analyze(image: ImageProxy): DetectionFrame?

    /** 카메라를 다 쓰고 나서 분석 스레드에서 부른다. 모델 같은 자원을 놓는다 */
    fun close() = Unit
}

/**
 * 모델이 없을 때 분석기. 프레임을 받기만 하고 결과는 보내지 않는다.
 * 판단 불가(unknown)를 보내면 화면이 "주변을 인식할 수 없습니다"라고 잘못 읽으므로 null 을 돌려준다.
 */
val NO_MODEL = FrameAnalyzer { null }

/**
 * 첫 프레임이 올 때 모델을 읽는 분석기. 모델을 읽는 동안 메인 스레드를 막지 않도록 분석 스레드에서 읽는다.
 * load 가 null 을 주면(모델 파일 없음 등) NO_MODEL 처럼 결과를 보내지 않는다.
 * asset 이 바뀌면(디버그 빌드에서 비교할 모델을 고름) 다음 프레임에 지난 모델을 닫고 새 모델을 읽는다.
 */
class LazyModelAnalyzer(
    private val asset: () -> String,
    private val load: (String) -> FrameAnalyzer?,
) : FrameAnalyzer {
    private var loadedAsset: String? = null
    private var model: FrameAnalyzer? = null

    override fun analyze(image: ImageProxy): DetectionFrame? {
        val wanted = asset()
        if (wanted != loadedAsset) {
            model?.close()
            model = load(wanted)
            loadedAsset = wanted
        }
        return model?.analyze(image)
    }

    override fun close() {
        model?.close()
    }
}
