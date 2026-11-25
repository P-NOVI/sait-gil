package com.pnovi.saitgil.vision

import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Matrix
import android.graphics.Paint
import android.graphics.RectF
import android.os.BatteryManager
import android.os.Build
import android.os.SystemClock
import android.util.Log
import androidx.camera.core.ImageProxy
import androidx.core.content.ContextCompat
import org.tensorflow.lite.DataType
import org.tensorflow.lite.Interpreter
import java.io.File
import java.io.IOException
import java.nio.ByteBuffer
import java.nio.ByteOrder

/**
 * 카메라 프레임을 LiteRT 로 추론해 박스를 뽑는다. 영상은 기기 안에서만 쓰고 박스만 돌려준다.
 * 인터프리터는 여러 스레드에서 함께 쓸 수 없으므로 카메라 분석 스레드 하나에서만 부른다.
 */
class LiteRtDetector private constructor(
    private val interpreter: Interpreter,
    private val config: DetectorConfig,
    private val candidates: Int,
    /** 로그에 남길 모델 이름(fp32·fp16·int8) */
    private val label: String,
    /** 배터리 온도(°C). 발열로 느려지는지 볼 때 쓴다. 모르면 null */
    private val batteryTempC: () -> Double?,
    /** 횡단보도 근처라 영상 위쪽 가운데를 잘라 먼 신호등을 한 번 더 찾을지(#134) */
    private val farSignals: () -> Boolean,
    /** 신호등 칸 사진을 저장할 곳. 디버그 빌드에서만 있다 */
    private val capture: SignalCaptureWriter?,
) : FrameAnalyzer {
    private val size = config.inputSize
    private val planeSize = size * size

    // 프레임마다 새로 만들지 않도록 입력·출력 버퍼와 그림판을 한 번만 만든다.
    private val input = ByteBuffer.allocateDirect(Float.SIZE_BYTES * 3 * planeSize).order(ByteOrder.nativeOrder())
    private val inputValues = FloatArray(3 * planeSize)
    private val output =
        ByteBuffer.allocateDirect(Float.SIZE_BYTES * OUTPUT_CHANNELS * candidates).order(ByteOrder.nativeOrder())
    private val outputValues = FloatArray(OUTPUT_CHANNELS * candidates)
    private val square = Bitmap.createBitmap(size, size, Bitmap.Config.ARGB_8888)
    private val canvas = Canvas(square)
    private val pixels = IntArray(planeSize)
    private val placement = Matrix()
    private val paint = Paint(Paint.FILTER_BITMAP_FLAG)
    private val padColor = Color.rgb(config.padGray, config.padGray, config.padGray)

    // 로그로 볼 구간(logEveryFrames 장)의 시간 합과 클래스별 박스 수·최고 점수.
    // 모델을 읽은 뒤 첫 logWarmupFrames 장은 준비 시간이라 세지 않는다.
    private var warmupLeft = config.logWarmupFrames
    private var timedFrames = 0
    private var prepareMsSum = 0L
    private var inferMsSum = 0L
    private var decodeMsSum = 0L

    // 앞 프레임 분석을 시작한 시각과 프레임 사이 시간 합. 카메라를 기다린 시간까지 들어가 실제 fps 가 된다.
    private var lastStartedMs = 0L
    private var intervalMsSum = 0L
    private val foundCounts = IntArray(DetectedClass.entries.size)
    private val foundBest = FloatArray(DetectedClass.entries.size)

    // 같은 구간에서 위쪽 가운데를 잘라 한 번 더 추론한 프레임 수와 그 시간 합, 찾은 신호등 수·최고 점수(#134).
    private var croppedFrames = 0
    private var cropMsSum = 0L
    private val cropFoundCounts = IntArray(DetectedClass.entries.size)
    private val cropFoundBest = FloatArray(DetectedClass.entries.size)

    // 같은 구간에서 신호등 칸의 점수 컷 전 신호등 클래스별 최고 점수. 밤에 컷 바로 아래에서 놓치는지 본다.
    private val cropRawBest = FloatArray(DetectedClass.entries.size)

    override fun analyze(image: ImageProxy): DetectionFrame {
        val started = SystemClock.elapsedRealtime()
        val rotation = image.imageInfo.rotationDegrees
        val upright = rotation % 180 == 0
        val letterbox = Letterbox(
            imageWidth = if (upright) image.width else image.height,
            imageHeight = if (upright) image.height else image.width,
            inputSize = size,
        )
        val bitmap = image.toBitmap()
        try {
            placeUpright(image, rotation)
            placement.postScale(letterbox.scale, letterbox.scale)
            placement.postTranslate(letterbox.padX, letterbox.padY)
            fillInput(bitmap)
            val prepared = SystemClock.elapsedRealtime()
            runModel()
            val inferred = SystemClock.elapsedRealtime()
            val detections = decodeDetections(outputValues, candidates, config)
            // 찍은 시각을 쓴다. 정면 접근 속도를 잴 때 추론이 밀려도 프레임 사이 시간이 맞게 한다.
            val frame = toDetectionFrame(detections, letterbox, image.imageInfo.timestamp / NANOS_PER_MS)
            val decoded = SystemClock.elapsedRealtime()
            val crop = if (farSignals()) signalCrop(letterbox.imageWidth, letterbox.imageHeight, config) else null
            val cropBoxes = crop?.let { searchSignals(image, bitmap, rotation, it, letterbox) }
            val cropMs = cropBoxes?.let { SystemClock.elapsedRealtime() - decoded }
            val intervalMs = if (lastStartedMs == 0L) null else started - lastStartedMs
            lastStartedMs = started
            logWindow(
                FrameTimes(prepared - started, inferred - prepared, decoded - inferred, intervalMs, cropMs),
                detections,
                cropBoxes,
            )
            return if (crop != null && cropBoxes != null) withCropSignals(frame, cropBoxes, crop, config) else frame
        } finally {
            bitmap.recycle()
        }
    }

    override fun close() {
        interpreter.close()
        capture?.close()
    }

    /** placement 를 프레임을 세운 방향으로 돌리고 왼쪽 위를 (0, 0) 에 두는 변환으로 되돌린다 */
    private fun placeUpright(image: ImageProxy, rotation: Int) {
        placement.reset()
        placement.postRotate(rotation.toFloat())
        val turned = RectF(0f, 0f, image.width.toFloat(), image.height.toFloat()).also(placement::mapRect)
        placement.postTranslate(-turned.left, -turned.top)
    }

    /**
     * 세운 프레임의 crop 칸을 정사각형 입력에 그려 한 번 더 추론하고, 찾은 신호등 박스를 세운 영상 기준 좌표로 돌려준다.
     * 칸은 영상 안에 있어 입력 전체를 덮으므로 여백이 생기지 않는다.
     */
    private fun searchSignals(
        image: ImageProxy,
        frame: Bitmap,
        rotation: Int,
        crop: CropRegion,
        letterbox: Letterbox,
    ): List<ObjectBox> {
        placeUpright(image, rotation)
        placement.postTranslate(-crop.left.toFloat(), -crop.top.toFloat())
        val scale = size.toFloat() / crop.size
        placement.postScale(scale, scale)
        fillInput(frame)
        runModel()
        val detections = decodeDetections(outputValues, candidates, config)
        val rawScores = bestClassScores(outputValues, candidates, SIGNAL_CLASSES)
        rawScores.forEach { (kind, score) -> cropRawBest[kind.ordinal] = maxOf(cropRawBest[kind.ordinal], score) }
        captureCrop(rawScores)
        return signalBoxesFromCrop(detections, crop, letterbox.imageWidth, letterbox.imageHeight)
    }

    /** 차례가 되면 방금 추론한 신호등 칸(모델 입력 그대로)을 저장하고 밝기·점수를 로그로 남긴다. "신호등 칸 저장" 으로 찾는다 */
    private fun captureCrop(rawScores: Map<DetectedClass, Float>) {
        val writer = capture ?: return
        val now = SystemClock.elapsedRealtime()
        if (!writer.due(now)) return
        val luma = meanLuma(pixels, config.signalCaptureLumaStep)
        val name = signalCaptureName(System.currentTimeMillis(), luma, rawScores)
        writer.save(square, name, now)
        Log.d(TAG, "신호등 칸 저장 $name 밝기 ${"%.0f".format(luma)} 점수 컷 전 최고 ${rawText(rawScores)}")
    }

    private fun rawText(scores: Map<DetectedClass, Float>): String =
        scores.entries.joinToString { (kind, score) -> "${kind.wire} ${"%.2f".format(score)}" }

    private fun runModel() {
        output.rewind()
        interpreter.run(input, output)
        output.rewind()
        output.asFloatBuffer().get(outputValues)
    }

    /** placement 로 프레임을 정사각형 입력에 그리고, 채널 우선(NCHW) 0~1 값으로 채운다. 프레임이 덮지 않는 곳은 여백 회색이다 */
    private fun fillInput(frame: Bitmap) {
        canvas.drawColor(padColor)
        canvas.drawBitmap(frame, placement, paint)

        square.getPixels(pixels, 0, size, 0, 0, size, size)
        for (i in 0 until planeSize) {
            val pixel = pixels[i]
            inputValues[i] = Color.red(pixel) / 255f
            inputValues[planeSize + i] = Color.green(pixel) / 255f
            inputValues[2 * planeSize + i] = Color.blue(pixel) / 255f
        }
        input.rewind()
        input.asFloatBuffer().put(inputValues)
    }

    /**
     * 프레임 한 장의 단계별 시간(ms). intervalMs 는 앞 프레임 분석 시작부터 이번 시작까지이며 첫 프레임은 null 이다.
     * cropMs 는 위쪽 가운데를 잘라 한 번 더 추론한 시간(그리기·추론·후처리)이며 자르지 않았으면 null 이다
     */
    private class FrameTimes(
        val prepareMs: Long,
        val inferMs: Long,
        val decodeMs: Long,
        val intervalMs: Long?,
        val cropMs: Long?,
    )

    /**
     * 구간마다 추론 시간과 클래스별 박스 수·최고 점수를 로그로 남긴다. 실기기에서 모델이 맞게 잡는지 볼 때 쓴다.
     * 모델 비교(#128)를 위해 모델 이름·기기·배터리 온도를 같은 줄에 남긴다. "추론 측정" 으로 찾는다.
     * 횡단보도 근처에서 위쪽 가운데를 잘라 한 번 더 추론했으면 그 시간과 찾은 신호등을 따로 남긴다(#134). "신호등 칸" 으로 찾는다.
     */
    private fun logWindow(times: FrameTimes, detections: List<RawDetection>, cropBoxes: List<ObjectBox>?) {
        if (warmupLeft > 0) {
            warmupLeft -= 1
            return
        }
        timedFrames += 1
        prepareMsSum += times.prepareMs
        inferMsSum += times.inferMs
        decodeMsSum += times.decodeMs
        intervalMsSum += times.intervalMs ?: 0L
        for (detection in detections) {
            val index = detection.kind.ordinal
            foundCounts[index] += 1
            foundBest[index] = maxOf(foundBest[index], detection.score)
        }
        times.cropMs?.let {
            croppedFrames += 1
            cropMsSum += it
        }
        for (box in cropBoxes.orEmpty()) {
            val index = box.kind.ordinal
            cropFoundCounts[index] += 1
            cropFoundBest[index] = maxOf(cropFoundBest[index], box.score.toFloat())
        }
        if (timedFrames < config.logEveryFrames) return

        val fps = if (intervalMsSum > 0) "%.2f".format(timedFrames * MS_PER_SECOND / intervalMsSum) else "-"
        val battery = batteryTempC()?.let { "%.1f°C".format(it) } ?: "-"
        Log.d(
            TAG,
            "추론 측정 모델 $label 기기 ${Build.MODEL}: 추론 평균 ${inferMsSum / timedFrames}ms, " +
                "전처리 ${prepareMsSum / timedFrames}ms, 후처리 ${decodeMsSum / timedFrames}ms, ${fps}fps, " +
                "배터리 $battery (${timedFrames}장)",
        )
        Log.d(TAG, "탐지 합계 (${timedFrames}장): ${foundText(foundCounts, foundBest)}")
        if (croppedFrames > 0) {
            Log.d(
                TAG,
                "신호등 칸 추론 평균 ${cropMsSum / croppedFrames}ms (${croppedFrames}장), " +
                    "찾은 신호등: ${foundText(cropFoundCounts, cropFoundBest)}, " +
                    "점수 컷 전 최고 ${rawText(SIGNAL_CLASSES.associateWith { cropRawBest[it.ordinal] })}",
            )
        }
        timedFrames = 0
        prepareMsSum = 0
        inferMsSum = 0
        decodeMsSum = 0
        intervalMsSum = 0
        foundCounts.fill(0)
        foundBest.fill(0f)
        croppedFrames = 0
        cropMsSum = 0
        cropFoundCounts.fill(0)
        cropFoundBest.fill(0f)
        cropRawBest.fill(0f)
    }

    /** 클래스별 박스 수·최고 점수를 로그 한 줄로. 하나도 없으면 "없음" */
    private fun foundText(counts: IntArray, best: FloatArray): String = DetectedClass.entries
        .filter { counts[it.ordinal] > 0 }
        .joinToString { "${it.wire} ${counts[it.ordinal]}개(최고 ${"%.2f".format(best[it.ordinal])})" }
        .ifEmpty { "없음" }

    companion object {
        private const val TAG = "SaitgilVision"
        private const val NANOS_PER_MS = 1_000_000L
        private const val MS_PER_SECOND = 1_000.0
        private const val BYTES_PER_KB = 1_024

        // BatteryManager.EXTRA_TEMPERATURE 는 0.1°C 단위다.
        private const val TENTHS_PER_DEGREE = 10.0

        /**
         * assets 의 모델(asset)로 만든다. 모델 파일이 없거나(가중치는 커밋하지 않는다) 입출력이 앱과 다르면 null 이다.
         * farSignals 가 true 인 프레임은 위쪽 가운데를 잘라 신호등을 한 번 더 찾는다.
         * captureDir 이 있으면 그 칸 사진을 signalCaptureEveryMs 마다 저장한다(디버그 빌드에서만 넘긴다).
         * 모델을 읽는 데 시간이 걸리므로 메인 스레드에서 부르지 않는다.
         */
        fun load(
            context: Context,
            config: DetectorConfig = DetectorConfig(),
            asset: String = config.modelAsset,
            captureDir: File? = null,
            farSignals: () -> Boolean = { false },
        ): LiteRtDetector? {
            val model = try {
                context.assets.open(asset).use { it.readBytes() }
            } catch (error: IOException) {
                Log.w(TAG, "모델 파일이 없어 인식 없이 카메라만 켭니다: $asset", error)
                return null
            }
            val buffer = ByteBuffer.allocateDirect(model.size).order(ByteOrder.nativeOrder())
            buffer.put(model).rewind()
            val interpreter = try {
                Interpreter(buffer, Interpreter.Options().setNumThreads(config.threads))
            } catch (error: RuntimeException) {
                Log.e(TAG, "모델을 읽지 못했습니다: $asset", error)
                return null
            }
            val inputTensor = interpreter.getInputTensor(0)
            val outputTensor = interpreter.getOutputTensor(0)
            val outputShape = outputTensor.shape()
            val fits = inputTensor.dataType() == DataType.FLOAT32 &&
                inputTensor.shape().contentEquals(intArrayOf(1, 3, config.inputSize, config.inputSize)) &&
                outputTensor.dataType() == DataType.FLOAT32 &&
                outputShape.size == 3 && outputShape[0] == 1 && outputShape[1] == OUTPUT_CHANNELS
            if (!fits) {
                Log.e(
                    TAG,
                    "모델 입출력이 앱과 다릅니다: 입력 ${inputTensor.shape().contentToString()}, " +
                        "출력 ${outputShape.contentToString()}",
                )
                interpreter.close()
                return null
            }
            val label = modelLabel(config.compareModels, asset)
            Log.i(TAG, "모델을 불러왔습니다: $label $asset (${model.size / BYTES_PER_KB}KB, 후보 ${outputShape[2]}개)")
            val appContext = context.applicationContext
            val capture = captureDir?.let { SignalCaptureWriter(it, config) }
            captureDir?.let { Log.i(TAG, "횡단보도 근처 신호등 칸 사진을 저장합니다: ${it.absolutePath}") }
            return LiteRtDetector(
                interpreter,
                config,
                outputShape[2],
                label,
                { batteryTempC(appContext) },
                farSignals,
                capture,
            )
        }

        /** 배터리 온도(°C). 시스템이 늘 들고 있는 배터리 상태 방송을 읽기만 하고 수신기는 등록하지 않는다 */
        private fun batteryTempC(context: Context): Double? {
            val status = ContextCompat.registerReceiver(
                context,
                null,
                IntentFilter(Intent.ACTION_BATTERY_CHANGED),
                ContextCompat.RECEIVER_NOT_EXPORTED,
            ) ?: return null
            val tenths = status.getIntExtra(BatteryManager.EXTRA_TEMPERATURE, Int.MIN_VALUE)
            return if (tenths == Int.MIN_VALUE) null else tenths / TENTHS_PER_DEGREE
        }
    }
}
