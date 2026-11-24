package com.pnovi.saitgil.vision

// 기둥·장애물·계단 박스를 프레임마다 이어 같은 물체로 추적하고, 바닥 기준 거리로 알릴 것을 고른다.
// Android 클래스를 쓰지 않아 가짜 박스로 JVM 단위 테스트를 할 수 있다.

/** 움직이지 않는 장애물 클래스. 차·이륜차 밖의 장애물이다 */
val FIXED_OBSTACLE_CLASSES: Set<DetectedClass> = OBSTACLE_CLASSES - VEHICLE_CLASSES

/**
 * 박스 아래 끝이 바닥에 닿은 곳까지 거리(m). 목걸이 높이(cameraHeightM)에서 수평으로 찍는다고 본다.
 * 아래 끝이 수평선(horizonY)보다 위면 잴 수 없어 null 이다.
 * 폰이 기울면 거리가 틀리지만, 같은 프레임 안 물체끼리 어느 것이 가까운지는 그대로다.
 */
fun groundDistanceM(box: ObjectBox, frame: DetectionFrame, config: VisionConfig): Double? {
    val belowPx = (box.bottom - config.horizonY) * frame.imageHeightPx
    if (belowPx <= 0.0) return null
    return config.cameraHeightM * focalLengthPx(frame, config) / belowPx
}

/** 기둥·장애물·계단이 걷는 길 앞 가까이(obstacleNearM 안, 걷는 길 통로에 걸침) 있으면 바닥 기준 거리(m), 아니면 null */
fun nearObstacleDistanceM(box: ObjectBox, frame: DetectionFrame, config: VisionConfig): Double? {
    val distance = groundDistanceM(box, frame, config) ?: return null
    return distance.takeIf { it <= config.obstacleNearM && inCorridor(box, it, frame, config) }
}

private class ObstacleTrack(kind: DetectedClass, box: ObjectBox) : BoxTrack(kind, box) {
    /** 걷는 길 앞 가까이 보이기 시작한 시각(ms). 앞 가까이가 아닌 곳에서 보이면 null 로 되돌린다 */
    var nearSinceMs: Long? = null

    /** 알렸는지. 같은 물체는 한 번만 알린다 */
    var noticed = false
}

/** 안내를 시작할 때마다 새로 만든다. 같은 물체는 한 번만 알린다. */
class ObstacleTracker(private val config: VisionConfig = VisionConfig()) {
    private val tracks = mutableListOf<ObstacleTrack>()

    /**
     * 이번 프레임에 알릴 수 있는 장애물. 걷는 길 앞 가까이 obstacleConfirmMs 동안 이어서 보여야 한다. 잠깐 잘못 잡힌 박스를 거른다.
     * objectLostMs 안에 잠깐 못 잡은 프레임은 끊긴 것으로 보지 않고, 앞 가까이가 아닌 곳에서 보이면 처음부터 다시 잰다.
     */
    fun analyze(frame: DetectionFrame, labels: List<Int>): List<StillNotice> {
        val boxes = frame.objects.filter { it.kind in FIXED_OBSTACLE_CLASSES }
        val seen = updateTracks(tracks, boxes, frame.timeMs, config) { ObstacleTrack(it.kind, it) }
        return seen.mapNotNull { track ->
            val distance = nearObstacleDistanceM(track.box, frame, config)
            if (distance == null) {
                track.nearSinceMs = null
                return@mapNotNull null
            }
            val since = track.nearSinceMs ?: frame.timeMs.also { track.nearSinceMs = it }
            if (track.noticed || frame.timeMs - since < config.obstacleConfirmMs) return@mapNotNull null
            StillNotice(track.kind, directionOf(track.box, labels), distance) { track.noticed = true }
        }
    }
}
