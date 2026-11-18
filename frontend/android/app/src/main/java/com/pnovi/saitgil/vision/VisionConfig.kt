package com.pnovi.saitgil.vision

/**
 * 사람 박스로 거리·빈 방향·정면 접근을 판단할 때 쓰는 기준값.
 * 실기기에서 맞춰 볼 초안 값이라 판단 코드에 직접 쓰지 않고 여기에 모은다.
 */
data class VisionConfig(
    /** 거리 추정에 쓰는 사람 평균 키(m) */
    val personHeightM: Double = 1.7,
    /** 초점거리를 모를 때 쓰는 카메라 가로 화각(도) */
    val defaultHorizontalFovDeg: Double = 66.0,
    /** 이 거리(m) 안에 사람이 걸친 칸을 막힌 방향으로 본다 */
    val blockedDistanceM: Double = 4.0,
    /** 막힌 칸이 이만큼 이상이면 주의 */
    val cautionBlockedSectors: Int = 1,
    /** 막힌 칸이 이만큼 이상이면 혼잡 */
    val crowdedBlockedSectors: Int = 3,
    /** 정면 사람이 이 거리(m) 안이면 위험 */
    val dangerDistanceM: Double = 1.0,
    /**
     * 박스 위아래가 영상 끝에서 이만큼(0~1) 안이면 잘린 것으로 본다.
     * 위아래가 다 잘린 정면 사람은 키로 거리를 잴 수 없을 만큼 가까우니 위험으로 본다.
     */
    val clippedEdge: Double = 0.02,
    /** 정면 사람이 이 거리(m) 안에서 빠르게 가까워지면 접근을 알린다 */
    val approachWarnDistanceM: Double = 3.0,
    /** 거리가 이 속도(m/s) 이상으로 줄면 빠르게 가까워진다고 본다. 같이 걷는 앞사람은 거의 0 이다 */
    val approachSpeedMps: Double = 0.6,
    /** 접근 속도를 잴 때 돌아보는 시간(ms) */
    val approachWindowMs: Long = 1_500,
    /** 접근 속도를 믿으려면 이 시간(ms) 이상 지켜봐야 한다. 한두 프레임 튀는 것은 넘긴다 */
    val approachMinSpanMs: Long = 600,
    /** 같은 사람의 접근을 다시 알리기 전에 기다리는 시간(ms) */
    val approachRepeatMs: Long = 5_000,
    /** 앞 프레임 박스와 이만큼 이상 겹치면 같은 사람으로 본다(IoU) */
    val trackIouThreshold: Double = 0.3,
    /** 이 프레임 수보다 오래 안 보인 사람은 추적에서 뺀다 */
    val trackMaxMissedFrames: Int = 5,
)
