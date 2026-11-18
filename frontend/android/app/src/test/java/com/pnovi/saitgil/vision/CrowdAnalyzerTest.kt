package com.pnovi.saitgil.vision

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Test
import kotlin.math.tan

// 모델 없이 가짜 사람 박스로 판단 로직을 확인한다. Android 클래스는 쓰지 않는다.
class CrowdAnalyzerTest {
    private val config = VisionConfig()

    // 세로로 든 휴대폰 영상
    private val widthPx = 480
    private val heightPx = 640
    private val focalPx = (widthPx / 2.0) / tan(Math.toRadians(config.defaultHorizontalFovDeg / 2))

    /** distanceM 만큼 떨어진 사람 박스. 칸(0~4) 가운데에 세운다. */
    private fun person(sector: Int, distanceM: Double, width: Double = 0.1): PersonBox {
        val height = focalPx * config.personHeightM / distanceM / heightPx
        val centerX = (sector + 0.5) / CLOCK_SECTORS.size
        return PersonBox(centerX - width / 2, 0.5 - height / 2, width, height, score = 0.9)
    }

    private fun frame(timeMs: Long, vararg boxes: PersonBox) =
        DetectionFrame(timeMs, boxes.toList(), widthPx, heightPx)

    /** 100ms 간격으로 sector 칸에 distances 만큼 떨어진 사람을 보여 주고 프레임별 결과를 돌려준다. */
    private fun walkToward(
        analyzer: CrowdAnalyzer,
        distances: List<Double>,
        sector: Int = 2,
    ): List<CrowdAnalysis> =
        distances.mapIndexed { index, distance ->
            analyzer.analyze(frame(index * 100L, person(sector, distance)))
        }

    @Test
    fun estimatesDistanceFromBoxHeight() {
        val box = person(2, 2.5)

        val distance = estimateDistanceM(box, frame(0, box), config)

        assertEquals(2.5, distance!!, 1e-6)
    }

    @Test
    fun usesFocalLengthWhenGiven() {
        val box = PersonBox(0.45, 0.25, 0.1, 0.5, 0.9)
        val withFocal = DetectionFrame(0, listOf(box), widthPx, heightPx, focalLengthPx = 640.0)

        // 640 × 1.7 ÷ (0.5 × 640)
        assertEquals(3.4, estimateDistanceM(box, withFocal, config)!!, 1e-6)
    }

    @Test
    fun mapsHorizontalPositionToClockSectors() {
        assertEquals(listOf(10, 11, 12, 1, 2), listOf(0.05, 0.3, 0.5, 0.7, 0.99).map { CLOCK_SECTORS[sectorOf(it)] })
        assertEquals(2, CLOCK_SECTORS[sectorOf(1.0)])
    }

    @Test
    fun widestFreeRunComesFirst() {
        // 11시만 막힘 → 12·1·2시가 이어져 넓다. 가운데(1시)를 먼저 둔다.
        assertEquals(listOf(1, 12, 2, 10), freeDirections(setOf(1)))
        // 12시만 막힘 → 양쪽 너비가 같으면 12시에 가까운 칸이 먼저다.
        assertEquals(listOf(11, 10, 1, 2), freeDirections(setOf(2)))
        assertEquals(emptyList<Int>(), freeDirections(setOf(0, 1, 2, 3, 4)))
    }

    @Test
    fun emptyViewIsClear() {
        val result = CrowdAnalyzer(config).analyze(frame(0))

        assertEquals(CrowdLevel.CLEAR, result.frame.level)
        assertNull(result.frame.nearestPersonM)
        assertEquals(listOf(12, 11, 1, 10, 2), result.frame.freeDirections)
        assertNull(result.alert)
    }

