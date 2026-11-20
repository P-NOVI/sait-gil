package com.pnovi.saitgil.vision

// 차·이륜차 박스를 프레임마다 이어 같은 차로 추적하고, 움직이는지 판단해 알릴 차를 고른다.
// 거리는 박스 높이로, 옆 위치(m)는 박스 가로 위치와 거리로 잰다. 걷는 길은 카메라 정면의 좌우 vehicleCorridorHalfWidthM 통로로 본다.
// Android 클래스를 쓰지 않아 가짜 박스로 JVM 단위 테스트를 할 수 있다.

import kotlin.math.abs
import kotlin.math.max
import kotlin.math.min

/** 거리·움직임을 따로 판단하는 차 클래스 */
val VEHICLE_CLASSES: Set<DetectedClass> = setOf(DetectedClass.CAR, DetectedClass.TWO_WHEELER)

/** 차가 움직이는지 판단한 결과 */
enum class VehicleMotion(val wire: String) {
    /** 아직 지켜본 시간이 짧아 모른다 */
    UNKNOWN("unknown"),

    /** 서 있다. 걷는 사람이 다가가는 속도 정도로만 가까워진다 */
    STILL("still"),

    /** 걸음보다 확실히 빠르게 다가온다 */
    APPROACHING("approaching"),

    /** 옆에서 걷는 길 쪽으로 들어온다 */
    CROSSING("crossing"),

    /** 멀어진다 */
    LEAVING("leaving"),
}

/** 추적 중인 차 하나의 이번 프레임 상태. 실기기 로그로 기준을 맞출 때 쓴다 */
data class VehicleState(
    val id: Int,
    val kind: DetectedClass,
    /** 박스 높이로 잰 거리(m). 박스 아래가 잘려 잴 수 없으면 null */
    val distanceM: Double?,
    /** 박스 가운데의 옆 위치(m). 오른쪽이 + 다. 거리를 모르면 null */
    val lateralM: Double?,
    /** 거리가 줄어드는 속도(m/s). 지켜본 시간이 짧으면 null */
    val approachMps: Double?,
    /** 걷는 길 가운데로 들어오는 옆 속도(m/s). 지켜본 시간이 짧으면 null */
    val inwardMps: Double?,
    val motion: VehicleMotion,
)

/** 박스 높이로 잰 차·이륜차 거리(m). 차 클래스가 아니거나 높이가 0 이면 null */
fun vehicleDistanceM(box: ObjectBox, frame: DetectionFrame, config: VisionConfig): Double? {
    val heightM = when (box.kind) {
        DetectedClass.CAR -> config.carHeightM
        DetectedClass.TWO_WHEELER -> config.twoWheelerHeightM
        else -> return null
    }
    val heightPx = box.height * frame.imageHeightPx
    if (heightPx <= 0.0) return null
    return focalLengthPx(frame, config) * heightM / heightPx
}

/** 차·이륜차를 가깝다고 보는 거리(m) */
fun vehicleNearM(kind: DetectedClass, config: VisionConfig): Double =
    if (kind == DetectedClass.TWO_WHEELER) config.twoWheelerNearM else config.carNearM

/** 박스 아래가 영상 끝에 닿아 잘렸는지. 바퀴가 안 보일 만큼 가깝다 */
fun isCutOffAtBottom(box: ObjectBox, config: VisionConfig): Boolean = box.bottom >= 1 - config.clippedEdge

private data class VehicleSample(val timeMs: Long, val distanceM: Double, val lateralM: Double)

private class VehicleTrack(val id: Int, val kind: DetectedClass, var box: ObjectBox) {
    val samples = ArrayDeque<VehicleSample>()
    var missed = 0

    /** 움직이는 차로 알렸는지 */
    var warned = false

    /** 서 있는 차로 알렸는지 */
    var noticed = false
}

/** 프레임 하나를 판단한 결과. alerts 는 이번 프레임에 알릴 차다 */
data class VehicleAnalysis(val alerts: List<VehicleAlert>, val states: List<VehicleState>)

/** 알릴 차 하나. moving 이 false 면 서 있는 차로 장애물처럼 알린다 */
data class VehicleAlert(
    val kind: DetectedClass,
    val direction: Int,
    val distanceM: Double?,
    val moving: Boolean,
)

/** 안내를 시작할 때마다 새로 만든다. 같은 차는 한 번만 알린다. */
class VehicleTracker(private val config: VisionConfig = VisionConfig()) {
    private val tracks = mutableListOf<VehicleTrack>()
    private var nextId = 0

