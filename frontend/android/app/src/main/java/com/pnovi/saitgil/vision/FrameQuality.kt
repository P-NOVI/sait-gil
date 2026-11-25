package com.pnovi.saitgil.vision

// 카메라가 가려지거나 심하게 흔들려 모델이 아무것도 못 보는 프레임을 가려낸다(#170).
// 박스가 0개인 프레임을 "사람 없음"으로 읽으면 가려진 채로 "여유"가 나가므로, 화면 자체가 쓸 만한지 따로 본다.

import kotlin.math.abs
import kotlin.math.sqrt

private const val RED_SHIFT = 16
private const val GREEN_SHIFT = 8
private const val CHANNEL_MASK = 0xFF
private const val LUMA_RED = 0.299
private const val LUMA_GREEN = 0.587
private const val LUMA_BLUE = 0.114

/** 한 프레임의 밝기 통계. 밝기는 0~255 이다 */
data class FrameStats(val meanLuma: Double, val lumaStd: Double, val sharpness: Double)

private fun lumaAt(pixel: Int): Double {
    val red = (pixel shr RED_SHIFT) and CHANNEL_MASK
    val green = (pixel shr GREEN_SHIFT) and CHANNEL_MASK
    val blue = pixel and CHANNEL_MASK
    return LUMA_RED * red + LUMA_GREEN * green + LUMA_BLUE * blue
}

/**
 * size×size ARGB 픽셀 중 [left, right)×[top, bottom) 영역의 밝기 평균·표준편차·선명도를 잰다.
 * step 칸마다 하나만 본다. 선명도는 오른쪽·아래 이웃과 밝기 차이의 평균이며, 흐리거나 단색이면 작다.
 * 레터박스 여백은 늘 같은 회색이라 영역에서 빼야 가림이 여백에 묻히지 않는다. 영역이 비면 null 이다
 */
fun frameStats(pixels: IntArray, size: Int, left: Int, top: Int, right: Int, bottom: Int, step: Int): FrameStats? {
    val xEnd = right.coerceAtMost(size) - 1
    val yEnd = bottom.coerceAtMost(size) - 1
    var count = 0
    var sum = 0.0
    var sumSquares = 0.0
    var gradientSum = 0.0
    var y = top.coerceAtLeast(0)
    while (y < yEnd) {
        var x = left.coerceAtLeast(0)
        while (x < xEnd) {
            val luma = lumaAt(pixels[y * size + x])
            sum += luma
            sumSquares += luma * luma
            gradientSum += abs(lumaAt(pixels[y * size + x + 1]) - luma) + abs(lumaAt(pixels[(y + 1) * size + x]) - luma)
            count += 1
            x += step
        }
        y += step
    }
    if (count == 0) return null
    val mean = sum / count
    val variance = (sumSquares / count - mean * mean).coerceAtLeast(0.0)
    return FrameStats(mean, sqrt(variance), gradientSum / count)
}

/** 너무 어둡거나 단색이거나 흐려서 사람 박스가 없어도 "비었다"고 믿을 수 없는 프레임인지 */
fun isUnreliable(stats: FrameStats, config: DetectorConfig): Boolean =
    stats.meanLuma < config.coveredMeanLumaMax ||
        stats.lumaStd < config.coveredLumaStdMax ||
        stats.sharpness < config.blurSharpnessMin
