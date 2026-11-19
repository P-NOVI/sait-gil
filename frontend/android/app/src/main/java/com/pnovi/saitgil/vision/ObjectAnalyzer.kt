package com.pnovi.saitgil.vision

// 사람 밖의 클래스 박스로 가까운 장애물과 보행 신호등 상태를 판단한다.
// 거리는 재지 않고, 박스 아래 끝 위치로 가까운지만 본다. 읽을 문장은 화면이 만든다.
// Android 클래스를 쓰지 않아 가짜 박스로 JVM 단위 테스트를 할 수 있다.

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
private val AHEAD_SECTORS: Set<Int> =
    CLOCK_SECTORS.indices.filter { CLOCK_SECTORS[it] in setOf(11, 12, 1) }.toSet()

/** 프레임 하나를 판단한 결과. alerts 는 이번 프레임에 알릴 장애물(클래스마다 하나)이다 */
data class ObjectAnalysis(val signal: SignalState?, val alerts: List<VisionAlert>)

/** 클래스 하나의 가까운 장애물을 지켜본 기록 */
private class ObstacleTrack {
    var seenFrames = 0
    var missedFrames = 0
    var alertedAtMs: Long? = null
}

/** 안내를 시작할 때마다 새로 만든다. 앞 프레임들을 기억해 잘못 잡힌 박스와 반복 알림을 거른다. */
class ObjectAnalyzer(private val config: VisionConfig = VisionConfig()) {
    private val tracks = mutableMapOf<DetectedClass, ObstacleTrack>()

    private var signal: SignalState? = null
    private var signalCandidate: SignalState? = null
    private var signalCandidateFrames = 0

    fun analyze(frame: DetectionFrame): ObjectAnalysis {
        val labels = clockLabels(frame, config)
        val alerts = OBSTACLE_CLASSES.mapNotNull { kind ->
            // 같은 클래스가 여럿이면 가장 가까운(아래 끝이 가장 아래인) 것을 알린다.
            val nearest = frame.objects
                .filter { it.kind == kind && isNearAhead(it) }
                .maxByOrNull { it.bottom }
            when {
                nearest == null -> {
                    miss(kind)
                    null
                }
                seenAndDue(kind, frame.timeMs) -> VisionAlert(
                    kind = AlertKind.OBSTACLE,
                    message = kind.wire,
                    objectClass = kind,
                    direction = labels[sectorOf(nearest.centerX)],
                )
                else -> null
            }
        }
        return ObjectAnalysis(followSignal(frame), alerts)
    }

    /** 박스 아래 끝이 가까운 바닥에 닿고, 앞쪽 칸에 걸쳐 있는지 */
    private fun isNearAhead(box: ObjectBox): Boolean =
        box.bottom >= config.obstacleNearBottom &&
            (sectorOf(box.left)..sectorOf(box.right)).any { it in AHEAD_SECTORS }

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
        if (track.seenFrames < config.obstacleConfirmFrames) return false
        val alertedAt = track.alertedAtMs
        if (alertedAt != null && nowMs - alertedAt < config.obstacleRepeatMs) return false
        track.alertedAtMs = nowMs
        return true
    }

    /**
     * 신호등 상태를 이번 프레임으로 고친다. 빨간불이 하나라도 보이면 빨간불로 본다.
     * 같은 상태가 연달아 몇 프레임 보여야 바꾼다.
     */
    private fun followSignal(frame: DetectionFrame): SignalState? {
        val kinds = frame.objects.map { it.kind }
        val seen = when {
            DetectedClass.PED_SIGNAL_RED in kinds -> SignalState.RED
            DetectedClass.PED_SIGNAL_OTHER in kinds -> SignalState.OTHER
            else -> null
        }
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
