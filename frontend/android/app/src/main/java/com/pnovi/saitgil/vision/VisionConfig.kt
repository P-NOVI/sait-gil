package com.pnovi.saitgil.vision

import kotlin.math.floor

/**
 * 사람 박스로 거리를 재는 실측 보정값. 박스 높이·폭은 영상 크기로 나눈 0~1 비율이라 해상도와 상관없다.
 * 거리(m) = heightKAt(박스 가운데 x) ÷ 박스 높이, 위나 아래가 잘린 박스는 거리(m) = widthK ÷ 박스 폭.
 * 왼쪽 가장자리 칸이 가운데보다 K 가 약 12% 커서 칸마다 따로 구하고, 칸 가운데 사이는 이어서(선형 보간) 쓴다.
 * 칸 경계에서 K 가 한 번에 바뀌면 거리가 3~8% 튀어 접근 속도(거리 변화)가 잘못 잡히기 때문이다.
 */
data class DistanceK(
    /** 왼쪽부터 칸마다(CLOCK_SECTORS 순서) 칸 가운데에서의 높이 기준 K */
    val heightK: List<Double>,
    /** 위나 아래가 잘린 박스의 폭 기준 K. 1m 사진에서 칸마다 같아 하나만 둔다 */
    val widthK: Double,
) {
    init {
        require(heightK.size == CLOCK_SECTORS.size) { "heightK 는 칸 수(${CLOCK_SECTORS.size})만큼 있어야 합니다" }
    }

    /** 영상 가로 위치 centerX(0~1)의 높이 K. 칸 가운데 사이는 선형 보간하고, 양 끝 칸 가운데 밖은 끝 값을 쓴다 */
    fun heightKAt(centerX: Double): Double {
        // 칸 가운데가 정수가 되도록 옮긴 위치
        val position = centerX * heightK.size - 0.5
        val low = floor(position).toInt().coerceIn(0, heightK.lastIndex)
        val high = (low + 1).coerceAtMost(heightK.lastIndex)
        val ratio = (position - low).coerceIn(0.0, 1.0)
        return heightK[low] + (heightK[high] - heightK[low]) * ratio
    }
}

/**
 * 1배 기본 렌즈(확대 1배, 세로, 4:3)로 1~5m 거리에서 찍은 사진 25장(5방향 × 5거리)으로 구한 값이다.
 * 촬영자 한 명(키 약 1.7m, 두꺼운 패딩)과 한 기종(갤럭시 S21, SM-G991N)으로 재서, 키가 다른 사람·다른 기종이면 값이 달라질 수 있다.
 * widthK 는 패딩 때문에 어깨폭(0.5m)보다 넓게 잰 값이다. 높이 K 는 가운데 12시 칸 1.255 ~ 양 끝 칸 약 1.39~1.40 이다.
 * 앱 기본 모델(int8)로 구했다. fp32 모델로 구한 값과 K 차이가 1% 안이다.
 * K 를 구한 같은 사진으로 잰 거리 오차는 3~5m 에서 ±2.7% 안, 2m 에서 ±3.2% 안이다(다른 사진으로는 더 클 수 있다).
 * 1m 안쪽에서 위아래와 좌우가 모두 잘린 박스(양 끝 칸)는 폭이 잘려 거리가 크게 틀린다.
 * K 는 기기 초점거리를 쓰지 않아 기종이 바뀌면 사람 거리만 어긋날 수 있다. 차·장애물 거리는 초점거리를 쓴다.
 */
