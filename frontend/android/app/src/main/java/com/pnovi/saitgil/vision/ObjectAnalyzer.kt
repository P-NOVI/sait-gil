package com.pnovi.saitgil.vision

// 사람 밖의 클래스 박스로 가까운 장애물과 보행 신호등 상태를 판단한다.
// 차·이륜차는 VehicleTracker 가 박스 높이로 거리를 재고 움직이는지 보며, 기둥·장애물·계단은 ObstacleTracker 가 바닥 기준 거리를 잰다.
// 움직이는 차는 바로 알리고, 장애물·서 있는 차는 가장 가까운 것부터 하나씩 알린다. 읽을 문장은 화면이 만든다.
// Android 클래스를 쓰지 않아 가짜 박스로 JVM 단위 테스트를 할 수 있다.

import kotlin.math.abs

/** 사람 밖의 박스 하나. 좌표는 PersonBox 처럼 세운 화면 기준 0~1 값이다 */
data class ObjectBox(
    val kind: DetectedClass,
    val left: Double,
    val top: Double,
    val width: Double,
    val height: Double,
    val score: Double,
) {
    val right: Double get() = left + width
    val bottom: Double get() = top + height
    val centerX: Double get() = left + width / 2
}

/** 걷는 길 앞에 있으면 알리는 장애물 클래스 */
val OBSTACLE_CLASSES: Set<DetectedClass> = setOf(
    DetectedClass.TWO_WHEELER,
    DetectedClass.CAR,
    DetectedClass.OBSTACLE,
    DetectedClass.POLE,
    DetectedClass.STAIRS,
)

// 걷는 길 앞으로 보는 칸(11~1시). 양 끝 칸(10시·2시)에만 걸친 장애물은 알리지 않는다.
internal val AHEAD_SECTORS: Set<Int> =
    CLOCK_SECTORS.indices.filter { CLOCK_SECTORS[it] in setOf(11, 12, 1) }.toSet()

/** 박스가 앞쪽 칸(11~1시)에 걸치는지 */
internal fun overlapsAhead(box: ObjectBox): Boolean =
    (sectorOf(box.left)..sectorOf(box.right)).any { it in AHEAD_SECTORS }

/** distanceM 앞에서 영상 가로 위치 x(0~1)의 옆 위치(m). 카메라 정면 기준이고 오른쪽이 + 다 */
internal fun lateralM(x: Double, distanceM: Double, frame: DetectionFrame, focalPx: Double): Double =
    (x - 0.5) * frame.imageWidthPx * distanceM / focalPx

/**
 * distanceM 앞 박스의 좌우 끝이 걷는 길 통로(카메라 정면 좌우 corridorHalfWidthM)와 겹치는지.
 * 화면 칸은 멀수록 넓은 곳을 덮어 인도 가장자리 기둥·주차한 차까지 들어오므로 미터로 본다(#133).
 */
internal fun inCorridor(
    box: ObjectBox,
    distanceM: Double,
    frame: DetectionFrame,
    config: VisionConfig,
    focalPx: Double = focalLengthPx(frame, config),
): Boolean {
    val leftM = lateralM(box.left, distanceM, frame, focalPx)
    val rightM = lateralM(box.right, distanceM, frame, focalPx)
    return rightM >= -config.corridorHalfWidthM && leftM <= config.corridorHalfWidthM
}

/**
 * 읽을 시계 방향. 앞쪽 칸에 걸치면 그중 박스 가운데에 가장 가까운 칸, 아니면 박스 가운데 칸이다.
 * 앞쪽에 걸쳐 알렸는데 가운데가 옆 칸이라 "10시 방향"이라고 읽지 않게 한다.
 */
internal fun directionOf(box: ObjectBox, labels: List<Int>): Int {
    val center = sectorOf(box.centerX)
    val ahead = (sectorOf(box.left)..sectorOf(box.right)).filter { it in AHEAD_SECTORS }
    return labels[ahead.minByOrNull { abs(it - center) } ?: center]
}

/** 보행 신호등 클래스와 그 상태 */
private val SIGNAL_STATES: Map<DetectedClass, SignalState> = mapOf(
    DetectedClass.PED_SIGNAL_RED to SignalState.RED,
    DetectedClass.PED_SIGNAL_OTHER to SignalState.OTHER,
)

/** 이번 프레임에 앞쪽 가까이 보인 장애물 하나. direction 은 시계 방향(10~2시)이다 */
data class ObstacleSighting(val kind: DetectedClass, val direction: Int)

/**
 * 프레임 하나를 판단한 결과.
 * seen 은 이번 프레임에 보인 장애물(클래스마다 하나)로, 확인 없이 화면에 바로 보여 준다.
 * alerts 는 이번 프레임에 알릴 장애물이다. 움직이는 차를 앞에, 장애물·서 있는 차는 많아야 하나를 뒤에 둔다.
 * vehicles 는 추적 중인 차의 거리·움직임으로, 실기기 로그로 기준을 맞출 때 쓴다.
 */
