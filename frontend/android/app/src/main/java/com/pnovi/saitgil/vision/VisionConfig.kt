package com.pnovi.saitgil.vision

/**
 * 사람 박스로 거리·빈 방향·정면 접근을 판단할 때 쓰는 기준값.
 * 실기기에서 맞춰 볼 초안 값이라 판단 코드에 직접 쓰지 않고 여기에 모은다.
 */
data class VisionConfig(
    /** 거리 추정에 쓰는 사람 평균 키(m) */
    val personHeightM: Double = 1.7,
    /** 위나 아래가 잘린 박스는 키 대신 이 사람 폭(m, 어깨·팔 포함)으로 거리를 잰다 */
    val personWidthM: Double = 0.5,
    /**
     * 카메라에서 초점거리를 읽지 못했을 때 쓰는 화각(도). 센서 긴 변 기준이다.
     * 앱은 후면 기본 렌즈를 확대 1배로 쓰고 광각(0.5배)은 쓰지 않는다. 노트8 기본 렌즈(4.3mm, 센서 긴 변 5.645mm) 값이다.
     */
    val defaultLongSideFovDeg: Double = 66.6,
    /** 이 거리(m) 안에 사람이 걸친 칸을 막힌 방향으로 본다 */
    val blockedDistanceM: Double = 4.0,
    /** 막힌 칸이 이만큼 이상이면 주의 */
    val cautionBlockedSectors: Int = 1,
    /** 막힌 칸이 이만큼 이상이면 혼잡 */
    val crowdedBlockedSectors: Int = 3,
    /** 막힌 칸 조건과 함께, blockedDistanceM 안의 사람이 이만큼 이상이어야 혼잡. 큰 사람 한 명이 여러 칸에 걸쳐도 혼잡으로 보지 않는다 */
    val crowdedPeople: Int = 5,
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
    /** 접근 경고에 넣는 빈 방향은 이 프레임 수만큼 연달아 비어 있던 것만 쓴다. 한 프레임 튀는 방향을 막는다 */
    val freeConfirmFrames: Int = 3,
    /**
     * 장애물 박스 아래 끝이 영상 위에서 이만큼(0~1) 아래에 있으면 가까운 것으로 본다. 차·이륜차는 쓰지 않는다.
     * 목걸이 높이(약 1.3m)에서 1배 기본 렌즈(약 67°)로 수평으로 찍으면 0.7 은 약 5m 앞 바닥이다. 실기기에서 맞출 초안 값이다.
     */
    val obstacleNearBottom: Double = 0.7,
    /**
     * 박스 높이로 거리를 잴 때 쓰는 차 높이(m). 버스·트럭도 car 로 학습돼 실제보다 가깝게 나와 일찍 알린다.
     * 화면 위치와 달리 목걸이 폰이 기울어도 거리가 거의 바뀌지 않아 차·이륜차는 박스 높이로 잰다.
     */
    val carHeightM: Double = 1.5,
    /** 이륜차 높이(m). 탄 사람이 박스에 들어가는지는 학습 라벨에 따라 달라 실기기에서 맞출 초안 값이다 */
    val twoWheelerHeightM: Double = 1.1,
    /** 차가 이 거리(m) 안이면 가까운 것으로 본다. 시속 30km 차가 약 2초에 오는 거리. 실기기에서 맞출 초안 값이다 */
    val carNearM: Double = 15.0,
    /** 이륜차가 이 거리(m) 안이면 가까운 것으로 본다. 실기기에서 맞출 초안 값이다 */
    val twoWheelerNearM: Double = 10.0,
    /** 장애물은 이 프레임 수만큼 연달아 보여야 알린다. 한두 프레임 잘못 잡힌 것을 거른다 */
    val obstacleConfirmFrames: Int = 3,
    /**
     * 차·이륜차는 이 프레임 수만큼만 보이면 알린다. 빨라서 여러 프레임 연달아 잡히기 전에 지나간다.
     * 한 프레임 잘못 잡힌 것도 알리지만, 부딪히면 크게 다쳐 놓치지 않는 쪽을 고른다. 실기기에서 맞출 초안 값이다.
     */
    val fastObstacleConfirmFrames: Int = 1,
    /** 이 프레임 수보다 오래 안 보인 장애물은 지나간 것으로 보고, 다시 보이면 새로 알린다 */
    val obstacleMaxMissedFrames: Int = 5,
    /** 같은 장애물이 계속 보이면 이 시간(ms)마다 다시 알린다 */
    val obstacleRepeatMs: Long = 10_000,
    /** 신호등 상태는 이 프레임 수만큼 연달아 같아야 바꾼다. 한 프레임 튀는 색을 막는다 */
    val signalConfirmFrames: Int = 3,
)

/**
 * 모델(YOLO26n LiteRT) 추론과 후처리 기준값. 학습 노트북에서 내보낸 모델의 입출력에 맞춘다.
 * 점수 컷·NMS 기준은 Ultralytics 예측 기본값에서 시작해 실기기에서 맞춘다.
 */
data class DetectorConfig(
    /** assets 안 모델 파일 경로. 가중치는 커밋하지 않으므로 앱 빌드 전에 복사한다(ml/README.md) */
    val modelAsset: String = "models/sidewalk_yolo26n.tflite",
    /** 모델 입력 한 변(px). 내보낼 때 쓴 imgsz 와 같아야 한다 */
    val inputSize: Int = 640,
    /** 이 점수보다 낮은 박스는 버린다 */
    val minScore: Float = 0.25f,
    /** 같은 클래스 박스가 이만큼 이상 겹치면(IoU) 점수가 낮은 쪽을 버린다 */
    val nmsIou: Float = 0.7f,
    /** 한 프레임에 남길 박스 수 상한 */
    val maxDetections: Int = 100,
    /** CPU 추론 스레드 수 */
    val threads: Int = 4,
    /** 레터박스 여백 밝기(0~255). 학습 때 Ultralytics 가 채우는 회색과 같다 */
    val padGray: Int = 114,
)

/**
 * 폰이 목걸이에 위아래 거꾸로 걸렸는지 판단하는 기준값(MountOrientation). 실기기에서 맞출 초안 값이다.
 * 각도는 방향 센서 값으로, 0° 는 폰을 바로 세운 것, 180° 는 위아래 거꾸로 세운 것이다.
 */
data class MountConfig(
    /** 바로(0°)나 거꾸로(180°)에서 이 각도(도) 안이면 그 방향으로 본다. 그 사이(옆으로 기운 것)는 판단하지 않는다 */
    val maxTiltDeg: Int = 45,
    /**
     * 새 방향이 이 시간(ms) 동안 끊기지 않고 이어져야 바꾼다. 걸을 때 흔들려 잠깐 뒤집힌 것은 넘긴다.
     * 중간에 옆으로 기울거나 각도를 모르면 끊긴 것으로 보고 처음부터 다시 센다
     */
    val flipHoldMs: Long = 1_000,
)
