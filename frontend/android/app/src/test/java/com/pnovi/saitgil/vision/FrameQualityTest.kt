package com.pnovi.saitgil.vision

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class FrameQualityTest {
    private val config = DetectorConfig()
    private val size = 64

    private fun gray(value: Int) = (0xFF shl 24) or (value shl 16) or (value shl 8) or value

    private fun stats(pixels: IntArray, left: Int = 0, right: Int = size) =
        frameStats(pixels, size, left, 0, right, size, step = 1)!!

    /** 가로로 밝고 어두운 줄이 번갈아 가는 선명한 무늬 */
    private fun sharp() = IntArray(size * size) { gray(if ((it % size) % 2 == 0) 40 else 200) }

    /** 밝기가 픽셀당 1씩만 바뀌는 흐린 무늬. 밝기 편차는 가림 기준보다 크다 */
    private fun blurred() = IntArray(size * size) { gray(80 + (it % size)) }

    @Test
    fun blackFrameIsUnreliable() {
        assertTrue(isUnreliable(stats(IntArray(size * size) { gray(0) }), config))
    }

    @Test
    fun flatBrightFrameIsUnreliable() {
        assertTrue(isUnreliable(stats(IntArray(size * size) { gray(128) }), config))
    }

    @Test
    fun blurredFrameIsUnreliable() {
        assertTrue(isUnreliable(stats(blurred()), config))
    }

    @Test
    fun sharpFrameIsReliable() {
        assertFalse(isUnreliable(stats(sharp()), config))
    }

    @Test
    fun regionExcludesLetterboxPadding() {
        // 왼쪽 절반은 늘 같은 여백, 오른쪽 절반은 단색 가림. 여백을 빼야 가림이 드러난다.
        val pixels = IntArray(size * size) { gray(if (it % size < size / 2) 114 else 0) }

        assertTrue(isUnreliable(stats(pixels, left = size / 2), config))
    }

    @Test
    fun emptyRegionHasNoStats() {
        assertNull(frameStats(IntArray(size * size), size, 10, 10, 10, 10, step = 1))
    }

    @Test
    fun meanLumaIsReported() {
        assertEquals(128.0, stats(IntArray(size * size) { gray(128) }).meanLuma, 1e-6)
    }
}
