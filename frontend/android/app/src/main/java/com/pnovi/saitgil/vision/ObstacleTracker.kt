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

private class ObstacleTrack(kind: DetectedClass, box: ObjectBox) : BoxTrack(kind, box) {
    /** 앞쪽 가까이 연달아 보인 프레임 수 */
    var nearFrames = 0
    val notice = NoticeRecord()
}

/** 안내를 시작할 때마다 새로 만든다. 같은 물체는 한 번, 크게 가까워지면 한 번 더 알린다. */
class ObstacleTracker(private val config: VisionConfig = VisionConfig()) {
    private val tracks = mutableListOf<ObstacleTrack>()

    /**
     * 이번 프레임에 알릴 수 있는 장애물. 앞쪽 칸에 걸치고 obstacleNearM 안에 obstacleConfirmFrames 연달아 보여야 한다.
     * 한두 프레임 잘못 잡힌 박스를 거르려고, 한 프레임이라도 안 보이면 처음부터 다시 센다.
     */
    fun analyze(frame: DetectionFrame, labels: List<Int>): List<StillNotice> {
        val boxes = frame.objects.filter { it.kind in FIXED_OBSTACLE_CLASSES }
        val seen = updateTracks(tracks, boxes, config) { ObstacleTrack(it.kind, it) }
        tracks.filter { it.missed > 0 }.forEach { it.nearFrames = 0 }
        return seen.mapNotNull { track ->
            val distance = groundDistanceM(track.box, frame, config)
            val near = distance != null && distance <= config.obstacleNearM && overlapsAhead(track.box)
            track.nearFrames = if (near) track.nearFrames + 1 else 0
            if (distance == null || track.nearFrames < config.obstacleConfirmFrames) return@mapNotNull null
            if (!track.notice.due(distance, config.obstacleCloseM)) return@mapNotNull null
            StillNotice(track.kind, directionOf(track.box, labels), distance) { track.notice.mark(distance) }
        }
    }
}