val MEASURED_DISTANCE_K = DistanceK(
    heightK = listOf(1.385, 1.309, 1.255, 1.288, 1.401),
    widthK = 0.582,
)

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
    /**
     * 실측 사진으로 구한 사람 거리 보정값. 있으면 위의 사람 키·폭·화각 공식 대신 쓰고, null 이면 공식을 쓴다.
     * 값은 ml/ 의 `python -m distance_calibration.fit` 으로 구한다(#145).
     */
    val distanceK: DistanceK? = MEASURED_DISTANCE_K,
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
    /** 옆 칸(10·11·1·2시)에 새로 나타난 사람이 이 거리(m) 안이면 옆에서 들어온다고 알린다 */
    val sideEntryDistanceM: Double = 1.5,
    /** 같은 쪽(왼쪽·오른쪽)의 옆 진입을 다시 알리기 전에 기다리는 시간(ms). 추적이 끊겨 같은 사람이 새 사람으로 잡힐 때를 막는다. 실기기에서 맞출 초안 값이다 */
    val sideEntryRepeatMs: Long = 3_000,
    /** 앞 프레임 박스와 이만큼 이상 겹치면 같은 사람으로 본다(IoU) */
    val trackIouThreshold: Double = 0.3,
    // 추적·확정 기준은 프레임 수가 아니라 시간으로 둬 모델·기기의 fps 와 상관없게 한다(#133).
    /** 이 시간(ms)보다 오래 안 보인 사람은 추적에서 뺀다 */
    val trackLostMs: Long = 1_000,
    /** 접근 경고에 넣는 빈 방향은 이 시간(ms) 동안 이어서 비어 있던 것만 쓴다. 한 프레임 튀는 방향을 막는다 */
    val freeConfirmMs: Long = 500,
    /** 목걸이에 건 카메라의 바닥에서 높이(m). 기둥·장애물·계단의 바닥 기준 거리를 잴 때 쓴다 */
    val cameraHeightM: Double = 1.3,
    /**
     * 폰을 수평으로 걸었을 때 영상 속 수평선 위치(위에서 0~1). 박스 아래 끝이 이보다 아래여야 바닥 거리를 잰다.
     * 폰이 위로 들리면 실제 수평선이 내려가 거리가 멀게 나온다(5° 들리면 10m 가 약 30m).
     */
    val horizonY: Double = 0.5,
    /**
     * 기둥·장애물·계단(바닥 기준 거리)과 서 있는 차(박스 높이로 잰 거리)가 이 거리(m) 안이면 가까운 것으로 보고 알린다.
     * 10m 에서는 알림이 너무 잦아 5m 로 줄였다(#133). 1.1m/s 로 걸으면 약 4.5초 거리라, 음성이 늦지 않은지 실기기에서 본다.
     * 1배 기본 렌즈로 수평으로 찍으면 박스 아래 끝 약 0.7 이다.
     */
    val obstacleNearM: Double = 5.0,
    /**
     * 장애물·서 있는 차 알림 사이 최소 간격(ms). 화면은 읽는 중에 온 장애물 알림을 VISION.obstacleMaxWaitMs(1.5초)까지만
     * 기다리고 버리므로, 앞 알림을 읽는 동안 다음 것을 보내지 않는다. 움직이는 차는 쓰지 않는다.
     */
    val noticeGapMs: Long = 1_500,
    /**
     * 박스 높이로 거리를 잴 때 쓰는 차 높이(m). 버스·트럭도 car 로 학습돼 실제보다 가깝게 나와 일찍 알린다.
     * 화면 위치와 달리 목걸이 폰이 기울어도 거리가 거의 바뀌지 않아 차·이륜차는 박스 높이로 잰다.
     */
    val carHeightM: Double = 1.5,
    /** 이륜차 높이(m). 탄 사람이 박스에 들어가는지는 학습 라벨에 따라 달라 실기기에서 맞출 초안 값이다 */
    val twoWheelerHeightM: Double = 1.1,
    /** 박스 아래가 잘린 차의 거리를 박스 폭으로 잴 때 쓰는 차 폭(m) */
    val carWidthM: Double = 1.8,
    /** 박스 아래가 잘린 이륜차의 거리를 박스 폭으로 잴 때 쓰는 이륜차 폭(m) */
    val twoWheelerWidthM: Double = 0.8,
    /** 차가 이 거리(m) 안이면 가까운 것으로 본다. 시속 30km 차가 약 2.4초에 오는 거리. 실기기에서 맞출 초안 값이다 */
    val carNearM: Double = 20.0,
    /** 이륜차가 이 거리(m) 안이면 가까운 것으로 본다. 실기기에서 맞출 초안 값이다 */
    val twoWheelerNearM: Double = 15.0,
    /**
     * 장애물은 이 시간(ms) 동안 이어서 걷는 길 앞 가까이 보여야 알린다. 잠깐 잘못 잡힌 것을 거른다. 차·이륜차는 쓰지 않는다.
     * objectLostMs 안에 잠깐 못 잡은 프레임은 끊긴 것으로 보지 않는다
     */
    val obstacleConfirmMs: Long = 500,
    /** 이 시간(ms)보다 오래 안 보인 장애물·차는 지나간 것으로 보고 추적에서 뺀다. 다시 보이면 새 물체다 */
    val objectLostMs: Long = 1_000,
    /**
     * 장애물·서 있는 차는 추적이 끊겨 같은 물체가 새 물체로 잡혀도 이 시간(ms) 안에는 다시 알리지 않는다.
     * 같은 물체인지는 종류·방향과 거리(renoticeToleranceM)로 본다. 뒤따라 선 다른 기둥은 이 안에도 알린다
     */
    val stillRepeatMs: Long = 10_000,
    /** 다시 잡힌 물체가 (알린 거리 − 그동안 걸은 거리)에서 이 거리(m) 안이면 같은 물체로 본다. 바닥 거리 오차를 넘길 만큼 둔 초안 값이다 */
    val renoticeToleranceM: Double = 1.5,
    /** 걸음 속도를 모를 때 같은 물체인지 볼 때 쓰는, 그동안 걸었을 수 있는 가장 빠른 속도(m/s) */
    val renoticeMaxWalkMps: Double = 1.5,
    /**
     * GPS 걸음 속도가 이보다 느린(m/s) 상태가 standingConfirmMs 이어지면 서 있는 것으로 보고 장애물·서 있는 차를 알리지 않는다.
     * 다가오는 차는 서 있어도 알린다. 화면의 VISION.waitingSpeedMps 와 같은 값이다. 걸음 속도를 모르면(null) 걷는 것으로 보고 알린다
     */
    val standingSpeedMps: Double = 0.5,
    /** 걸음 속도가 standingSpeedMps 보다 느린 상태가 이 시간(ms) 이어져야 서 있는 것으로 본다. GPS 속력이 잠깐 0 으로 튀는 것은 넘긴다 */
    val standingConfirmMs: Long = 3_000,
    /** 앞 프레임 차·장애물 박스와 이만큼 이상 겹치면(IoU) 같은 물체로 본다 */
    val objectTrackIou: Double = 0.2,
    /**
     * 안 겹쳐도 가운데가 이만큼(영상 폭 0~1) 안에서 움직였고 크기가 비슷하면 같은 물체로 본다.
     * 옆으로 빠르게 지나가는 차와, 목걸이가 흔들려 옆으로 밀린 가는 기둥
     */
    val objectMaxShift: Double = 0.25,
    /** 같은 물체로 볼 박스 높이 비(큰 쪽 ÷ 작은 쪽) 상한 */
    val objectMaxSizeRatio: Double = 1.7,
    /** 걷는 길로 보는 통로의 반폭(m). 카메라 정면에서 좌우 이만큼(폭 2m)에 걸친 차·장애물을 길 위로 본다 */
    val corridorHalfWidthM: Double = 1.0,
    // 아래 vehicle* 값은 차·이륜차 추적(VehicleTracker) 기준이다. 모두 실기기에서 맞출 초안 값이다.
    /** 움직임을 잴 때 돌아보는 시간(ms). 약 0.7초 간격 프레임 세 장이 들어간다 */
    val vehicleMotionWindowMs: Long = 2_000,
    /** 움직임을 재려면 이 시간(ms) 이상 지켜봐야 한다. 아주 빠르게 다가오는 차는 이만큼만 보고 판단한다 */
    val vehicleMinSpanMs: Long = 600,
    /** 아주 빠르지 않으면 이 시간(ms) 이상 지켜본 뒤 움직임을 판단한다. 박스 크기로 잰 거리가 흔들려서다 */
    val vehicleMotionSpanMs: Long = 1_000,
    /**
     * 내 걸음을 뺀 차 자체의 접근 속도(m/s)가 이 이상이면 다가오는 차로 본다. 골목 서행·후진 속도(2~3m/s)를 놓치지 않는 값이다.
     * 걸음 속도를 모르면(0) 서 있는 차로 걸어 다가가는 속도(약 1.2m/s)가 그대로 들어오므로 그보다 크게 둔다.
     */
    val vehicleMovingMps: Double = 1.8,
    /**
     * 걸음 속도를 모를 때(위치 오차가 크거나 위치가 끊김) 다가오는 차로 보는 속도(m/s). 걸음을 못 빼 걷는 속도(약 1.2m/s)가
     * 그대로 섞이므로 서 있는 차로 걸어 다가가는 것과 구분되게 크게 둔다. 걸음을 빼기 전 기준이다.
     */
    val vehicleMovingUnknownWalkMps: Double = 3.0,
    /**
     * 내 걸음을 뺀 차 자체의 속도가 이 이상으로 멀어지면 멀어지는 차로 보고 알리지 않는다.
     * 느리게 멀어지는 차가 서 있는 차로 잡혀 알리는 일을 막는다. GPS 걸음 속도 오차가 이 값 가까이 되면 서 있는 차가 멀어지는 차로 잡히므로,
     * 프론트에서 걸음 속도 상한과 위치 정확도 조건을 둔다(settings.ts VISION.walkSpeed*).
     */
    val vehicleLeavingMps: Double = 0.5,
    /** 내 걸음을 뺀 차 자체의 접근 속도가 이 이상이면 vehicleMinSpanMs 만 보고 바로 다가오는 차로 본다 */
    val vehicleFastMps: Double = 5.0,
    /** 걸음 속도를 받은 지 이 시간(ms)이 지나면 위치가 끊긴 것으로 보고 0 으로 되돌린다. 마지막 속도가 계속 빠지는 일을 막는다 */
    val walkSpeedStaleMs: Long = 3_000,
    /**
     * 횡단보도 근처를 벗어난 뒤 이 시간(ms) 동안 다시 근처가 되지 않아야 분석 해상도를 되돌린다(#134).
     * GPS 진행 거리가 근처 경계에서 오가도 다시 묶기(그동안 프레임이 끊김)를 되풀이하지 않게 한다. 올리는 것은 바로 한다.
     * 실기기에서 맞출 초안 값이다
     */
    val highResOffDelayMs: Long = 5_000,
    /** 옆에서 걷는 길 가운데 쪽으로 이 속도(m/s) 이상 들어오면 건너오는 차로 본다 */
    val vehicleCrossingMps: Double = 1.5,
    /** vehicleMotionSpanMs 만큼 지켜보기 전이라도 길 위 이 거리(m) 안에서 vehicleMovingMps 넘게 다가오면 움직이는 차로 알린다 */
    val vehicleImmediateM: Double = 10.0,
    /** 움직이는 차는 클래스마다 이 시간(ms) 안에 한 번만 알린다. 추적이 끊겨 같은 차가 새 차로 잡힐 때와 차가 줄지어 올 때 */
    val vehicleWarnRepeatMs: Long = 5_000,
    // 아래 signal* 값은 보행 신호등(SignalTracker) 기준이다. 프레임 수가 아니라 시간으로 둬 모델·기기의 fps 와 상관없게 한다(#132).
    /** 이 시간(ms) 연달아 빨간불로 보이면 빨간불로 바꾼다. 빨간불은 늦게 알리면 위험해 짧게 둔다 */
    val signalRedConfirmMs: Long = 500,
    /**
     * 이 시간(ms) 연달아 빨간불이 아닌 것으로 보여야 바꾼다. 빨간불이 잠깐 다르게 보였는데 "빨간불이 바뀌었습니다"라고 읽으면
     * 건너도 된다는 뜻으로 들려 길게 둔다. 11/24 실기기에서 빨간불이 0.5·1.2·3.1초 다르게 보였다
     */
    val signalOtherConfirmMs: Long = 3_000,
    /** 따라가던 신호등이 이 시간(ms) 넘게 안 보이면 놓친 것으로 보고 다시 고른다. 한두 프레임 못 잡은 것은 넘긴다 */
    val signalLostMs: Long = 1_000,
    /** 가운데가 영상 가운데에서 좌우로 이 폭(영상 폭 0~1) 안인 신호등만 본다. 옆 방향 횡단보도 신호등을 거른다 */
    val signalAheadHalfWidth: Double = 0.2,
    /**
     * 앞 프레임 신호등과 가운데가 이만큼(영상 폭 0~1) 안에서 움직였으면 같은 신호등으로 본다.
     * 불이 바뀌면 켜진 칸이 위아래로 달라 박스가 겹치지 않을 수 있다. 옆 신호등으로 넘어가지 않게 장애물보다 좁게 둔다
     */
    val signalMaxShift: Double = 0.1,
)