    // 클래스마다 마지막으로 알린 시각. 추적이 끊겨 같은 차가 새 차로 잡혀도 곧바로 다시 알리지 않게 한다.
    private val lastWarnMs = mutableMapOf<DetectedClass, Long>()
    private val lastNoticeMs = mutableMapOf<DetectedClass, Long>()

    fun analyze(frame: DetectionFrame, labels: List<Int>): VehicleAnalysis {
        val focalPx = focalLengthPx(frame, config)
        val seen = match(frame.objects.filter { it.kind in VEHICLE_CLASSES })
        val states = seen.map { track -> measure(track, frame, focalPx) }
        val alerts = seen.zip(states).mapNotNull { (track, state) -> decide(track, state, frame, focalPx, labels) }
        return VehicleAnalysis(alerts, states)
    }

    /** 이번 프레임의 거리·옆 위치를 기록하고 움직임을 판단한다 */
    private fun measure(track: VehicleTrack, frame: DetectionFrame, focalPx: Double): VehicleState {
        val distance = if (isCutOffAtBottom(track.box, config)) null else vehicleDistanceM(track.box, frame, config)
        val lateral = distance?.let { lateralM(track.box.centerX, it, frame, focalPx) }
        if (distance == null || lateral == null) {
            // 잘린 박스는 거리를 잴 수 없어 기록을 새로 시작한다.
            track.samples.clear()
        } else {
            track.samples.addLast(VehicleSample(frame.timeMs, distance, lateral))
            while (track.samples.first().timeMs < frame.timeMs - config.vehicleMotionWindowMs) {
                track.samples.removeFirst()
            }
        }
        var approach: Double? = null
        var inward: Double? = null
        val first = track.samples.firstOrNull()
        val last = track.samples.lastOrNull()
        if (first != null && last != null && last.timeMs - first.timeMs >= config.vehicleMinSpanMs) {
            val spanS = (last.timeMs - first.timeMs) / 1_000.0
            approach = (first.distanceM - last.distanceM) / spanS
            inward = (abs(first.lateralM) - abs(last.lateralM)) / spanS
        }
        return VehicleState(track.id, track.kind, distance, lateral, approach, inward, motionOf(track, approach, inward))
    }

    /**
     * 아주 빠르게 다가오면 두 프레임으로 바로, 그 밖에는 vehicleMotionSamples 프레임 이상 지켜본 뒤 판단한다.
     * 박스 크기로 잰 거리는 프레임마다 흔들려 두 프레임 속도는 오차가 크다.
     */
    private fun motionOf(track: VehicleTrack, approach: Double?, inward: Double?): VehicleMotion = when {
        approach == null || inward == null -> VehicleMotion.UNKNOWN
        approach >= config.vehicleFastMps -> VehicleMotion.APPROACHING
        track.samples.size < config.vehicleMotionSamples -> VehicleMotion.UNKNOWN
        approach >= config.vehicleMovingMps -> VehicleMotion.APPROACHING
        inward >= config.vehicleCrossingMps -> VehicleMotion.CROSSING
        approach <= -config.vehicleMovingMps -> VehicleMotion.LEAVING
        else -> VehicleMotion.STILL
    }

    /**
     * 알릴 차인지 정한다.
     * - 걷는 길로 다가오거나 들어오는 차는 가까운 거리(carNearM·twoWheelerNearM) 안이면 움직이는 차로 알린다.
     * - 아직 모르는데 아주 가까운(잘림, vehicleImmediateM 안) 길 위 차는 기다리지 않고 움직이는 차로 알린다.
     * - 서 있는 차는 길 위 vehicleStillNearM 안일 때 장애물처럼 알린다.
     */
    private fun decide(
        track: VehicleTrack,
        state: VehicleState,
        frame: DetectionFrame,
        focalPx: Double,
        labels: List<Int>,
    ): VehicleAlert? {
        val box = track.box
        // 거리가 null 이면 박스 아래가 잘릴 만큼 가깝다.
        val distance = state.distanceM
        val inPath = distance?.let { inCorridor(box, it, frame, focalPx) } ?: overlapsAhead(box)
        val near = distance == null || distance <= vehicleNearM(track.kind, config)
        val veryNear = distance == null || distance <= config.vehicleImmediateM
        val warn = when (state.motion) {
            VehicleMotion.APPROACHING -> near && inPath
            VehicleMotion.CROSSING -> near
            VehicleMotion.UNKNOWN -> veryNear && inPath
            else -> false
        }
        val notice = state.motion == VehicleMotion.STILL && inPath &&
            distance != null && distance <= config.vehicleStillNearM
        val moving = when {
            warn && !track.warned && due(track.kind, lastWarnMs, config.vehicleWarnRepeatMs, frame.timeMs) -> true
            notice && !track.noticed && due(track.kind, lastNoticeMs, config.obstacleRepeatMs, frame.timeMs) -> false
            else -> return null
        }
        if (moving) track.warned = true
        track.noticed = true
        return VehicleAlert(track.kind, directionOf(box, labels), distance, moving)
    }

