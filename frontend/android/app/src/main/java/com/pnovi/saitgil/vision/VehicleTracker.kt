package com.pnovi.saitgil.vision

// 차·이륜차 박스를 프레임마다 이어 같은 차로 추적하고, 움직이는지 판단해 알릴 차를 고른다.
// 거리는 박스 높이로, 옆 위치(m)는 박스 가로 위치와 거리로 잰다. 걷는 길은 카메라 정면의 좌우 corridorHalfWidthM 통로로 본다.
// Android 클래스를 쓰지 않아 가짜 박스로 JVM 단위 테스트를 할 수 있다.

import kotlin.math.abs

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
    /** 박스 높이로 잰 거리(m). 박스 아래가 잘렸으면 박스 폭으로 잰다. 잴 수 없으면 null */
    val distanceM: Double?,
    /** 박스 가운데의 옆 위치(m). 오른쪽이 + 다. 거리를 모르면 null */
    val lateralM: Double?,
    /** 차가 다가오는 속도(m/s). 거리가 줄어드는 속도에서 내 걸음 속도를 뺀 값이다. 지켜본 시간이 짧으면 null */
    val approachMps: Double?,
    /** 걷는 길 가운데로 들어오는 옆 속도(m/s). 지켜본 시간이 짧으면 null */
    val inwardMps: Double?,
    val motion: VehicleMotion,
    /** 이번 프레임의 박스. 멀어지는 차를 화면에 보이는 장애물에서 거를 때 쓴다 */
    val box: ObjectBox,
    /** 카메라에서 본 거리가 줄어드는 속도(m/s). 내 걸음을 빼지 않은 값이라 늘어나면 음수다. 지켜본 시간이 짧으면 null */
    val cameraClosingMps: Double? = null,
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

/**
 * 박스 폭으로 잰 차·이륜차 거리(m). 아래가 잘려 높이를 쓸 수 없는 가까운 차에 쓴다.
 * 옆모습이면 폭이 차 길이라 가깝게 나오지만, 움직임은 거리가 바뀌는 속도로 보므로 판단할 수 있다.
 */
fun vehicleWidthDistanceM(box: ObjectBox, frame: DetectionFrame, config: VisionConfig): Double? {
    val widthM = when (box.kind) {
        DetectedClass.CAR -> config.carWidthM
        DetectedClass.TWO_WHEELER -> config.twoWheelerWidthM
        else -> return null
    }
    val widthPx = box.width * frame.imageWidthPx
    if (widthPx <= 0.0) return null
    return focalLengthPx(frame, config) * widthM / widthPx
}

private data class VehicleSample(val timeMs: Long, val distanceM: Double, val lateralM: Double)

private class VehicleTrack(val id: Int, kind: DetectedClass, box: ObjectBox) : BoxTrack(kind, box) {
    val samples = ArrayDeque<VehicleSample>()

    /** 움직이는 차로 알렸는지 */
    var warned = false

    /** 이번 프레임에 다가오는 차로 보는 속도(m/s). 걸음 속도를 아는지에 따라 다르다 */
    var movingMps = 0.0

    /** 서 있는 차로 알렸는지. 같은 차는 한 번만 알린다 */
    var noticed = false
}

/**
 * 프레임 하나를 판단한 결과. alerts 는 이번 프레임에 바로 알릴 움직이는 차다.
 * notices 는 알릴 수 있는 서 있는 차로, 장애물과 거리를 비교해 ObjectAnalyzer 가 고른다.
 */
data class VehicleAnalysis(
    val alerts: List<VehicleAlert>,
    val states: List<VehicleState>,
    val notices: List<StillNotice> = emptyList(),
)

/** 바로 알릴 움직이는 차 하나. 거리가 null 이면 박스 아래가 잘릴 만큼 가깝다 */
data class VehicleAlert(
    val kind: DetectedClass,
    val direction: Int,
    val distanceM: Double?,
)

