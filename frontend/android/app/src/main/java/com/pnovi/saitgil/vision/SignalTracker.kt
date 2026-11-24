package com.pnovi.saitgil.vision

// 보행 신호등 하나를 골라 따라가며 상태를 정한다(#132). Android 클래스를 쓰지 않아 JVM 단위 테스트로 본다.
// 매 프레임 가장 큰 신호등을 새로 고르면 옆 신호등으로 넘어가도 모르고, 빨간불이 잠깐 다르게 보여도 바뀐 것으로 읽었다.

import kotlin.math.abs

/** 보행 신호등 클래스와 그 상태 */
private val SIGNAL_STATES: Map<DetectedClass, SignalState> = mapOf(
    DetectedClass.PED_SIGNAL_RED to SignalState.RED,
    DetectedClass.PED_SIGNAL_OTHER to SignalState.OTHER,
)

/**
 * 프레임 하나를 본 결과. state 는 확정된 신호등 상태(안 보이면 null),
 * box 는 이번 프레임에 따라간 신호등 박스(못 잡았으면 null), picked 는 이번 프레임에 신호등을 새로 골랐는지다.
 * id 는 따라가는 신호등 번호로, 새로 고를 때마다 늘어난다. 화면은 번호가 바뀌면 다른 신호등으로 보고 읽은 기록을 지운다.
 */
data class SignalReading(val state: SignalState?, val box: ObjectBox?, val picked: Boolean, val id: Int)

/** 안내를 시작할 때마다 새로 만든다 */
class SignalTracker(private val config: VisionConfig = VisionConfig()) {
    private var track: ObjectBox? = null
    private var trackSeenMs = 0L

    private var state: SignalState? = null
    private var candidate: SignalState? = null
    private var candidateSinceMs = 0L
    private var candidateSeenMs = 0L
    private var id = 0

    fun update(frame: DetectionFrame): SignalReading {
        val now = frame.timeMs
        val ahead = frame.objects.filter {
            it.kind in SIGNAL_STATES && abs(it.centerX - CENTER) <= config.signalAheadHalfWidth
        }
        var picked = false
        var seen = track?.let { previous -> sameSignal(previous, ahead) }
        if (seen == null && (track == null || now - trackSeenMs > config.signalLostMs)) {
            seen = nearestToCenter(ahead)
            picked = seen != null
            if (seen == null) track = null
        }
        if (picked) startOver(now)
        if (seen != null) {
            track = seen
            trackSeenMs = now
        }
        confirm(seen?.let { SIGNAL_STATES.getValue(it.kind) }, now)
        return SignalReading(state, seen, picked, id)
    }

    /**
     * 새로 고른 신호등은 처음부터 센다. 앞 신호등에서 정한 상태와 세던 시간을 이어 가면
     * 다른 신호등의 불을 바뀐 것으로 읽거나, 앞 신호등을 잘못 본 시각부터 세어 일찍 확정한다.
     */
    private fun startOver(now: Long) {
        id += 1
        state = null
        candidate = null
        candidateSinceMs = now
        candidateSeenMs = now
    }

    /** 따라가던 신호등과 같은 박스. 빨간불에서 바뀌면 클래스가 달라지므로 클래스는 보지 않는다 */
    private fun sameSignal(previous: ObjectBox, boxes: List<ObjectBox>): ObjectBox? =
        boxes
            .mapNotNull { box -> sameObjectScore(previous, box, config, config.signalMaxShift)?.let { box to it } }
            .maxByOrNull { it.second }
            ?.first

    /**
     * 새로 고를 신호등. 길을 건널 때 바라보는 건너편 신호등은 가운데에 있으므로 가운데에 가장 가까운 것을 고른다.
     * 거리가 같으면 빨간불을 고른다. 빨간불을 놓치는 것이 더 위험해서다.
     */
    private fun nearestToCenter(boxes: List<ObjectBox>): ObjectBox? =
        boxes.minWithOrNull(
            compareBy<ObjectBox>({ abs(it.centerX - CENTER) }, { it.kind != DetectedClass.PED_SIGNAL_RED }),
        )

    /**
     * 같은 상태가 정한 시간만큼 이어져야 바꾼다. 빨간불은 빨리, 빨간불이 아닌 것은 늦게 바꾼다.
     * 신호등을 잠깐 못 잡은 프레임(null)은 signalLostMs 까지 넘기고 세던 시간을 이어 간다.
     */
    private fun confirm(seen: SignalState?, now: Long) {
        when {
            seen == null && candidate != null && now - candidateSeenMs > config.signalLostMs -> {
                candidate = null
                candidateSinceMs = now
            }
            seen == null -> Unit
            seen == candidate -> candidateSeenMs = now
            else -> {
                candidate = seen
                candidateSinceMs = now
                candidateSeenMs = now
            }
        }
        val needMs = when (candidate) {
            SignalState.RED -> config.signalRedConfirmMs
            SignalState.OTHER -> config.signalOtherConfirmMs
            null -> 0L
        }
        if (now - candidateSinceMs >= needMs) state = candidate
    }

    private companion object {
        // 영상 가로 가운데(0~1)
        const val CENTER = 0.5
    }
}