data class ObjectAnalysis(
    val signal: SignalState?,
    val alerts: List<VisionAlert>,
    val seen: List<ObstacleSighting> = emptyList(),
    val vehicles: List<VehicleState> = emptyList(),
)

/** 안내를 시작할 때마다 새로 만든다. 앞 프레임들을 기억해 잘못 잡힌 박스와 반복 알림을 거른다. */
class ObjectAnalyzer(private val config: VisionConfig = VisionConfig()) {
    private val vehicles = VehicleTracker(config)
    private val obstacles = ObstacleTracker(config)

    // 장애물·서 있는 차를 마지막으로 알린 시각. 앞 알림을 읽는 동안 다음 것을 보내지 않는다.
    private var lastNoticeMs: Long? = null

    // 장애물·서 있는 차를 종류·방향마다 마지막으로 알린 시각·거리. 추적이 끊겨 같은 물체가 새로 잡혀도 다시 알리지 않는다.
    private val lastNoticeBy = mutableMapOf<Pair<DetectedClass, Int>, NoticeMark>()

    // 걸음 속도가 standingSpeedMps 보다 느려지기 시작한 프레임 시각. 걷고 있거나 속도를 모르면 null
    private var slowSinceMs: Long? = null

    private var signal: SignalState? = null
    private var signalCandidate: SignalState? = null
    private var signalCandidateFrames = 0

    fun analyze(frame: DetectionFrame): ObjectAnalysis {
        val labels = clockLabels(frame, config)
        val vehicleAnalysis = vehicles.analyze(frame, labels)
        // 멀어지는 차는 음성뿐 아니라 화면의 앞 장애물에서도 뺀다.
        // 걸음을 뺀 판단이 멀어짐이어도 카메라에서 본 거리가 실제로 늘지 않으면 뺀다. 따라 걸을 때나 GPS 걸음 속도 오차로
        // 서 있는 차·나란히 가는 차가 화면에서 사라지지 않게 한다. 걸음 속도를 모르면(0) 두 판단이 같다.
        val leaving = vehicleAnalysis.states
            .filter { it.motion == VehicleMotion.LEAVING && (it.cameraClosingMps ?: 0.0) <= -config.vehicleLeavingMps }
            .map { it.box }
        val seen = OBSTACLE_CLASSES.mapNotNull { kind ->
            // 같은 클래스가 여럿이면 가장 가까운(아래 끝이 가장 아래인) 것을 본다.
            frame.objects
                .filter { it.kind == kind && isAhead(it, frame) && it !in leaving }
                .maxByOrNull { it.bottom }
                ?.let { ObstacleSighting(kind, directionOf(it, labels)) }
        }
        val warnings = vehicleAnalysis.alerts.map {
            VisionAlert(
                kind = AlertKind.OBSTACLE,
                message = it.kind.wire,
                distanceM = it.distanceM,
                objectClass = it.kind,
                direction = it.direction,
                moving = true,
            )
        }
        val stillNotices = vehicleAnalysis.notices + obstacles.analyze(frame, labels)
        // 서 있으면 장애물·서 있는 차는 알리지 않는다. 알리지 않은 것은 다시 걸을 때 알린다.
        val notice = if (isStanding(frame)) null else nearestNotice(stillNotices, frame)
        return ObjectAnalysis(followSignal(frame), warnings + listOfNotNull(notice), seen, vehicleAnalysis.states)
    }

    /**
     * 같은 종류·방향으로 알렸던 물체를 추적이 끊겨 다시 잡은 것인지. stillRepeatMs 안에, 알린 거리에서 그동안 걸은 만큼
     * 가까워진 곳(± renoticeToleranceM)에 있으면 같은 물체로 본다. 그보다 멀리 있으면 뒤따라 선 다른 물체다.
     * 걸음 속도를 모르면 0 ~ renoticeMaxWalkMps 로 걸었을 수 있다고 본다.
     */
    private fun isNoticedAgain(notice: StillNotice, frame: DetectionFrame): Boolean {
        val mark = lastNoticeBy[notice.kind to notice.direction] ?: return false
        val elapsedMs = frame.timeMs - mark.atMs
        if (elapsedMs >= config.stillRepeatMs) return false
        val elapsedS = elapsedMs / 1_000.0
        val speed = frame.walkSpeedMps
        val nearestM = mark.distanceM - (speed ?: config.renoticeMaxWalkMps) * elapsedS - config.renoticeToleranceM
        val farthestM = mark.distanceM - (speed ?: 0.0) * elapsedS + config.renoticeToleranceM
        return notice.distanceM in nearestM..farthestM
    }

