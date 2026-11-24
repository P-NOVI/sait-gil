package com.pnovi.saitgil.vision

import kotlin.math.max
import kotlin.math.min
import kotlin.math.roundToInt

// 모델 출력(1, 4 + 클래스 수, 후보 수)을 박스로 바꾸고, 레터박스를 걷어 세운 화면 기준 좌표로 옮긴다.
// Android 클래스를 쓰지 않아 가짜 출력으로 JVM 단위 테스트를 할 수 있다.

/** 모델 입력(정사각형) 기준 0~1 좌표의 박스 하나 */
data class RawDetection(
    val kind: DetectedClass,
    val score: Float,
    val centerX: Float,
    val centerY: Float,
    val width: Float,
    val height: Float,
) {
    val left: Float get() = centerX - width / 2
    val top: Float get() = centerY - height / 2
    val right: Float get() = centerX + width / 2
    val bottom: Float get() = centerY + height / 2
}

// 출력 채널 0~3 은 박스(가운데 x·y, 너비, 높이), 4 부터는 클래스별 점수다.
private const val BOX_CHANNELS = 4

/** 모델 출력 채널 수. 박스 4개 + 클래스 수 */
val OUTPUT_CHANNELS: Int = BOX_CHANNELS + DetectedClass.entries.size

/**
 * 출력 한 장을 박스 목록으로 바꾼다. output 은 [채널][후보] 순서로 펼친 값이다.
 * 박스 값은 입력 크기로 나눈 0~1 이고(Ultralytics LiteRT 내보내기), 점수는 0~1 이다.
 * 후보마다 점수가 가장 높은 클래스 하나만 쓰고, minScore 보다 낮으면 버린 뒤 클래스별로 겹친 박스를 거른다.
 */
fun decodeDetections(output: FloatArray, candidates: Int, config: DetectorConfig): List<RawDetection> {
    require(output.size == OUTPUT_CHANNELS * candidates) {
        "출력 크기가 다릅니다: ${output.size} (채널 $OUTPUT_CHANNELS × 후보 $candidates)"
    }
    val found = (0 until candidates).mapNotNull { i ->
        val best = DetectedClass.entries.indices.maxBy { output[(BOX_CHANNELS + it) * candidates + i] }
        val score = output[(BOX_CHANNELS + best) * candidates + i]
        if (score < config.minScore) return@mapNotNull null
        RawDetection(
            kind = DetectedClass.entries[best],
            score = score,
            centerX = output[i],
            centerY = output[candidates + i],
            width = output[2 * candidates + i],
            height = output[3 * candidates + i],
        )
    }
    return nonMaxSuppression(found, config.nmsIou).take(config.maxDetections)
}

/** 점수 높은 순으로 보며, 이미 남긴 같은 클래스 박스와 iouThreshold 이상 겹치면 버린다 */
fun nonMaxSuppression(detections: List<RawDetection>, iouThreshold: Float): List<RawDetection> {
    val kept = mutableListOf<RawDetection>()
    for (candidate in detections.sortedByDescending { it.score }) {
        val overlaps = kept.any { it.kind == candidate.kind && iou(it, candidate) >= iouThreshold }
        if (!overlaps) kept += candidate
    }
    return kept
}

fun iou(a: RawDetection, b: RawDetection): Float {
    val overlapW = min(a.right, b.right) - max(a.left, b.left)
    val overlapH = min(a.bottom, b.bottom) - max(a.top, b.top)
    if (overlapW <= 0f || overlapH <= 0f) return 0f
    val overlap = overlapW * overlapH
    return overlap / (a.width * a.height + b.width * b.height - overlap)
}

/**
 * 세운 영상(가로 imageWidth, 세로 imageHeight px)을 정사각형 입력에 비율을 지켜 넣은 배치.
 * 남는 쪽은 양쪽에 같은 여백을 둔다(Ultralytics 레터박스와 같다).
 */
data class Letterbox(val imageWidth: Int, val imageHeight: Int, val inputSize: Int) {
    val scale: Float = min(inputSize.toFloat() / imageWidth, inputSize.toFloat() / imageHeight)
    val padX: Float = (inputSize - imageWidth * scale) / 2
    val padY: Float = (inputSize - imageHeight * scale) / 2

    /** 입력 기준 0~1 가로 위치를 영상 기준 0~1 로. 여백에 걸친 값은 영상 끝으로 자른다 */
    fun toImageX(x: Float): Double = ((x * inputSize - padX) / (imageWidth * scale)).toDouble().coerceIn(0.0, 1.0)

    /** 입력 기준 0~1 세로 위치를 영상 기준 0~1 로. 여백에 걸친 값은 영상 끝으로 자른다 */
    fun toImageY(y: Float): Double = ((y * inputSize - padY) / (imageHeight * scale)).toDouble().coerceIn(0.0, 1.0)
}

/**
 * 박스를 세운 화면 기준 0~1 좌표로 옮겨 판단기에 넘길 프레임을 만든다.
 * person 은 boxes(인파 판단), 나머지 클래스는 objects(장애물·신호등 판단)로 나눈다. 여백에만 있는 박스는 버린다.
 */
fun toDetectionFrame(detections: List<RawDetection>, letterbox: Letterbox, timeMs: Long): DetectionFrame {
    val persons = mutableListOf<PersonBox>()
    val objects = mutableListOf<ObjectBox>()
    for (detection in detections) {
        val left = letterbox.toImageX(detection.left)
        val top = letterbox.toImageY(detection.top)
        val width = letterbox.toImageX(detection.right) - left
        val height = letterbox.toImageY(detection.bottom) - top
        if (width <= 0.0 || height <= 0.0) continue
        val score = detection.score.toDouble()
        if (detection.kind == DetectedClass.PERSON) {
            persons += PersonBox(left, top, width, height, score)
        } else {
            objects += ObjectBox(detection.kind, left, top, width, height, score)
        }
    }
    return DetectionFrame(
        timeMs = timeMs,
        boxes = persons,
        imageWidthPx = letterbox.imageWidth,
        imageHeightPx = letterbox.imageHeight,
        objects = objects,
    )
}