/** 디버그 빌드에서 바꿔 가며 비교할 모델. label 은 로그·안내에 쓰는 짧은 이름이다 */
data class DetectorModel(val label: String, val asset: String)

/**
 * 모델(YOLO26n LiteRT) 추론과 후처리 기준값. 학습 노트북에서 내보낸 모델의 입출력에 맞춘다.
 * 점수 컷·NMS 기준은 Ultralytics 예측 기본값에서 시작해 실기기에서 맞춘다.
 */
data class DetectorConfig(
    /** assets 안 모델 파일 경로. 가중치는 커밋하지 않으므로 앱 빌드 전에 복사한다(ml/README.md) */
    val modelAsset: String = "models/sidewalk_yolo26n_int8.tflite",
    /**
     * 디버그 빌드에서 개발용 미리보기를 길게 눌러 차례로 바꿔 가며 비교할 모델(#128). 앞의 것이 기본이다.
     * assets 에 파일이 있는 것만 고른다. 릴리스 빌드는 modelAsset 하나만 쓴다
     */
    val compareModels: List<DetectorModel> = listOf(
        DetectorModel("int8", "models/sidewalk_yolo26n_int8.tflite"),
        DetectorModel("fp32", "models/sidewalk_yolo26n.tflite"),
        DetectorModel("fp16", "models/sidewalk_yolo26n_fp16.tflite"),
    ),
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
    /** 추론 시간을 로그로 볼 간격(프레임 수) */
    val logEveryFrames: Int = 30,
    /** 모델을 읽은 뒤 이 프레임 수는 준비 시간이라 추론 시간 평균에서 뺀다 */
    val logWarmupFrames: Int = 5,
    /** 레터박스 여백 밝기(0~255). 학습 때 Ultralytics 가 채우는 회색과 같다 */
    val padGray: Int = 114,
    /**
     * 횡단보도 근처에서 세운 영상의 위쪽 가운데를 잘라 신호등만 한 번 더 찾을 정사각형 한 변(px, #134).
     * 근처에서는 분석 해상도를 올리므로(CameraSession) 모델 입력과 같은 크기로 잘라 줄이지 않고 넣는다.
     * 960×1280 영상에서 가로 2/3 를 덮어, 앞쪽으로 보는 신호등 폭(가운데 60%)이 들어간다. 영상이 이보다 작으면 자르지 않는다
     */
    val signalCropSizePx: Int = 640,
    /**
     * 자를 칸 가운데의 세로 위치(위에서 0~1). 길 건너 신호등은 25~35m 떨어져 수평선(VisionConfig.horizonY 0.5) 조금 위에 보이고,
     * 폰이 앞뒤로 기울어도 들어가게 위쪽으로 넉넉히 둔다. 실기기에서 맞출 초안 값이다
     */
    val signalCropCenterY: Double = 0.4,
    /**
     * 전체 영상과 자른 칸의 신호등 박스가 겹친 넓이가 작은 박스 넓이의 이 비율 이상이면 같은 신호등으로 보고 하나만 남긴다.
     * 같은 신호등을 red·other 로 다르게 봐도 하나로 친다. 먼 신호등은 박스가 작아 몇 px 만 어긋나도 IoU 가 nmsIou 보다 낮아
     * IoU 대신 작은 박스 기준으로 본다. 실기기에서 맞출 초안 값이다
     */
    val signalMergeOverlap: Double = 0.5,
    /** 자른 칸의 끝(영상 끝이 아닌 쪽)에서 이 거리(px) 안까지 닿은 신호등 박스는 칸에 걸려 잘린 것으로 본다 */
    val signalCropEdgePx: Int = 4,
    /**
     * 디버그 빌드에서 횡단보도 근처일 때 신호등 칸 사진을 이 간격(ms)마다 한 장 폰에 저장한다(SignalCaptureWriter).
     * 밤에 신호등을 못 찾는 까닭(점수가 낮은지, 불빛이 번지는지)을 사진으로 보려고 둔다
     */
    val signalCaptureEveryMs: Long = 2_000,
    /** 폰에 남길 신호등 칸 사진 수 상한. 넘으면 오래된 것부터 지운다(640×640 JPEG 한 장 약 50~150KB) */
    val signalCaptureMaxFiles: Int = 300,
    /** 신호등 칸 사진 JPEG 품질(0~100) */
    val signalCaptureJpegQuality: Int = 85,
    /** 신호등 칸 사진의 평균 밝기를 잴 때 이 픽셀 수마다 하나만 본다 */
    val signalCaptureLumaStep: Int = 16,
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
