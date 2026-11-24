package com.pnovi.saitgil.vision

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import kotlin.math.tan

// 모델 없이 가짜 사람 박스로 판단 로직을 확인한다. Android 클래스는 쓰지 않는다.
class CrowdAnalyzerTest {
    // 박스는 화각·키 공식으로 만들므로 이 파일의 판단 테스트는 실측 보정값(distanceK) 없이 공식으로 돌린다.
    private val config = VisionConfig(distanceK = null)

    // 목걸이로 세워 건 휴대폰 영상(세운 화면 기준). 화각은 센서 긴 변(세로)에 맞춘다.
    private val widthPx = 480
    private val heightPx = 640
    private val focalPx = (heightPx / 2.0) / tan(Math.toRadians(config.defaultLongSideFovDeg / 2))

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
    fun measuredKGivesDistanceFromBoxHeightPerSector() {
        val measured = VisionConfig()
        val k = measured.distanceK!!
        val distance = 3.0

        CLOCK_SECTORS.indices.forEach { sector ->
            val centerX = (sector + 0.5) / CLOCK_SECTORS.size
            val height = k.heightK[sector] / distance
            val box = PersonBox(centerX - 0.05, 0.5 - height / 2, 0.1, height, score = 0.9)

            assertEquals(distance, estimateDistanceM(box, frame(0, box), measured)!!, 1e-6)
        }
    }

    @Test
    fun heightKIsInterpolatedBetweenSectorCenters() {
        val k = VisionConfig().distanceK!!

        // 칸 가운데 값은 그대로, 두 칸 경계는 두 값의 가운데, 양 끝 칸 가운데 밖은 끝 값이다.
        CLOCK_SECTORS.indices.forEach { sector ->
            assertEquals(k.heightK[sector], k.heightKAt((sector + 0.5) / CLOCK_SECTORS.size), 1e-9)
        }
        assertEquals((k.heightK[1] + k.heightK[2]) / 2, k.heightKAt(0.4), 1e-9)
        assertEquals(k.heightK.first(), k.heightKAt(0.0), 1e-9)
        assertEquals(k.heightK.last(), k.heightKAt(1.0), 1e-9)
    }

    @Test
    fun distanceDoesNotJumpWhenPersonCrossesSectorBoundary() {
        // 3m 앞 사람이 11시 칸에서 12시 칸으로 옆으로 걸어 들어와도(x 0.38→0.42) 거리가 계단처럼 튀지 않는다.
        val measured = VisionConfig()
        val k = measured.distanceK!!
        val height = k.heightKAt(0.4) / 3.0
        fun distanceAt(x: Double): Double {
            val box = PersonBox(x - 0.05, 0.5 - height / 2, 0.1, height, score = 0.9)
            return estimateDistanceM(box, frame(0, box), measured)!!
        }

        assertEquals(3.0, distanceAt(0.4), 1e-9)
        assertTrue(kotlin.math.abs(distanceAt(0.42) - distanceAt(0.38)) < 0.03)
    }

    @Test
    fun measuredKUsesBoxWidthWhenClippedVertically() {
        val measured = VisionConfig()
        val k = measured.distanceK!!
        val box = PersonBox(0.2, 0.0, k.widthK / 1.5, 1.0, score = 0.9)

        assertEquals(1.5, estimateDistanceM(box, frame(0, box), measured)!!, 1e-6)
    }

    @Test
    fun edgeSectorsMeasureFartherThanCenterForSameBox() {
        // 실측에서 양 끝 칸의 K 가 가운데보다 크다. 같은 높이의 박스라도 가장자리 사람이 더 멀다.
        val measured = VisionConfig()
        val center = PersonBox(0.45, 0.3, 0.1, 0.4, score = 0.9)
        val edge = PersonBox(0.0, 0.3, 0.1, 0.4, score = 0.9)

        assertTrue(
            estimateDistanceM(edge, frame(0, edge), measured)!! > estimateDistanceM(center, frame(0, center), measured)!!,
        )
    }

    @Test
    fun usesFocalLengthWhenGiven() {
        val box = PersonBox(0.45, 0.25, 0.1, 0.5, 0.9)
        val withFocal = DetectionFrame(0, listOf(box), widthPx, heightPx, focalLengthPx = 640.0)

        // 640 × 1.7 ÷ (0.5 × 640)
        assertEquals(3.4, estimateDistanceM(box, withFocal, config)!!, 1e-6)
    }