/** 안내를 시작할 때마다 새로 만든다. 같은 차는 한 번만 알린다. */
class VehicleTracker(private val config: VisionConfig = VisionConfig()) {
    private val tracks = mutableListOf<VehicleTrack>()
    private var nextId = 0

    // 클래스마다 마지막으로 알린 시각. 추적이 끊겨 같은 차가 새 차로 잡혀도 곧바로 다시 알리지 않게 한다.
    // 서 있는 차는 장애물과 함께 ObjectAnalyzer 가 종류·방향마다 stillRepeatMs 로 막는다.
    private val lastWarnMs = mutableMapOf<DetectedClass, Long>()

    fun analyze(frame: DetectionFrame, labels: List<Int>): VehicleAnalysis {
        val focalPx = focalLengthPx(frame, config)
        val boxes = frame.objects.filter { it.kind in VEHICLE_CLASSES }
        val seen = updateTracks(tracks, boxes, frame.timeMs, config) { VehicleTrack(nextId++, it.kind, it) }
        val states = seen.map { track -> measure(track, frame, focalPx) }
        val alerts = mutableListOf<VehicleAlert>()
        val notices = mutableListOf<StillNotice>()
        for ((track, state) in seen.zip(states)) {
            // 거리가 null 이면 박스 아래가 잘릴 만큼 가깝다.
            val distance = state.distanceM
            val inPath = distance?.let { inCorridor(track.box, it, frame, config, focalPx) } ?: overlapsAhead(track.box)
            if (shouldWarn(track, state, inPath, frame.timeMs)) {
                track.warned = true
                alerts += VehicleAlert(track.kind, directionOf(track.box, labels), distance)
            } else {
                stillNotice(track, state, inPath, labels)?.let(notices::add)
            }
        }
        return VehicleAnalysis(alerts, states, notices)
    }

    /** 이번 프레임의 거리·옆 위치를 기록하고 움직임을 판단한다 */
    private fun measure(track: VehicleTrack, frame: DetectionFrame, focalPx: Double): VehicleState {
        // 아래가 잘린 박스도 폭으로 거리를 재 기록을 이어 간다. 잘렸다고 움직임을 모르는 채로 두면 바로 "조심" 으로 알리게 된다.
        val distance = if (isCutOffAtBottom(track.box, config)) {
            vehicleWidthDistanceM(track.box, frame, config)
        } else {
            vehicleDistanceM(track.box, frame, config)
        }
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
        var cameraClosing: Double? = null
        var inward: Double? = null
        val first = track.samples.firstOrNull()
        val last = track.samples.lastOrNull()
        if (first != null && last != null && last.timeMs - first.timeMs >= config.vehicleMinSpanMs) {
            val spanS = (last.timeMs - first.timeMs) / 1_000.0
            // 거리가 줄어드는 속도는 카메라(사용자) 기준이라 내 걸음이 섞여 있다. 빼서 차 자체의 접근 속도로 만든다.
            // 거리는 박스 높이로 잰 카메라 축 방향 깊이라, 서 있는 차는 옆 위치와 관계없이 내 걸음만큼 줄어든다(걸음 × cosθ 가 아니다).
            // 폰이 걷는 방향을 본다고 가정한다. 옆을 보면 걸음이 덜 섞이므로 서 있는 차를 멀어지는 차로 볼 수 있다.
            cameraClosing = (first.distanceM - last.distanceM) / spanS
            approach = cameraClosing - (frame.walkSpeedMps ?: 0.0)
            inward = (abs(first.lateralM) - abs(last.lateralM)) / spanS
        }
        // 걸음 속도를 모르면(null) 걸음을 못 빼므로 예전 기준으로 판단한다. 멈춰 있음(0)과는 다르다.
        track.movingMps =
            if (frame.walkSpeedMps == null) config.vehicleMovingUnknownWalkMps else config.vehicleMovingMps
        val motion = motionOf(track, approach, inward)
        return VehicleState(track.id, track.kind, distance, lateral, approach, inward, motion, track.box, cameraClosing)
    }

