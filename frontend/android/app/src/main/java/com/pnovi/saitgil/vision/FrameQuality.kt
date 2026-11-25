package com.pnovi.saitgil.vision

// 카메라 프레임이 주변을 판단할 만한지 본다(#170). 어둡거나, 한 색으로 덮였거나(렌즈 가림), 흐리면(흔들림 포함) 판단 불가로 본다.
// 모델 입력으로 이미 읽은 픽셀(ARGB)로 재므로 Android 클래스를 쓰지 않아 JVM 단위 테스트를 할 수 있다.

import kotlin.math.sqrt

/** 프레임 화질. OK 가 아니면 사람이 안 보여도 여유로 보지 않는다 */
enum class FrameQuality(val wire: String) {
    OK("ok"),
    DARK("dark"),
    COVERED("covered"),
    BLURRY("blurry"),
}

/** 프레임 밝기 평균·표준편차(0~255)와 선명도(라플라시안 분산). 기준값을 실기기 로그로 맞출 때도 쓴다 */
data class QualityStats(val meanLuma: Double, val stdLuma: Double, val sharpness: Double)

/** ARGB 픽셀의 밝기(0~255, BT.601) */
private fun luma(pixel: Int): Double {
    val red = (pixel shr 16) and 0xFF
    val green = (pixel shr 8) and 0xFF
    val blue = pixel and 0xFF
    return 0.299 * red + 0.587 * green + 0.114 * blue
}

/**
 * 가로 width 인 pixels 에서 [left, right) × [top, bottom) 칸을 step 간격으로 재어 밝기와 선명도를 구한다.
 * 레터박스 여백은 한 색이라 가림으로 보이므로 영상이 그려진 칸만 준다.
 * 선명도는 step 떨어진 위아래·좌우 픽셀로 낸 라플라시안의 분산이다. 흐리면 가장자리가 뭉개져 작아진다.
 */
fun measureQuality(
    pixels: IntArray,
    width: Int,
    left: Int,
    top: Int,
    right: Int,
    bottom: Int,
    step: Int,
): QualityStats {
    var count = 0
    var lumaSum = 0.0
    var lumaSquares = 0.0
    var lapSum = 0.0
    var lapSquares = 0.0
    var y = top + step
    while (y < bottom - step) {
        var x = left + step
        while (x < right - step) {
            val center = luma(pixels[y * width + x])
            val laplacian = 4 * center -
                luma(pixels[y * width + x - step]) -
                luma(pixels[y * width + x + step]) -
                luma(pixels[(y - step) * width + x]) -
                luma(pixels[(y + step) * width + x])
            count += 1
            lumaSum += center
            lumaSquares += center * center
            lapSum += laplacian
            lapSquares += laplacian * laplacian
            x += step
        }
        y += step
    }
    if (count == 0) return QualityStats(0.0, 0.0, 0.0)
    val mean = lumaSum / count
    val lapMean = lapSum / count
    return QualityStats(
        meanLuma = mean,
        stdLuma = sqrt(maxOf(0.0, lumaSquares / count - mean * mean)),
        sharpness = maxOf(0.0, lapSquares / count - lapMean * lapMean),
    )
}

/** 화질 판정. 어두움을 먼저 보고, 밝아도 한 색이면 가림, 무늬가 있어도 뭉개졌으면 흐림이다 */
fun judgeQuality(stats: QualityStats, config: DetectorConfig): FrameQuality = when {
    stats.meanLuma < config.darkMeanLuma -> FrameQuality.DARK
    stats.stdLuma < config.coveredStdLuma -> FrameQuality.COVERED
    stats.sharpness < config.blurSharpness -> FrameQuality.BLURRY
    else -> FrameQuality.OK
}
