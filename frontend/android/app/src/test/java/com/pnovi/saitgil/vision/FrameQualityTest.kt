package com.pnovi.saitgil.vision

import org.junit.Assert.assertEquals
import org.junit.Test

// 가짜 픽셀로 화질 판정을 확인한다. Android 클래스는 쓰지 않는다.
class FrameQualityTest {
    private val config = DetectorConfig()
    private val size = 64

    private fun gray(value: Int): Int = (0xFF shl 24) or (value shl 16) or (value shl 8) or value

    private fun image(shade: (x: Int, y: Int) -> Int): IntArray =
        IntArray(size * size) { index -> gray(shade(index % size, index / size)) }

    private fun judge(pixels: IntArray): FrameQuality =
        judgeQuality(measureQuality(pixels, size, 0, 0, size, size, step = 1), config)

    // 8px 칸마다 밝기가 바뀌는 바둑판. 가장자리가 또렷하다.
    private val checker = image { x, y -> if ((x / 8 + y / 8) % 2 == 0) 40 else 200 }

    @Test
    fun sharpPatternIsOk() {
        assertEquals(FrameQuality.OK, judge(checker))
    }

    @Test
    fun darkFrameIsDark() {
        assertEquals(FrameQuality.DARK, judge(image { x, y -> if ((x / 8 + y / 8) % 2 == 0) 2 else 30 }))
    }

    @Test
    fun evenColorIsCovered() {
        assertEquals(FrameQuality.COVERED, judge(image { _, _ -> 120 }))
    }

    @Test
    fun smoothGradientIsBlurry() {
        // 밝기는 넓게 퍼져 가림은 아니지만, 이웃 픽셀 차이가 고르게 작아 가장자리가 없다.
        assertEquals(FrameQuality.BLURRY, judge(image { x, _ -> 40 + x * 2 }))
    }

    @Test
    fun onlyMeasuresGivenRegion() {
        // 위아래 여백(한 색)을 빼고 바둑판이 그려진 가운데 칸만 재면 또렷하다.
        val padded = image { x, y -> if (y < 16 || y >= 48) 114 else if ((x / 8 + y / 8) % 2 == 0) 40 else 200 }

        val stats = measureQuality(padded, size, 0, 16, size, 48, step = 1)

        assertEquals(FrameQuality.OK, judgeQuality(stats, config))
    }
}
