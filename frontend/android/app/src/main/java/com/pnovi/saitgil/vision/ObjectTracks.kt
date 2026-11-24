package com.pnovi.saitgil.vision

// 차·장애물 박스를 프레임마다 이어 같은 물체로 본다.
// VehicleTracker 와 ObstacleTracker 가 같이 쓴다. Android 클래스를 쓰지 않는다.

import kotlin.math.abs
import kotlin.math.max
import kotlin.math.min

/** 프레임마다 이어 보는 물체 하나 */
internal open class BoxTrack(val kind: DetectedClass, var box: ObjectBox) {
    /** 마지막으로 보인 프레임 시각(ms) */
    var lastSeenMs = 0L
}

/**
 * 새 박스를 tracks 의 같은 클래스 물체와 짝지어 tracks 를 고친다. 많이 겹치는 것부터, 안 겹치면 가운데가 가까운 것끼리.
 * 짝이 없는 박스는 newTrack 으로 더하고, objectLostMs 보다 오래 안 보인 물체는 뺀다.
 * 이번 프레임에 보인 물체를 이어 본 것, 새로 더한 것 순서로 돌려준다.
 */
internal fun <T : BoxTrack> updateTracks(
    tracks: MutableList<T>,
    boxes: List<ObjectBox>,
    nowMs: Long,
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
        track.lastSeenMs = nowMs
        matchedTracks += track
        matchedBoxes += index
    }
    tracks.removeAll { nowMs - it.lastSeenMs > config.objectLostMs }
    val added = boxes.indices
        .filter { it !in matchedBoxes }
        .map { index -> newTrack(boxes[index]).also { it.lastSeenMs = nowMs } }
    tracks += added
    return matchedTracks.toList() + added
}

/**
 * 같은 물체로 볼 점수. 겹치면 1 + IoU, 안 겹쳐도 가운데가 objectMaxShift 안이고 크기가 비슷하면 1 보다 작은 값이다.
 * 옆으로 빠르게 지나가는 차와, 목걸이가 흔들려 옆으로 밀린 가는 기둥은 0.7초 사이에 제 폭보다 멀리 움직여 겹치지 않는다.
 */
private fun sameObjectScore(previous: ObjectBox, next: ObjectBox, config: VisionConfig): Double? {
    val overlap = iou(
        PersonBox(previous.left, previous.top, previous.width, previous.height, previous.score),
        PersonBox(next.left, next.top, next.width, next.height, next.score),
    )
    if (overlap >= config.objectTrackIou) return 1 + overlap
    val shift = abs(next.centerX - previous.centerX)
    val ratio = max(next.height, previous.height) / min(next.height, previous.height)
    return if (shift <= config.objectMaxShift && ratio <= config.objectMaxSizeRatio) 1 - shift else null
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
