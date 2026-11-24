package com.pnovi.saitgil.vision

// 차·장애물 박스를 프레임마다 이어 같은 물체로 보고, 서 있는 물체를 알린 기록을 남긴다.
// VehicleTracker 와 ObstacleTracker 가 같이 쓴다. Android 클래스를 쓰지 않는다.

import kotlin.math.abs
import kotlin.math.max
import kotlin.math.min

/** 프레임마다 이어 보는 물체 하나 */
internal open class BoxTrack(val kind: DetectedClass, var box: ObjectBox) {
    /** 연달아 안 보인 프레임 수 */
    var missed = 0
}

/**
 * 새 박스를 tracks 의 같은 클래스 물체와 짝지어 tracks 를 고친다. 많이 겹치는 것부터, 안 겹치면 가운데가 가까운 것끼리.
 * 짝이 없는 박스는 newTrack 으로 더하고, obstacleMaxMissedFrames 보다 오래 안 보인 물체는 뺀다.
 * 이번 프레임에 보인 물체를 이어 본 것, 새로 더한 것 순서로 돌려준다.
 */
internal fun <T : BoxTrack> updateTracks(
    tracks: MutableList<T>,
    boxes: List<ObjectBox>,
    config: VisionConfig,
    newTrack: (ObjectBox) -> T,
): List<T> {
    val pairs = tracks
        .flatMap { track -> boxes.indices.filter { boxes[it].kind == track.kind }.map { track to it } }
        .mapNotNull { (track, index) -> sameObjectScore(track.box, boxes[index], config)?.let { Triple(track, index, it) } }
        .sortedByDescending { it.third }
    val matchedTracks = mutableSetOf<T>()
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
    val added = boxes.indices.filter { it !in matchedBoxes }.map { newTrack(boxes[it]) }
    tracks += added
    return matchedTracks.toList() + added
}

/**
 * 같은 물체로 볼 점수. 겹치면 1 + IoU, 안 겹쳐도 가운데가 objectMaxShift 안이고 크기가 비슷하면 1 보다 작은 값이다.
 * 옆으로 빠르게 지나가는 차와, 목걸이가 흔들려 옆으로 밀린 가는 기둥은 0.7초 사이에 제 폭보다 멀리 움직여 겹치지 않는다.
 * 신호등은 옆 신호등으로 넘어가지 않게 maxShift 를 좁혀 부른다(SignalTracker).
 */
internal fun sameObjectScore(
    previous: ObjectBox,
    next: ObjectBox,
    config: VisionConfig,
    maxShift: Double = config.objectMaxShift,
): Double? {
    val overlap = iou(
        PersonBox(previous.left, previous.top, previous.width, previous.height, previous.score),
        PersonBox(next.left, next.top, next.width, next.height, next.score),
    )
    if (overlap >= config.objectTrackIou) return 1 + overlap
    val shift = abs(next.centerX - previous.centerX)
    val ratio = max(next.height, previous.height) / min(next.height, previous.height)
    return if (shift <= maxShift && ratio <= config.objectMaxSizeRatio) 1 - shift else null
}

/**
 * 서 있는 물체 하나를 알린 기록. 처음 한 번 알리고, closeM 밖에서 알린 물체가 closeM 안으로 들어오면 한 번 더 알린다.
 */
internal class NoticeRecord {
    private var firstAtM: Double? = null
    private var again = false

    /** 한 번이라도 알렸는지 */
    val noticed: Boolean get() = firstAtM != null

    /** 지금 거리에서 알릴 차례인지 */
    fun due(distanceM: Double, closeM: Double): Boolean {
        val first = firstAtM ?: return true
        return !again && first > closeM && distanceM <= closeM
    }

    fun mark(distanceM: Double) {
        if (firstAtM == null) firstAtM = distanceM else again = true
    }
}

/**
 * 지금 알릴 수 있는 서 있는 물체(기둥·장애물·계단·서 있는 차) 하나.
 * 여럿이면 ObjectAnalyzer 가 가장 가까운 것 하나만 골라 notified 를 부른다. 고르지 않은 것은 다음 프레임에 다시 후보가 된다.
 */
class StillNotice(
    val kind: DetectedClass,
    val direction: Int,
    val distanceM: Double,
    private val onNotified: () -> Unit,
) {
    fun notified() = onNotified()
}
