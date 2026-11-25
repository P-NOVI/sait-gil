package com.pnovi.saitgil.vision

import kotlin.math.abs
import kotlin.math.max
import kotlin.math.min
import kotlin.math.tan

// 사람 박스로 거리·막힌 방향·빈 방향·정면 접근을 판단한다.
// Android 클래스를 쓰지 않아 가짜 박스로 JVM 단위 테스트를 할 수 있다.

/**
 * 사람 박스 하나. 좌표는 영상 크기로 나눈 0~1 값이다(왼쪽 위가 0).
 * 좌표는 카메라 버퍼 그대로가 아니라 회전을 적용해 세운 화면 기준이다.
 * 앱은 목걸이로 휴대폰을 세워 걸고 쓰므로 세로 화면이다.
 */
data class PersonBox(
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

/**
 * 한 번 추론한 박스들. 점수 컷을 넘긴 것만 담는다.
 * boxes 는 person 클래스, objects 는 그 밖의 클래스다.
 */
data class DetectionFrame(
    val timeMs: Long,
    val boxes: List<PersonBox>,
    /** 세운 화면 기준 가로(px) */
    val imageWidthPx: Int,
    /** 세운 화면 기준 세로(px) */
    val imageHeightPx: Int,
    /** 카메라 초점거리(px). 모르면 null 이고 기본 화각으로 계산한다 */
    val focalLengthPx: Double? = null,
    val objects: List<ObjectBox> = emptyList(),
    /** 사용자가 걷는 속도(m/s). GPS 로 받는다. 멈춰 있으면 0, 모르면 null 이다. 차의 움직임을 잴 때 내 걸음을 뺀다 */
    val walkSpeedMps: Double? = null,
    /** 길안내 경로의 횡단보도 근처인지. 화면이 알려 준다. 신호를 기다리는지 볼 때 쓴다 */
    val nearCrosswalk: Boolean = false,
    /** 영상이 가려지거나 흔들려 못 믿을 프레임인지. 박스가 0개여도 "사람 없음"이 아닐 수 있다(#170) */
    val unreliable: Boolean = false,
)

/** 프레임 하나를 판단한 결과. alert 는 정면 접근이 있을 때만 있다. */
data class CrowdAnalysis(val frame: CrowdFrame, val alert: VisionAlert?)

/**
 * 영상 가로를 왼쪽부터 다섯 칸으로 나눈 칸의 이름(시계 방향). 칸은 영상 가로를 같은 폭으로 나눈다.
 * 이름은 칸 순서로 고정한다. 칸의 실제 각도로 이름을 붙이면 1배 기본 렌즈(세로, 좌우 약 ±26°)에서
 * 가운데 세 칸이 모두 12시가 되어 방향이 12시로 쏠린다.
 */
val CLOCK_SECTORS: List<Int> = listOf(10, 11, 12, 1, 2)
private val FRONT_SECTOR = CLOCK_SECTORS.indexOf(12)

/** 박스 가로 위치(0~1)가 속한 칸 번호(0~4) */
fun sectorOf(x: Double): Int =
    (x * CLOCK_SECTORS.size).toInt().coerceIn(0, CLOCK_SECTORS.lastIndex)

/**
 * 초점거리(px). 모르면 센서 긴 변 화각으로 구한다.
 * 화소는 가로세로가 같아 초점거리도 같으므로, 세운 화면이든 눕힌 화면이든 긴 변으로 구하면 맞다.
 */
fun focalLengthPx(frame: DetectionFrame, config: VisionConfig): Double =
    frame.focalLengthPx
        ?: (max(frame.imageWidthPx, frame.imageHeightPx) / 2.0) /
        tan(Math.toRadians(config.defaultLongSideFovDeg / 2))

/**
 * 렌즈 초점거리(mm)를 센서 긴 변(mm)으로 나눈 값. 영상 긴 변(px)을 곱하면 초점거리(px)다.
 * 분석 영상(4:3)이 같은 비율의 센서 전체를 줄인 것이라고 본다. 값이 없거나 잘못됐으면 null 이다.
 */
fun focalPerLongSide(focalMm: Float?, sensorWidthMm: Float?, sensorHeightMm: Float?): Double? {
    if (focalMm == null || sensorWidthMm == null || sensorHeightMm == null) return null
    val longSideMm = max(sensorWidthMm, sensorHeightMm)
    if (focalMm <= 0f || longSideMm <= 0f) return null
    return focalMm.toDouble() / longSideMm
}

/** 카메라에서 읽은 초점거리를 프레임에 넣는다. 못 읽었으면(null) 기본 화각을 쓰도록 그대로 둔다 */
fun DetectionFrame.withFocalPerLongSide(perLongSide: Double?): DetectionFrame =
    if (perLongSide == null) this else copy(focalLengthPx = perLongSide * max(imageWidthPx, imageHeightPx))

/** 박스 위나 아래가 영상 끝에 닿아 잘렸는지 */
fun isClippedVertically(box: PersonBox, config: VisionConfig): Boolean =
    box.top <= config.clippedEdge || box.bottom >= 1 - config.clippedEdge

/**
 * 거리(m)를 추정한다. 거리 ≈ 초점거리 × 사람 키 ÷ 박스 높이.
 * 가까운 사람은 다리나 머리가 화면 밖으로 잘려 높이로 재면 실제보다 멀게 나온다.
 * 그래서 위나 아래가 잘린 박스는 키 대신 사람 폭으로 잰다.
 */
fun estimateDistanceM(box: PersonBox, frame: DetectionFrame, config: VisionConfig): Double? {
    config.distanceK?.let { return estimateDistanceByK(box, it, config) }
    val focalPx = focalLengthPx(frame, config)
    val (sizePx, sizeM) = if (isClippedVertically(box, config)) {
        box.width * frame.imageWidthPx to config.personWidthM
    } else {
        box.height * frame.imageHeightPx to config.personHeightM
    }
    if (sizePx <= 0.0) return null
    return focalPx * sizeM / sizePx
}

/**
 * 실측 보정값(K)으로 거리를 잰다. 박스 가운데 위치의 높이 K(칸 사이는 보간)를 쓰고, 위나 아래가 잘렸으면 폭 K 를 쓴다.
 * 높이·폭이 0 이면 null 이다.
 */
private fun estimateDistanceByK(box: PersonBox, k: DistanceK, config: VisionConfig): Double? {
    val (ratio, kValue) = if (isClippedVertically(box, config)) {
        box.width to k.widthK
    } else {
        box.height to k.heightKAt(box.centerX)
    }
    if (ratio <= 0.0) return null
    return kValue / ratio
}

/** 두 박스가 겹치는 정도(IoU, 0~1) */
fun iou(a: PersonBox, b: PersonBox): Double {
    val overlapW = min(a.right, b.right) - max(a.left, b.left)
    val overlapH = min(a.bottom, b.bottom) - max(a.top, b.top)
    if (overlapW <= 0.0 || overlapH <= 0.0) return 0.0
    val overlap = overlapW * overlapH
    return overlap / (a.width * a.height + b.width * b.height - overlap)
}

/**
 * 비어 있는 방향을 갈 만한 순서로 돌려준다.
 * 이어진 빈 칸이 넓은 구간을 먼저, 같으면 12시에 가까운 구간을 먼저 둔다.
 * 구간 안에서는 가운데 칸을 먼저 둬 사람과 덜 스치는 쪽을 앞에 놓는다.
 * 화면은 맨 앞 방향 하나만 읽는다.
 */
fun freeDirections(blocked: Set<Int>): List<Int> {
    val runs = mutableListOf<List<Int>>()
    var run = mutableListOf<Int>()
    for (sector in CLOCK_SECTORS.indices) {
        if (sector in blocked) {
            if (run.isNotEmpty()) runs += run
            run = mutableListOf()
        } else {
            run += sector
        }
    }
    if (run.isNotEmpty()) runs += run

    fun frontGap(sector: Int) = abs(sector - FRONT_SECTOR)
    return runs
        .sortedWith(compareByDescending<List<Int>> { it.size }.thenBy { it.minOf(::frontGap) })
        .flatMap { sectors ->
            val center = (sectors.first() + sectors.last()) / 2.0
            sectors.sortedWith(compareBy<Int> { abs(it - center) }.thenBy(::frontGap))
        }
        .map { CLOCK_SECTORS[it] }
}

/** 추적 중인 사람 하나. samples 는 (시각, 거리) 기록이다. */
private class Track(val id: Int, var box: PersonBox, var lastSeenMs: Long) {
    /** 처음 잡힌 시각. 이번 프레임 시각과 같으면 방금 나타난 사람이다 */
    val firstSeenMs: Long = lastSeenMs
    val samples = ArrayDeque<Pair<Long, Double>>()
    var alertedAtMs: Long? = null

    /** 지난 거리를 잘린 박스(폭)로 쟀는지. 재는 방법이 바뀌면 거리가 튀므로 기록을 새로 시작한다 */
    var measuredByWidth: Boolean? = null
}

/** 안내를 시작할 때마다 새로 만든다. 앞 프레임의 사람을 기억해 접근 속도를 잰다. */
class CrowdAnalyzer(private val config: VisionConfig = VisionConfig()) {
    private val tracks = mutableListOf<Track>()
    private var nextId = 0

    // 최근 freeConfirmMs 동안 프레임들의 (시각, 빈 방향). 접근 경고에는 이어서 비어 있던 방향만 넣는다.
    private val recentFree = ArrayDeque<Pair<Long, List<Int>>>()

    // 옆 진입을 마지막으로 알린 시각(왼쪽 true, 오른쪽 false)
    private val sideAlertedAtMs = mutableMapOf<Boolean, Long>()
    private var lastFrameMs: Long? = null

    // 못 믿을 프레임이 이어지기 시작한 시각. 믿을 프레임이 오면 지운다
    private var unreliableSinceMs: Long? = null

    fun analyze(frame: DetectionFrame): CrowdAnalysis {
        // 안내를 시작한 첫 프레임이나 프레임이 trackLostMs 넘게 끊긴 뒤 첫 프레임(그동안 추적이 모두 지워진다)에 보이는 사람은
        // 방금 들어온 것이 아니므로 옆 진입으로 보지 않는다.
        val previousMs = lastFrameMs
        val tracksRestarted = previousMs == null || frame.timeMs - previousMs > config.trackLostMs
        lastFrameMs = frame.timeMs
        val seen = match(frame)
        val distances = seen.associateWith { track ->
            estimateDistanceM(track.box, frame, config)
        }
        distances.forEach { (track, distance) ->
            val byWidth = isClippedVertically(track.box, config)
            if (track.measuredByWidth != byWidth) {
                track.samples.clear()
                track.measuredByWidth = byWidth
            }
            if (distance != null) record(track, frame.timeMs, distance)
        }

        val blocked = mutableSetOf<Int>()
        var nearPeople = 0
        distances.forEach { (track, distance) ->
            if (distance != null && distance <= config.blockedDistanceM) {
                nearPeople += 1
                (sectorOf(track.box.left)..sectorOf(track.box.right)).forEach { blocked += it }
            }
        }
        val nearest = distances.values.filterNotNull().minOrNull()
        val front = distances.filter { (track, distance) ->
            distance != null && sectorOf(track.box.centerX) == FRONT_SECTOR
        }
        val nearestFront = front.values.filterNotNull().minOrNull()
        val frontClipped = front.keys.any { track ->
            track.box.top <= config.clippedEdge && track.box.bottom >= 1 - config.clippedEdge
        }
        val free = freeDirections(blocked)
        recentFree.addLast(frame.timeMs to free)
        while (recentFree.first().first < frame.timeMs - config.freeConfirmMs) recentFree.removeFirst()
        // 넓은 순서는 지금 프레임을 따르고, 최근 프레임 내내 비어 있던 방향만 남긴다.
        val steadyFree = free.filter { direction -> recentFree.all { direction in it.second } }

        unreliableSinceMs = if (frame.unreliable) unreliableSinceMs ?: frame.timeMs else null
        // 박스가 있으면 카메라가 일부라도 보이는 것이므로 기존대로 판단한다. 박스가 없는데 못 믿을 화면이면 "비었다"고 말할 수 없다.
        val blind = frame.boxes.isEmpty() &&
            unreliableSinceMs?.let { frame.timeMs - it >= config.unreliableConfirmMs } == true

        val level = when {
            blind -> CrowdLevel.UNKNOWN
            frontClipped -> CrowdLevel.DANGER
            nearestFront != null && nearestFront <= config.dangerDistanceM -> CrowdLevel.DANGER
            blocked.size >= config.crowdedBlockedSectors &&
                nearPeople >= config.crowdedPeople -> CrowdLevel.CROWDED
            blocked.size >= config.cautionBlockedSectors -> CrowdLevel.CAUTION
            else -> CrowdLevel.CLEAR
        }
        val frontAlert = front.keys
            .filter { approaching(it, frame.timeMs) }
            .minByOrNull { distances[it] ?: Double.MAX_VALUE }
            ?.let { track ->
                track.alertedAtMs = frame.timeMs
                VisionAlert(
                    kind = AlertKind.DANGER,
                    message = "정면 접근",
                    distanceM = distances[track],
                    freeDirections = steadyFree,
                )
            }
        // 혼잡 이상에서는 옆 칸에 늘 사람이 있고 서로 가려 같은 사람이 새 사람으로 잡히므로 옆 진입을 알리지 않는다. 혼잡 알림이 대신한다.
        val sideAllowed = !tracksRestarted && level != CrowdLevel.CROWDED && level != CrowdLevel.DANGER
        val alert = frontAlert ?: if (sideAllowed) sideEntryAlert(distances, frame.timeMs) else null
        // 판단 불가이면 비어 있는 방향도 모른다
        return CrowdAnalysis(CrowdFrame(level, nearest, if (blind) emptyList() else free), alert)
    }

    /**
     * 옆 칸(12시가 아닌 칸)에 방금 나타난 사람이 sideEntryDistanceM 안이면 옆 진입을 알린다.
     * 한 프레임으로는 가로질러 오는지 추월하는지 알 수 없어 움직임은 따지지 않고, 같은 쪽은 sideEntryRepeatMs 에 한 번만 알린다.
     */
    private fun sideEntryAlert(distances: Map<Track, Double?>, nowMs: Long): VisionAlert? {
        val (track, distance) = distances.entries
            .mapNotNull { (track, distance) -> distance?.let { track to it } }
            .filter { (track, distance) ->
                val sector = sectorOf(track.box.centerX)
                val lastMs = sideAlertedAtMs[sector < FRONT_SECTOR]
                track.firstSeenMs == nowMs &&
                    sector != FRONT_SECTOR &&
                    distance <= config.sideEntryDistanceM &&
                    (lastMs == null || nowMs - lastMs >= config.sideEntryRepeatMs)
            }
            .minByOrNull { it.second } ?: return null
        val sector = sectorOf(track.box.centerX)
        sideAlertedAtMs[sector < FRONT_SECTOR] = nowMs
        return VisionAlert(
            kind = AlertKind.SIDE_ENTRY,
            message = "옆 진입",
            distanceM = distance,
            direction = CLOCK_SECTORS[sector],
        )
    }

    /** 새 박스를 앞 프레임 사람과 겹치는 순서대로 짝짓고, 짝 없는 박스는 새 사람으로 본다. */
    private fun match(frame: DetectionFrame): List<Track> {
        val pairs = tracks
            .flatMap { track ->
                frame.boxes.indices.map { index ->
                    Triple(track, index, iou(track.box, frame.boxes[index]))
                }
            }
            .filter { it.third >= config.trackIouThreshold }
            .sortedByDescending { it.third }
        val matchedTracks = mutableSetOf<Track>()
        val matchedBoxes = mutableSetOf<Int>()
        for ((track, boxIndex, _) in pairs) {
            if (track in matchedTracks || boxIndex in matchedBoxes) continue
            track.box = frame.boxes[boxIndex]
            track.lastSeenMs = frame.timeMs
            matchedTracks += track
            matchedBoxes += boxIndex
        }
        tracks.removeAll { frame.timeMs - it.lastSeenMs > config.trackLostMs }

        val added = frame.boxes.indices
            .filter { it !in matchedBoxes }
            .map { Track(nextId++, frame.boxes[it], frame.timeMs) }
        tracks += added
        return matchedTracks.toList() + added
    }

    private fun record(track: Track, timeMs: Long, distanceM: Double) {
        track.samples.addLast(timeMs to distanceM)
        while (track.samples.first().first < timeMs - config.approachWindowMs) {
            track.samples.removeFirst()
        }
    }

    /** 경고 거리 안에서 거리가 기준 속도 이상으로 줄고, 최근에 알리지 않았으면 접근으로 본다. */
    private fun approaching(track: Track, nowMs: Long): Boolean {
        val (firstMs, firstM) = track.samples.firstOrNull() ?: return false
        val (lastMs, lastM) = track.samples.last()
        val spanMs = lastMs - firstMs
        if (spanMs < config.approachMinSpanMs || lastM > config.approachWarnDistanceM) return false
        val speedMps = (firstM - lastM) / (spanMs / 1_000.0)
        val alertedAt = track.alertedAtMs
        val recentlyAlerted = alertedAt != null && nowMs - alertedAt < config.approachRepeatMs
        return speedMps >= config.approachSpeedMps && !recentlyAlerted
    }
}