    /**
     * 아주 빠르게 다가오면 vehicleMinSpanMs 만 보고 바로, 그 밖에는 vehicleMotionSpanMs 이상 지켜본 뒤 판단한다.
     * 박스 크기로 잰 거리는 프레임마다 흔들려 짧게 잰 속도는 오차가 크다.
     */
    private fun motionOf(track: VehicleTrack, approach: Double?, inward: Double?): VehicleMotion = when {
        approach == null || inward == null -> VehicleMotion.UNKNOWN
        approach >= config.vehicleFastMps -> VehicleMotion.APPROACHING
        track.samples.last().timeMs - track.samples.first().timeMs < config.vehicleMotionSpanMs -> VehicleMotion.UNKNOWN
        approach >= track.movingMps -> VehicleMotion.APPROACHING
        inward >= config.vehicleCrossingMps -> VehicleMotion.CROSSING
        approach <= -config.vehicleLeavingMps -> VehicleMotion.LEAVING
        else -> VehicleMotion.STILL
    }

    /**
     * 움직이는 차로 바로 알릴지. 같은 차는 한 번만 알린다.
     * - 걷는 길로 다가오거나 들어오는 차는 가까운 거리(carNearM·twoWheelerNearM) 안이면 알린다.
     * - 들어오는 차도 걷는 길에 걸쳐야 알린다. 몸을 돌리면 서 있는 차도 옆으로 움직인 것처럼 잡혀서다.
     * - vehicleMotionSpanMs 만큼 지켜보기 전이라도 길 위 vehicleImmediateM 안에서 movingMps(vehicleMovingMps, 걸음 속도를 모르면 vehicleMovingUnknownWalkMps) 넘게 다가오면 알린다.
     *   한 프레임만 보고는 알리지 않는다.
     * - 멀어지는 차(LEAVING)는 알리지 않는다.
     */
    private fun shouldWarn(track: VehicleTrack, state: VehicleState, inPath: Boolean, nowMs: Long): Boolean {
        if (track.warned) return false
        val distance = state.distanceM
        val near = distance == null || distance <= vehicleNearM(track.kind, config)
        val veryNear = distance == null || distance <= config.vehicleImmediateM
        val warn = when (state.motion) {
            VehicleMotion.APPROACHING -> near && inPath
            VehicleMotion.CROSSING -> near && inPath
            VehicleMotion.UNKNOWN -> veryNear && inPath && (state.approachMps ?: 0.0) >= track.movingMps
            else -> false
        }
        if (!warn || !elapsed(track.kind, lastWarnMs, config.vehicleWarnRepeatMs, nowMs)) return false
        lastWarnMs[track.kind] = nowMs
        return true
    }

    /**
     * 서 있는 차가 길 위 obstacleNearM 안이면 장애물처럼 알릴 후보로 낸다.
     * 같은 차는 한 번만 내고, 움직이는 차로 알린 차는 내지 않는다.
     */
    private fun stillNotice(track: VehicleTrack, state: VehicleState, inPath: Boolean, labels: List<Int>): StillNotice? {
        val distance = state.distanceM ?: return null
        if (state.motion != VehicleMotion.STILL || !inPath || distance > config.obstacleNearM) return null
        if (track.warned || track.noticed) return null
        return StillNotice(track.kind, directionOf(track.box, labels), distance) { track.noticed = true }
    }

    /** 이 클래스를 마지막으로 알린 뒤 repeatMs 가 지났는지 */
    private fun elapsed(kind: DetectedClass, last: Map<DetectedClass, Long>, repeatMs: Long, nowMs: Long): Boolean {
        val at = last[kind] ?: return true
        return nowMs - at >= repeatMs
    }
}