    @Test
    fun levelFollowsBlockedSectorCount() {
        val analyzer = CrowdAnalyzer(config)

        val caution = analyzer.analyze(frame(0, person(0, 3.0)))
        assertEquals(CrowdLevel.CAUTION, caution.frame.level)

        val crowded = CrowdAnalyzer(config).analyze(
            frame(0, person(0, 3.0), person(1, 3.0), person(3, 3.0)),
        )
        assertEquals(CrowdLevel.CROWDED, crowded.frame.level)
        assertEquals(listOf(12, 2), crowded.frame.freeDirections)
        assertEquals(3.0, crowded.frame.nearestPersonM!!, 1e-6)
    }

    @Test
    fun farPeopleDoNotBlock() {
        val result = CrowdAnalyzer(config).analyze(frame(0, person(2, 8.0)))

        assertEquals(CrowdLevel.CLEAR, result.frame.level)
        assertEquals(8.0, result.frame.nearestPersonM!!, 1e-6)
    }

    @Test
    fun allBlockedLeavesNoFreeDirection() {
        val result = CrowdAnalyzer(config).analyze(
            frame(0, *(0..4).map { person(it, 3.0) }.toTypedArray()),
        )

        assertEquals(CrowdLevel.CROWDED, result.frame.level)
        assertEquals(emptyList<Int>(), result.frame.freeDirections)
    }

    @Test
    fun veryCloseFrontPersonIsDanger() {
        val near = CrowdAnalyzer(config).analyze(frame(0, person(2, 0.9, width = 0.3)))
        assertEquals(CrowdLevel.DANGER, near.frame.level)

        // 위아래가 다 잘린 정면 사람도 위험이다.
        val clipped = CrowdAnalyzer(config).analyze(frame(0, PersonBox(0.35, 0.0, 0.3, 1.0, 0.9)))
        assertEquals(CrowdLevel.DANGER, clipped.frame.level)
    }

    @Test
    fun followingWalkerIsNotAnApproach() {
        val results = walkToward(CrowdAnalyzer(config), List(12) { 2.5 })

        assertNull(results.firstNotNullOfOrNull { it.alert })
    }

    @Test
    fun closingOnStoppedPersonAlertsWithFreeDirections() {
        // 1.2 m/s 로 걸어 멈춘 앞사람에게 다가간다.
        val distances = List(12) { 3.6 - it * 0.12 }

        val results = walkToward(CrowdAnalyzer(config), distances)

        val index = results.indexOfFirst { it.alert != null }
        val alert = results.getOrNull(index)?.alert
        assertNotNull(alert)
        assertEquals(AlertKind.DANGER, alert!!.kind)
        assertEquals(distances[index], alert.distanceM!!, 1e-6)
        assertEquals(results[index].frame.freeDirections, alert.freeDirections)
    }

    @Test
    fun farApproachIsNotAlertedYet() {
        // 빠르게 가까워져도 경고 거리 밖이면 알리지 않는다.
        val results = walkToward(CrowdAnalyzer(config), List(12) { 8.0 - it * 0.12 })

        assertNull(results.firstNotNullOfOrNull { it.alert })
    }

    @Test
    fun sameApproachIsNotRepeatedRightAway() {
        val results = walkToward(CrowdAnalyzer(config), List(20) { 4.0 - it * 0.12 })

        assertEquals(1, results.mapNotNull { it.alert }.size)
    }

    @Test
    fun sidePersonApproachingIsNotAFrontAlert() {
        val results = walkToward(CrowdAnalyzer(config), List(12) { 3.6 - it * 0.12 }, sector = 0)

        assertNull(results.firstNotNullOfOrNull { it.alert })
    }

    @Test
    fun brieflyMissedPersonKeepsTrack() {
        val analyzer = CrowdAnalyzer(config)
        val distances = List(12) { 3.6 - it * 0.12 }

        // 경고 직전 한 프레임을 놓친다. 같은 사람으로 이어 봐야 접근을 알 수 있다.
        val results = distances.mapIndexed { index, distance ->
            val boxes = if (index == 5) emptyArray() else arrayOf(person(2, distance))
            analyzer.analyze(frame(index * 100L, *boxes))
        }

        assertNotNull(results.firstNotNullOfOrNull { it.alert })
    }
}
