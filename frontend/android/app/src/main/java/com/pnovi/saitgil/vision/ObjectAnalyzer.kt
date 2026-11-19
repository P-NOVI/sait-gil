package com.pnovi.saitgil.vision

// 사람 밖의 클래스 박스로 가까운 장애물과 보행 신호등 상태를 판단한다.
// 거리는 재지 않고, 박스 아래 끝 위치로 가까운지만 본다. 읽을 문장은 화면이 만든다.
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

/** 빨리 지나가 여러 프레임 연달아 잡히기 어려운 장애물. fastObstacleConfirmFrames 만큼만 보이면 알린다 */
private val FAST_OBSTACLE_CLASSES: Set<DetectedClass> = setOf(
    DetectedClass.TWO_WHEELER,
    DetectedClass.CAR,
)

// 걷는 길 앞으로 보는 칸(11~1시). 양 끝 칸(10시·2시)에만 걸친 장애물은 알리지 않는다.
private val AHEAD_SECTORS: Set<Int> =
    CLOCK_SECTORS.indices.filter { CLOCK_SECTORS[it] in setOf(11, 12, 1) }.toSet()

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
 * alerts 는 여러 프레임 확인을 거쳐 이번 프레임에 알릴 장애물이다.
 */
data class ObjectAnalysis(
    val signal: SignalState?,
    val alerts: List<VisionAlert>,
    val seen: List<ObstacleSighting> = emptyList(),
)

/** 클래스 하나의 가까운 장애물을 지켜본 기록 */
private class ObstacleTrack {
    var seenFrames = 0
    var missedFrames = 0
    var alertedAtMs: Long? = null
}

/** 안내를 시작할 때마다 새로 만든다. 앞 프레임들을 기억해 잘못 잡힌 박스와 반복 알림을 거른다. */
class ObjectAnalyzer(private val config: VisionConfig = VisionConfig()) {
    // 장애물은 클래스마다 하나로 기억한다. 기둥 A를 알린 뒤 잠깐(obstacleMaxMissedFrames 안) 사이에
    // 기둥 B가 보이면 같은 기둥으로 보고 다시 알리지 않는다(obstacleRepeatMs 가 지나면 다시 알린다).
    // 초당 1~2장 추론과 흔들리는 목걸이 카메라로는 박스를 이어 같은 물체인지 가리기 어려워 단순하게 둔다.
    private val tracks = mutableMapOf<DetectedClass, ObstacleTrack>()

    private var signal: SignalState? = null
    private var signalCandidate: SignalState? = null
    private var signalCandidateFrames = 0

    fun analyze(frame: DetectionFrame): ObjectAnalysis {
        val labels = clockLabels(frame, config)
        val seen = OBSTACLE_CLASSES.mapNotNull { kind ->
            // 같은 클래스가 여럿이면 가장 가까운(아래 끝이 가장 아래인) 것을 본다.
            frame.objects
                .filter { it.kind == kind && isNearAhead(it) }
                .maxByOrNull { it.bottom }
                ?.let { ObstacleSighting(kind, labels[aheadSector(it)]) }
        }
        OBSTACLE_CLASSES.filter { kind -> seen.none { it.kind == kind } }.forEach(::miss)
        val alerts = seen
            .filter { seenAndDue(it.kind, frame.timeMs) }
            .map {
                VisionAlert(
                    kind = AlertKind.OBSTACLE,
                    message = it.kind.wire,
                    objectClass = it.kind,
                    direction = it.direction,
                )
            }
        return ObjectAnalysis(followSignal(frame), alerts, seen)
    }

    /** 박스 아래 끝이 가까운 바닥에 닿고, 앞쪽 칸에 걸쳐 있는지 */
    private fun isNearAhead(box: ObjectBox): Boolean =
        box.bottom >= config.obstacleNearBottom &&
            (sectorOf(box.left)..sectorOf(box.right)).any { it in AHEAD_SECTORS }

    /**
     * 읽을 방향의 칸. 박스가 걸친 앞쪽 칸 중 박스 가운데에 가장 가까운 칸이다.
     * 앞쪽에 걸쳐 알렸는데 가운데가 옆 칸이라 "10시 방향"이라고 읽지 않게 한다. isNearAhead 를 통과한 박스만 넣는다.
     */
    private fun aheadSector(box: ObjectBox): Int {
        val center = sectorOf(box.centerX)
        return (sectorOf(box.left)..sectorOf(box.right))
            .filter { it in AHEAD_SECTORS }
            .minBy { abs(it - center) }
    }

    /**
     * 이번 프레임에 안 보였다. 아직 알리지 않았으면 연달아 본 수를 처음부터 다시 센다.
     * 알린 뒤 잠깐 안 보인 것은 그대로 두고, 오래 안 보이면 지나간 것으로 보고 지운다.
     */
    private fun miss(kind: DetectedClass) {
        val track = tracks[kind] ?: return
        if (track.alertedAtMs == null) track.seenFrames = 0
        track.missedFrames += 1
        if (track.missedFrames > config.obstacleMaxMissedFrames) tracks.remove(kind)
    }

    /**
     * 이번 프레임에 보였다고 적고, 지금 알릴 때인지 돌려준다.
     * 연달아 몇 프레임 보여야 처음 알리고, 계속 보이면 일정 시간마다 다시 알린다.
     */
    private fun seenAndDue(kind: DetectedClass, nowMs: Long): Boolean {
        val track = tracks.getOrPut(kind, ::ObstacleTrack)
        track.seenFrames += 1
        track.missedFrames = 0
        val confirmFrames =
            if (kind in FAST_OBSTACLE_CLASSES) config.fastObstacleConfirmFrames else config.obstacleConfirmFrames
        if (track.seenFrames < confirmFrames) return false
        val alertedAt = track.alertedAtMs
        if (alertedAt != null && nowMs - alertedAt < config.obstacleRepeatMs) return false
        track.alertedAtMs = nowMs
        return true
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