    @Test
    fun focalPerLongSideComesFromLensAndSensorSize() {
        // 노트8 후면 카메라: 초점거리 4.3mm, 센서 5.645×4.234mm
        val perLongSide = focalPerLongSide(4.3f, 5.645f, 4.234f)

        assertEquals(4.3 / 5.645, perLongSide!!, 1e-6)
        assertEquals(perLongSide, focalPerLongSide(4.3f, 4.234f, 5.645f)!!, 1e-6)
    }

    @Test
    fun focalPerLongSideIsNullWhenCameraInfoIsMissingOrWrong() {
        assertNull(focalPerLongSide(null, 5.6f, 4.2f))
        assertNull(focalPerLongSide(4.3f, null, 4.2f))
        assertNull(focalPerLongSide(0f, 5.6f, 4.2f))
        assertNull(focalPerLongSide(4.3f, 0f, 0f))
    }

    @Test
    fun cameraFocalLengthReplacesDefaultFieldOfView() {
        val frame = frame(0, person(2, 2.5))

        val withFocal = frame.withFocalPerLongSide(4.3 / 5.645)

        assertEquals(4.3 / 5.645 * heightPx, focalLengthPx(withFocal, config), 1e-6)
        assertEquals(frame, frame.withFocalPerLongSide(null))
    }

    @Test
    fun focalLengthComesFromLongSideWhicheverWayUp() {
        val upright = DetectionFrame(0, emptyList(), widthPx, heightPx)
        val sideways = DetectionFrame(0, emptyList(), heightPx, widthPx)

        assertEquals(focalPx, focalLengthPx(upright, config), 1e-6)
        assertEquals(focalPx, focalLengthPx(sideways, config), 1e-6)
    }

    @Test
    fun bottomClippedBoxIsMeasuredByWidth() {
        // 다리가 화면 아래로 잘린 0.8m 앞 사람. 높이로 재면 실제보다 멀게(위험 거리 밖으로) 나온다.
        val width = focalPx * config.personWidthM / 0.8 / widthPx
        val box = PersonBox(0.5 - width / 2, 0.45, width, 0.55, 0.9)
        val byHeight = focalPx * config.personHeightM / (box.height * heightPx)

        assertEquals(0.8, estimateDistanceM(box, frame(0, box), config)!!, 1e-6)
        assertEquals(true, byHeight > config.dangerDistanceM)
        assertEquals(CrowdLevel.DANGER, CrowdAnalyzer(config).analyze(frame(0, box)).frame.level)
    }

    @Test
    fun switchingToWidthMeasureIsNotAnApproach() {
        // 높이로 2.5m, 잘린 뒤 폭으로 2.0m 로 재더라도 그 차이는 다가온 것이 아니다.
        val width = focalPx * config.personWidthM / 2.0 / widthPx
        val full = PersonBox(0.5 - width / 2, 0.3, width, focalPx * config.personHeightM / 2.5 / heightPx, 0.9)
        val clipped = PersonBox(full.left, 0.3, width, 0.7, 0.9)
        val analyzer = CrowdAnalyzer(config)

        val alerts = (0 until 16).map { index ->
            analyzer.analyze(frame(index * 100L, if (index < 6) full else clipped)).alert
        }

        assertNull(alerts.firstOrNull { it != null })
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
    fun everySectorKeepsItsOwnName() {
        // 화각이 좁아도 칸 이름은 10·11·12·1·2시로 나뉜다. 12시 쏠림이 없다.
        assertEquals(listOf(10, 11, 12, 1, 2), CLOCK_SECTORS)
        // 12시 칸 하나가 막혀도 11시·1시 칸은 그대로 비었다고 말한다.
        assertEquals(listOf(11, 10, 1, 2), freeDirections(setOf(2)))
        assertEquals(listOf(12, 11, 1, 10, 2), freeDirections(emptySet()))
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
            frame(
                0,
                person(0, 3.0),
                person(0, 3.5),
                person(1, 3.0),
                person(1, 3.5),
                person(3, 3.0),
            ),
        )
        assertEquals(CrowdLevel.CROWDED, crowded.frame.level)
        // 10·11·1시 칸이 막혀 비어 있는 방향은 12시와 2시다. 12시에 가까운 12시를 먼저 둔다.
        assertEquals(listOf(12, 2), crowded.frame.freeDirections)
        assertEquals(3.0, crowded.frame.nearestPersonM!!, 1e-6)
    }

