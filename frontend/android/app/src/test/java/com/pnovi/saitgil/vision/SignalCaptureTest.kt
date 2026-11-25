package com.pnovi.saitgil.vision

import org.junit.Assert.assertEquals
import org.junit.Test
import java.util.TimeZone

// 신호등 칸 사진의 밝기·이름과 점수 컷 전 최고 점수를 확인한다. Android 클래스는 쓰지 않는다.
class SignalCaptureTest {
    private fun argb(red: Int, green: Int, blue: Int) = (0xFF shl 24) or (red shl 16) or (green shl 8) or blue

    @Test
    fun meanLumaWeighsChannelsLikeRec601() {
        assertEquals(255.0, meanLuma(IntArray(4) { argb(255, 255, 255) }, step = 1), 1e-6)
        assertEquals(0.299 * 255, meanLuma(IntArray(4) { argb(255, 0, 0) }, step = 1), 1e-6)
    }

    @Test
    fun meanLumaLooksAtEveryStepPixel() {
        // 0·2 번째만 보므로 흰 픽셀만 센다.
        val pixels = intArrayOf(argb(255, 255, 255), argb(0, 0, 0), argb(255, 255, 255), argb(0, 0, 0))

        assertEquals(255.0, meanLuma(pixels, step = 2), 1e-6)
        assertEquals(0.0, meanLuma(IntArray(0), step = 2), 1e-6)
    }

    @Test
    fun captureNameHasTimeBrightnessAndSignalScores() {
        val utc = TimeZone.getTimeZone("UTC")
        val scores = mapOf(DetectedClass.PED_SIGNAL_RED to 0.184f, DetectedClass.PED_SIGNAL_OTHER to 0.05f)

        // 2026-11-25 10:30:12.345 UTC
        val name = signalCaptureName(1_795_602_612_345L, 42.7, scores, utc)

        assertEquals("20261125_103012_345_l042_red18_other05.jpg", name)
        assertEquals("20261125_103012_345_l042_red00_other00.jpg", signalCaptureName(1_795_602_612_345L, 42.7, emptyMap(), utc))
    }

    @Test
    fun bestClassScoresLooksPastScoreCutAndWinningClass() {
        val candidates = 3
        val output = FloatArray(OUTPUT_CHANNELS * candidates)
        fun score(kind: DetectedClass, candidate: Int, value: Float) {
            output[(OUTPUT_CHANNELS - DetectedClass.entries.size + kind.ordinal) * candidates + candidate] = value
        }
        // 후보 0 은 사람이 이기지만 빨간불 점수도 0.2 다. 후보 2 는 컷(0.25) 아래 빨간불 0.1 이다.
        score(DetectedClass.PERSON, 0, 0.9f)
        score(DetectedClass.PED_SIGNAL_RED, 0, 0.2f)
        score(DetectedClass.PED_SIGNAL_RED, 2, 0.1f)
        score(DetectedClass.PED_SIGNAL_OTHER, 1, 0.07f)

        val best = bestClassScores(output, candidates, SIGNAL_CLASSES)

        assertEquals(0.2f, best.getValue(DetectedClass.PED_SIGNAL_RED), 1e-6f)
        assertEquals(0.07f, best.getValue(DetectedClass.PED_SIGNAL_OTHER), 1e-6f)
    }
}
