package com.pnovi.saitgil.vision

import kotlin.math.abs
import kotlin.math.atan
import kotlin.math.max
import kotlin.math.min
import kotlin.math.roundToInt
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
)

/** 프레임 하나를 판단한 결과. alert 는 정면 접근이 있을 때만 있다. */
data class CrowdAnalysis(val frame: CrowdFrame, val alert: VisionAlert?)

/**
 * 영상 가로를 왼쪽부터 다섯 칸으로 나눈 칸의 기본 이름.
 * 실제로 부르는 이름은 clockLabels 가 칸의 각도로 정한다. 이 값은 각도를 따지지 않을 때 쓴다.
 */
val CLOCK_SECTORS: List<Int> = listOf(10, 11, 12, 1, 2)
private val FRONT_SECTOR = CLOCK_SECTORS.indexOf(12)

// 시계 한 시간이 가리키는 각도(도)
private const val DEGREES_PER_HOUR = 30.0

/**
 * 칸마다 실제 시계 방향 이름. 칸 가운데의 각도를 재어 가장 가까운 시각으로 부른다.
 * 세로로 건 0.5배 카메라는 좌우 약 ±44°만 보여, 양 끝 칸도 10시·2시가 아니라 11시·1시가 된다.
 */
fun clockLabels(frame: DetectionFrame, config: VisionConfig): List<Int> {
    val focalPx = focalLengthPx(frame, config)
    return CLOCK_SECTORS.indices.map { sector ->
        val centerX = (sector + 0.5) / CLOCK_SECTORS.size
        val degrees = Math.toDegrees(atan((centerX - 0.5) * frame.imageWidthPx / focalPx))
        val hours = (degrees / DEGREES_PER_HOUR).roundToInt().coerceIn(-2, 2)
        if (hours <= 0) 12 + hours else hours
    }
}

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

/** 박스 위나 아래가 영상 끝에 닿아 잘렸는지 */
fun isClippedVertically(box: PersonBox, config: VisionConfig): Boolean =
    box.top <= config.clippedEdge || box.bottom >= 1 - config.clippedEdge

/**
 * 거리(m)를 추정한다. 거리 ≈ 초점거리 × 사람 키 ÷ 박스 높이.
 * 가까운 사람은 다리나 머리가 화면 밖으로 잘려 높이로 재면 실제보다 멀게 나온다.
 * 그래서 위나 아래가 잘린 박스는 키 대신 사람 폭으로 잰다.
 */
fun estimateDistanceM(box: PersonBox, frame: DetectionFrame, config: VisionConfig): Double? {
    val focalPx = focalLengthPx(frame, config)
    val (sizePx, sizeM) = if (isClippedVertically(box, config)) {
        box.width * frame.imageWidthPx to config.personWidthM
    } else {
        box.height * frame.imageHeightPx to config.personHeightM
    }
    if (sizePx <= 0.0) return null
    return focalPx * sizeM / sizePx
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
 * 여러 칸이 같은 이름(labels)이면 그 칸이 모두 비어 있어야 그 방향이 비었다고 말한다.
 */
fun freeDirections(blocked: Set<Int>, labels: List<Int> = CLOCK_SECTORS): List<Int> {
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
        .map { labels[it] }
        .filter { label -> labels.indices.none { it in blocked && labels[it] == label } }
        .distinct()
}

/** 추적 중인 사람 하나. samples 는 (시각, 거리) 기록이다. */
private class Track(val id: Int, var box: PersonBox) {
    val samples = ArrayDeque<Pair<Long, Double>>()
    var missed = 0
    var alertedAtMs: Long? = null

    /** 지난 거리를 잘린 박스(폭)로 쟀는지. 재는 방법이 바뀌면 거리가 튀므로 기록을 새로 시작한다 */
    var measuredByWidth: Boolean? = null
}

/** 안내를 시작할 때마다 새로 만든다. 앞 프레임의 사람을 기억해 접근 속도를 잰다. */
class CrowdAnalyzer(private val config: VisionConfig = VisionConfig()) {
    private val tracks = mutableListOf<Track>()
    private var nextId = 0

    // 최근 프레임들의 빈 방향. 접근 경고에는 이어서 비어 있던 방향만 넣는다.
    private val recentFree = ArrayDeque<List<Int>>()

    fun analyze(frame: DetectionFrame): CrowdAnalysis {
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
        distances.forEach { (track, distance) ->
            if (distance != null && distance <= config.blockedDistanceM) {
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
        val free = freeDirections(blocked, clockLabels(frame, config))
        recentFree.addLast(free)
        while (recentFree.size > config.freeConfirmFrames) recentFree.removeFirst()
        // 넓은 순서는 지금 프레임을 따르고, 최근 프레임 내내 비어 있던 방향만 남긴다.
        val steadyFree = free.filter { direction -> recentFree.all { direction in it } }

        val level = when {
            frontClipped -> CrowdLevel.DANGER
            nearestFront != null && nearestFront <= config.dangerDistanceM -> CrowdLevel.DANGER
            blocked.size >= config.crowdedBlockedSectors -> CrowdLevel.CROWDED
            blocked.size >= config.cautionBlockedSectors -> CrowdLevel.CAUTION
            else -> CrowdLevel.CLEAR
        }
        val alert = front.keys
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
        return CrowdAnalysis(CrowdFrame(level, nearest, free), alert)
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
            track.missed = 0
            matchedTracks += track
            matchedBoxes += boxIndex
        }
        tracks.filter { it !in matchedTracks }.forEach { it.missed += 1 }
        tracks.removeAll { it.missed > config.trackMaxMissedFrames }

        val added = frame.boxes.indices
            .filter { it !in matchedBoxes }
            .map { Track(nextId++, frame.boxes[it]) }
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