    /** 알린 시각과 그때 거리 */
    private class NoticeMark(val atMs: Long, val distanceM: Double)

    /**
     * 화면에 보일 앞쪽 가까운 장애물인지. 기둥·장애물·계단은 알릴 때처럼 걷는 길 앞 가까이(nearObstacleDistanceM) 있어야 한다.
     * 차·이륜차는 앞쪽 칸(11~1시)에 걸치고 박스 높이로 잰 거리가 정한 거리 안이어야 한다.
     * 차·이륜차 박스 아래가 영상 끝에 닿아 잘렸으면 바퀴가 안 보일 만큼 가까운 것으로 본다.
     */
    private fun isAhead(box: ObjectBox, frame: DetectionFrame): Boolean {
        if (box.kind !in VEHICLE_CLASSES) return nearObstacleDistanceM(box, frame, config) != null
        if (!overlapsAhead(box)) return false
        if (isCutOffAtBottom(box, config)) return true
        val distance = vehicleDistanceM(box, frame, config) ?: return false
        return distance <= vehicleNearM(box.kind, config)
    }

    /**
     * 서 있는지. GPS 걸음 속도가 standingSpeedMps 보다 느린 상태가 standingConfirmMs 이어져야 서 있는 것으로 본다.
     * 붐비는 곳에서 잠깐 멈칫하거나 GPS 속력이 잠깐 0 으로 튀어도 장애물 알림을 끄지 않는다. 걸음 속도를 모르면 걷는 것으로 본다.
     * 느려진 시각을 남기므로 프레임마다 부른다.
     */
    private fun isStanding(frame: DetectionFrame): Boolean {
        val slow = frame.walkSpeedMps?.let { it < config.standingSpeedMps } ?: false
        slowSinceMs = if (slow) slowSinceMs ?: frame.timeMs else null
        val since = slowSinceMs ?: return false
        return frame.timeMs - since >= config.standingConfirmMs
    }

    /**
     * 알릴 수 있는 장애물·서 있는 차 중 가장 가까운 것 하나를 알림으로 바꾼다. 나머지는 다음 프레임에 다시 고른다.
     * 화면은 읽는 중에 온 장애물 알림을 잠깐만 기다리므로, 앞 알림 뒤 noticeGapMs 안에는 고르지 않는다.
     * 더 가까운 것이 나타나도 간격을 건너뛰지 않는다. 앞 말을 읽는 중에 보내면 화면이 obstacleMaxWaitMs 뒤 버리는데,
     * 여기서는 알린 것으로 표시해 다시 알리지 않게 된다. 고르지 않은 후보는 간격이 지난 뒤 다시 고른다.
     * 추적이 끊겨 다시 잡힌, 이미 알린 물체(isNoticedAgain)는 고르지 않는다.
     */
    private fun nearestNotice(notices: List<StillNotice>, frame: DetectionFrame): VisionAlert? {
        val nowMs = frame.timeMs
        val last = lastNoticeMs
        if (last != null && nowMs - last < config.noticeGapMs) return null
        val nearest = notices.filterNot { isNoticedAgain(it, frame) }.minByOrNull { it.distanceM } ?: return null
        nearest.notified()
        lastNoticeMs = nowMs
        lastNoticeBy[nearest.kind to nearest.direction] = NoticeMark(nowMs, nearest.distanceM)
        return VisionAlert(
            kind = AlertKind.OBSTACLE,
            message = nearest.kind.wire,
            distanceM = nearest.distanceM,
            objectClass = nearest.kind,
            direction = nearest.direction,
            moving = if (nearest.kind in VEHICLE_CLASSES) false else null,
        )
    }

    /**
     * 신호등 상태를 이번 프레임으로 고친다. 교차로에서는 옆 방향 신호등도 보이므로
     * 가운데가 앞쪽 칸(11~1시)에 있는 신호등만 보고, 여럿이면 가장 큰(가까운) 것의 색을 쓴다. 크기가 같으면 빨간불로 본다.
     * 같은 상태가 연달아 몇 프레임 보여야 바꾼다.
     */
    private fun followSignal(frame: DetectionFrame): SignalState? {
        val ahead = frame.objects
            .filter { it.kind in SIGNAL_STATES && sectorOf(it.centerX) in AHEAD_SECTORS }
            .maxWithOrNull(compareBy({ it.width * it.height }, { it.kind == DetectedClass.PED_SIGNAL_RED }))
        val seen = ahead?.let { SIGNAL_STATES.getValue(it.kind) }
        if (seen == signalCandidate) {
            signalCandidateFrames += 1
        } else {
            signalCandidate = seen
            signalCandidateFrames = 1
        }
        if (signalCandidateFrames >= config.signalConfirmFrames) signal = signalCandidate
        return signal
    }
}