/** 세운 영상(px)에서 신호등만 다시 볼 정사각형 칸. 왼쪽 위 (left, top) 에서 한 변 size 다 */
data class CropRegion(val left: Int, val top: Int, val size: Int)

/**
 * 세운 영상(가로 imageWidth, 세로 imageHeight px)에서 신호등을 다시 볼 칸. 가로 가운데, 세로 signalCropCenterY 에 두고
 * 영상 밖으로 나가면 안쪽으로 민다. 영상이 칸보다 크지 않으면(분석 해상도를 올리기 전) 잘라 봐야 같은 영상이라 null 이다.
 */
fun signalCrop(imageWidth: Int, imageHeight: Int, config: DetectorConfig): CropRegion? {
    val size = config.signalCropSizePx
    if (imageWidth <= size || imageHeight <= size) return null
    val top = (config.signalCropCenterY * imageHeight - size / 2.0).roundToInt().coerceIn(0, imageHeight - size)
    return CropRegion((imageWidth - size) / 2, top, size)
}

/** 자른 칸을 추론한 박스(입력 기준 0~1) 중 신호등만 세운 영상 기준 0~1 좌표로 옮긴다. 칸 밖에 걸친 값은 칸 끝으로 자른다 */
fun signalBoxesFromCrop(
    detections: List<RawDetection>,
    crop: CropRegion,
    imageWidth: Int,
    imageHeight: Int,
): List<ObjectBox> = detections.filter { it.kind in SIGNAL_CLASSES }.mapNotNull { detection ->
    val left = detection.left.coerceIn(0f, 1f)
    val top = detection.top.coerceIn(0f, 1f)
    val width = detection.right.coerceIn(0f, 1f) - left
    val height = detection.bottom.coerceIn(0f, 1f) - top
    if (width <= 0f || height <= 0f) return@mapNotNull null
    ObjectBox(
        kind = detection.kind,
        left = (crop.left + left * crop.size) / imageWidth.toDouble(),
        top = (crop.top + top * crop.size) / imageHeight.toDouble(),
        width = width * crop.size / imageWidth.toDouble(),
        height = height * crop.size / imageHeight.toDouble(),
        score = detection.score.toDouble(),
    )
}

/**
 * 자른 칸(crop)에서 찾은 신호등 박스를 프레임에 더한다. 신호등이 아닌 박스는 그대로 둔다.
 * 신호등끼리는 종류와 상관없이 겹친 넓이가 작은 박스의 signalMergeOverlap 이상이면 같은 신호등으로 보고 하나만 남긴다.
 * 전체 영상은 red, 칸은 other 처럼 다르게 본 두 박스가 남으면 SignalTracker 가 프레임마다 다른 쪽을 골라 상태가 오간다.
 * 더 자세히 본 칸 박스, 전체 영상 박스, 칸 끝에 걸려 잘린 칸 박스 순으로 남기고, 같은 차례에서는 점수가 높은 것을 남긴다.
 */
fun withCropSignals(
    frame: DetectionFrame,
    cropBoxes: List<ObjectBox>,
    crop: CropRegion,
    config: DetectorConfig,
): DetectionFrame {
    if (cropBoxes.isEmpty()) return frame
    val (signals, others) = frame.objects.partition { it.kind in SIGNAL_CLASSES }
    val (cut, intact) = cropBoxes.partition {
        cutByCrop(it, crop, frame.imageWidthPx, frame.imageHeightPx, config.signalCropEdgePx)
    }
    val kept = mutableListOf<ObjectBox>()
    for (box in listOf(intact, signals, cut).flatMap { group -> group.sortedByDescending { it.score } }) {
        if (kept.none { overlapOfSmaller(it, box) >= config.signalMergeOverlap }) kept += box
    }
    return frame.copy(objects = others + kept)
}

/** 칸 안쪽 끝(영상 끝과 겹치지 않는 쪽)에 edgePx 안으로 닿아, 칸에 걸려 잘렸을 박스인지 */
private fun cutByCrop(box: ObjectBox, crop: CropRegion, imageWidth: Int, imageHeight: Int, edgePx: Int): Boolean {
    val left = box.left * imageWidth
    val top = box.top * imageHeight
    val right = left + box.width * imageWidth
    val bottom = top + box.height * imageHeight
    val cropRight = crop.left + crop.size
    val cropBottom = crop.top + crop.size
    return (crop.left > 0 && left - crop.left <= edgePx) ||
        (cropRight < imageWidth && cropRight - right <= edgePx) ||
        (crop.top > 0 && top - crop.top <= edgePx) ||
        (cropBottom < imageHeight && cropBottom - bottom <= edgePx)
}

/** 두 박스가 겹친 넓이 ÷ 작은 박스 넓이. 칸 끝에 잘린 박스처럼 한쪽이 다른 쪽 안에 들면 1 이다 */
private fun overlapOfSmaller(a: ObjectBox, b: ObjectBox): Double {
    val width = min(a.left + a.width, b.left + b.width) - max(a.left, b.left)
    val height = min(a.top + a.height, b.top + b.height) - max(a.top, b.top)
    if (width <= 0.0 || height <= 0.0) return 0.0
    return width * height / min(a.width * a.height, b.width * b.height)
}