    @Test
    fun blockedSectorsWithoutEnoughPeopleAreNotCrowded() {
        // 세 칸이 막혀도 사람이 crowdedPeople 명 미만이면 혼잡이 아니라 주의다.
        val few = CrowdAnalyzer(config).analyze(
            frame(0, person(0, 3.0), person(1, 3.0), person(3, 3.0)),
        )
        assertEquals(CrowdLevel.CAUTION, few.frame.level)

        // 한 사람이 여러 칸에 걸쳐도 혼잡이 아니다.
        val wide = CrowdAnalyzer(config).analyze(frame(0, person(2, 3.0, width = 0.6)))
        assertEquals(CrowdLevel.CAUTION, wide.frame.level)
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
    fun approachAlertOnlyNamesSteadilyFreeDirections() {
        // 2시 칸(오른쪽 바깥 칸)을 막던 사람이 경고 직전 한 프레임만 사라진다. 그 2시는 아직 믿을 만한 빈 방향이 아니다.
        val analyzer = CrowdAnalyzer(config)
        val results = List(12) { 3.6 - it * 0.12 }.mapIndexed { index, distance ->
            val side = if (index in 3..5) arrayOf(person(4, 3.0)) else emptyArray()
            analyzer.analyze(frame(index * 100L, person(2, distance), *side))
        }

        val index = results.indexOfFirst { it.alert != null }
        assertEquals(6, index)
        assertEquals(true, 2 in results[index].frame.freeDirections)
        assertEquals(false, 2 in results[index].alert!!.freeDirections)
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
    fun closeNewPersonAtSideAlertsSideEntryWithClockDirection() {
        val analyzer = CrowdAnalyzer(config)
        analyzer.analyze(frame(0))

        val left = analyzer.analyze(frame(100, person(0, 1.4))).alert
        assertNotNull(left)
        assertEquals(AlertKind.SIDE_ENTRY, left!!.kind)
        assertEquals(10, left.direction)

        // 반대쪽은 따로 센다
        val right = analyzer.analyze(frame(200, person(4, 1.4))).alert
        assertEquals(2, right!!.direction)
    }

    @Test
    fun sideEntryIsNotAlertedForFarFrontFirstFrameOrKnownPerson() {
        // 시작 첫 프레임에 보이는 사람
        assertNull(CrowdAnalyzer(config).analyze(frame(0, person(0, 1.4))).alert)

        val analyzer = CrowdAnalyzer(config)
        analyzer.analyze(frame(0))
        // 멀리, 가운데 칸
        assertNull(analyzer.analyze(frame(100, person(0, 3.0))).alert)
        assertNull(analyzer.analyze(frame(200, person(2, 1.4))).alert)
        // 이미 보이던 사람이 가까이 오는 것은 새로 나타난 것이 아니다
        analyzer.analyze(frame(300, person(1, 3.0)))
        assertNull(analyzer.analyze(frame(400, person(1, 1.4))).alert)
    }

    @Test
    fun sameSideEntryIsNotRepeatedWithinRepeatTime() {
        val analyzer = CrowdAnalyzer(config)
        analyzer.analyze(frame(0))
        assertNotNull(analyzer.analyze(frame(100, person(0, 1.4))).alert)
        // 사람이 사라졌다 같은 쪽에 새 사람으로 다시 잡혀도 간격 안에는 알리지 않는다
        analyzer.analyze(frame(1_500))
        assertNull(analyzer.analyze(frame(1_600, person(1, 1.4))).alert)
        analyzer.analyze(frame(3_000))
        assertNotNull(analyzer.analyze(frame(3_200, person(1, 1.4))).alert)
    }

    @Test
    fun approachAlertNamesDirectionsFreeForConfirmTimeNotFrameCount() {
        // 2시 칸을 막던 사람이 사라진 지 freeConfirmMs 가 안 됐으면, 그사이 프레임이 많이 와도 2시를 빈 방향으로 넣지 않는다.
        val analyzer = CrowdAnalyzer(config)
        val step = 50L
        val clearAt = 8
        val results = List(24) { 3.6 - it * 0.06 }.mapIndexed { index, distance ->
            val side = if (index < clearAt) arrayOf(person(4, 3.0)) else emptyArray()
            analyzer.analyze(frame(index * step, person(2, distance), *side))
        }

        val index = results.indexOfFirst { it.alert != null }
        // 사라진 뒤 세 프레임 넘게 왔지만 freeConfirmMs 는 아직 안 지났다.
        assertTrue(index - clearAt >= 3)
        assertTrue((index - clearAt + 1) * step <= config.freeConfirmMs)
        assertEquals(true, 2 in results[index].frame.freeDirections)
        assertEquals(false, 2 in results[index].alert!!.freeDirections)
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
