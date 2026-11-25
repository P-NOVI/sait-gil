package com.pnovi.saitgil.vision

// 밤에 신호등을 왜 못 찾는지 보려고, 횡단보도 근처에서 신호등 칸을 모델이 본 그대로 폰에 저장한다.
// 디버그 빌드에서만 켠다. 사람 얼굴이 찍힐 수 있어 사진은 폰 앱 폴더에만 두고 커밋하지 않는다.

import android.graphics.Bitmap
import android.util.Log
import java.io.File
import java.io.IOException
import java.text.SimpleDateFormat
import java.util.Locale
import java.util.TimeZone
import java.util.concurrent.Executors

private const val RED_SHIFT = 16
private const val GREEN_SHIFT = 8
private const val CHANNEL_MASK = 0xFF

// Rec.601 밝기 가중치
private const val LUMA_RED = 0.299
private const val LUMA_GREEN = 0.587
private const val LUMA_BLUE = 0.114

// 파일 이름에 점수를 0~100 정수로 쓴다
private const val SCORE_PERCENT = 100

/** ARGB 픽셀들의 평균 밝기(0~255). step 개마다 하나만 본다 */
fun meanLuma(pixels: IntArray, step: Int): Double {
    var sum = 0.0
    var count = 0
    for (i in pixels.indices step step) {
        val pixel = pixels[i]
        val red = (pixel shr RED_SHIFT) and CHANNEL_MASK
        val green = (pixel shr GREEN_SHIFT) and CHANNEL_MASK
        val blue = pixel and CHANNEL_MASK
        sum += LUMA_RED * red + LUMA_GREEN * green + LUMA_BLUE * blue
        count += 1
    }
    return if (count == 0) 0.0 else sum / count
}

/**
 * 저장할 사진 이름. 찍은 시각, 평균 밝기, 점수 컷 전 신호등 클래스별 최고 점수(0~100)를 넣어 파일 목록만 보고도 고를 수 있게 한다.
 * 예: 20261125_193012_345_l042_red18_other05.jpg
 */
fun signalCaptureName(wallMs: Long, luma: Double, scores: Map<DetectedClass, Float>, zone: TimeZone = TimeZone.getDefault()): String {
    val time = SimpleDateFormat("yyyyMMdd_HHmmss_SSS", Locale.US).apply { timeZone = zone }.format(wallMs)
    val signals = SIGNAL_CAPTURE_ORDER.joinToString("_") { kind ->
        val label = kind.wire.removePrefix("ped_signal_")
        "%s%02d".format(Locale.US, label, ((scores[kind] ?: 0f) * SCORE_PERCENT).toInt())
    }
    return "%s_l%03d_%s.jpg".format(Locale.US, time, luma.toInt(), signals)
}

// 파일 이름에 쓰는 신호등 클래스 순서
private val SIGNAL_CAPTURE_ORDER = listOf(DetectedClass.PED_SIGNAL_RED, DetectedClass.PED_SIGNAL_OTHER)

/**
 * 신호등 칸 사진을 dir 에 JPEG 로 저장한다. signalCaptureEveryMs 마다 한 장만 저장하고, signalCaptureMaxFiles 를 넘으면
 * 오래된 것부터 지운다. 압축·쓰기는 별도 스레드에서 해 카메라 분석을 늦추지 않는다.
 */
class SignalCaptureWriter(private val dir: File, private val config: DetectorConfig) {
    private val executor = Executors.newSingleThreadExecutor()
    private var lastSavedMs: Long? = null

    /** nowMs(단조 시각)에 저장할 차례인지 */
    fun due(nowMs: Long): Boolean = lastSavedMs?.let { nowMs - it >= config.signalCaptureEveryMs } ?: true

    /** bitmap 을 복사해 name 으로 저장한다. 원본은 다음 프레임에 다시 쓰므로 복사본만 넘긴다 */
    fun save(bitmap: Bitmap, name: String, nowMs: Long) {
        lastSavedMs = nowMs
        val copy = bitmap.copy(Bitmap.Config.ARGB_8888, false)
        executor.execute {
            try {
                dir.mkdirs()
                File(dir, name).outputStream().use { copy.compress(Bitmap.CompressFormat.JPEG, config.signalCaptureJpegQuality, it) }
                prune()
            } catch (error: IOException) {
                Log.w(TAG, "신호등 칸 사진을 저장하지 못했습니다: $name", error)
            } finally {
                copy.recycle()
            }
        }
    }

    fun close() = executor.shutdown()

    /** 이름이 시각으로 시작하므로 이름 순으로 오래된 것을 지운다 */
    private fun prune() {
        val files = dir.listFiles { file -> file.name.endsWith(".jpg") }?.sortedBy { it.name } ?: return
        files.take((files.size - config.signalCaptureMaxFiles).coerceAtLeast(0)).forEach { it.delete() }
    }

    private companion object {
        const val TAG = "SaitgilVision"
    }
}