    /** 이 클래스를 마지막으로 알린 뒤 repeatMs 가 지났으면 지금 시각을 적고 true */
    private fun due(kind: DetectedClass, last: MutableMap<DetectedClass, Long>, repeatMs: Long, nowMs: Long): Boolean {
        val at = last[kind]
        if (at != null && nowMs - at < repeatMs) return false
        last[kind] = nowMs
        return true
    }

    /** 박스 좌우 끝의 옆 위치가 걷는 길 통로와 겹치는지 */
    private fun inCorridor(box: ObjectBox, distanceM: Double, frame: DetectionFrame, focalPx: Double): Boolean {
        val leftM = lateralM(box.left, distanceM, frame, focalPx)
        val rightM = lateralM(box.right, distanceM, frame, focalPx)
        return rightM >= -config.vehicleCorridorHalfWidthM && leftM <= config.vehicleCorridorHalfWidthM
    }

    /** 앞쪽 칸(11~1시)에 걸치면 그중 박스 가운데에 가장 가까운 칸, 아니면 박스 가운데 칸의 시계 방향 */
    private fun directionOf(box: ObjectBox, labels: List<Int>): Int {
        val center = sectorOf(box.centerX)
        val ahead = (sectorOf(box.left)..sectorOf(box.right)).filter { it in AHEAD_SECTORS }
        return labels[ahead.minByOrNull { abs(it - center) } ?: center]
    }

    private fun overlapsAhead(box: ObjectBox): Boolean =
        (sectorOf(box.left)..sectorOf(box.right)).any { it in AHEAD_SECTORS }

    /** 새 박스를 앞 프레임의 같은 클래스 차와 짝짓는다. 많이 겹치는 것부터, 안 겹치면 가운데가 가까운 것끼리 */
    private fun match(boxes: List<ObjectBox>): List<VehicleTrack> {
        val pairs = tracks
            .flatMap { track -> boxes.indices.filter { boxes[it].kind == track.kind }.map { track to it } }
            .mapNotNull { (track, index) -> matchScore(track.box, boxes[index])?.let { Triple(track, index, it) } }
            .sortedByDescending { it.third }
        val matchedTracks = mutableSetOf<VehicleTrack>()
        val matchedBoxes = mutableSetOf<Int>()
        for ((track, index, _) in pairs) {
            if (track in matchedTracks || index in matchedBoxes) continue
            track.box = boxes[index]
            track.missed = 0
            matchedTracks += track
            matchedBoxes += index
        }
        tracks.filter { it !in matchedTracks }.forEach { it.missed += 1 }
        tracks.removeAll { it.missed > config.obstacleMaxMissedFrames }
        val added = boxes.indices
            .filter { it !in matchedBoxes }
            .map { VehicleTrack(nextId++, boxes[it].kind, boxes[it]) }
        tracks += added
        return matchedTracks.toList() + added
    }

    /**
     * 같은 차로 볼 점수. 겹치면 1 + IoU, 안 겹쳐도 가운데가 vehicleMaxShift 안이고 크기가 비슷하면 1 보다 작은 값이다.
     * 옆으로 빠르게 지나가는 차는 0.7초 사이에 제 폭보다 멀리 움직여 겹치지 않는다.
     */
    private fun matchScore(previous: ObjectBox, next: ObjectBox): Double? {
        val overlap = boxIou(previous, next)
        if (overlap >= config.vehicleTrackIou) return 1 + overlap
        val shift = abs(next.centerX - previous.centerX)
        val ratio = max(next.height, previous.height) / min(next.height, previous.height)
        return if (shift <= config.vehicleMaxShift && ratio <= config.vehicleMaxSizeRatio) 1 - shift else null
    }

    private fun boxIou(a: ObjectBox, b: ObjectBox): Double = iou(
        PersonBox(a.left, a.top, a.width, a.height, a.score),
        PersonBox(b.left, b.top, b.width, b.height, b.score),
    )

    private fun lateralM(x: Double, distanceM: Double, frame: DetectionFrame, focalPx: Double): Double =
        (x - 0.5) * frame.imageWidthPx * distanceM / focalPx
}
