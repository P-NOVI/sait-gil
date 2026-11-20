package com.pnovi.saitgil.vision

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

// 모델 없이 가짜 장애물·신호등 박스로 판단 로직을 확인한다. Android 클래스는 쓰지 않는다.
class ObjectAnalyzerTest {
    private val config = VisionConfig()

    // 목걸이로 세워 건 휴대폰 영상(세운 화면 기준)
    private val widthPx = 480
    private val heightPx = 640

    /** 칸(0~4) 가운데에 세운 박스. bottom 이 클수록 가깝다 */
    private fun box(
        kind: DetectedClass,
        sector: Int = 2,
        bottom: Double = 0.9,
        width: Double = 0.1,
    ): ObjectBox {
        val centerX = (sector + 0.5) / CLOCK_SECTORS.size
        return ObjectBox(kind, centerX - width / 2, bottom - 0.3, width, 0.3, score = 0.9)
    }

    private fun frame(timeMs: Long, vararg objects: ObjectBox) =
        DetectionFrame(timeMs, emptyList(), widthPx, heightPx, objects = objects.toList())

    // 노트8 후면 카메라(초점거리 4.3mm, 센서 긴 변 5.645mm)의 세운 영상 초점거리(px)
    private val note8FocalPx = 4.3 / 5.645 * heightPx

    /** 실제 높이 heightM 인 물체가 distanceM 앞에 있을 때의 박스. 칸(0~4) 가운데에, 아래 끝을 bottom 에 둔다 */
    private fun boxAt(kind: DetectedClass, heightM: Double, distanceM: Double, bottom: Double = 0.6): ObjectBox {
        val height = note8FocalPx * heightM / distanceM / heightPx
        val centerX = (2 + 0.5) / CLOCK_SECTORS.size
        return ObjectBox(kind, centerX - 0.05, bottom - height, 0.1, height, score = 0.9)
    }

    private fun note8Frame(vararg objects: ObjectBox) =
        DetectionFrame(0, emptyList(), widthPx, heightPx, focalLengthPx = note8FocalPx, objects = objects.toList())

    /** 100ms 간격 프레임들을 차례로 판단한다. 프레임마다 보일 박스를 준다(없으면 빈 프레임) */
    private fun run(
        analyzer: ObjectAnalyzer,
        frames: List<List<ObjectBox>>,
        startMs: Long = 0,
    ): List<ObjectAnalysis> =
        frames.mapIndexed { index, objects ->
            analyzer.analyze(frame(startMs + index * 100L, *objects.toTypedArray()))
        }

    private fun repeat(objects: List<ObjectBox>, times: Int) = List(times) { objects }

    @Test
    fun alertsNearObstacleAheadAfterConfirmFrames() {
        val results = run(ObjectAnalyzer(config), repeat(listOf(box(DetectedClass.POLE)), 3))

        assertTrue(results[0].alerts.isEmpty())
        assertTrue(results[1].alerts.isEmpty())
        val alert = results[2].alerts.single()
        assertEquals(AlertKind.OBSTACLE, alert.kind)
        assertEquals(DetectedClass.POLE, alert.objectClass)
        assertEquals(12, alert.direction)
    }

    @Test
    fun ignoresFarObstacle() {
        val far = box(DetectedClass.OBSTACLE, bottom = 0.5)

        val results = run(ObjectAnalyzer(config), repeat(listOf(far), 5))

        assertTrue(results.all { it.alerts.isEmpty() })
    }

    @Test
    fun ignoresObstacleOnlyInSideSectors() {
        val left = box(DetectedClass.CAR, sector = 0)
        val right = box(DetectedClass.CAR, sector = 4)

        val results = run(ObjectAnalyzer(config), repeat(listOf(left, right), 5))

        assertTrue(results.all { it.alerts.isEmpty() })
    }

    @Test
    fun alertsObstacleReachingIntoFrontSectorWithItsOwnDirection() {
        // 왼쪽 끝 칸에서 다음 칸까지 걸친 이륜차
        val wide = ObjectBox(DetectedClass.TWO_WHEELER, 0.1, 0.6, 0.2, 0.3, score = 0.9)
        val labels = clockLabels(frame(0), config)

        val results = run(ObjectAnalyzer(config), repeat(listOf(wide), 3))

        assertEquals(labels[sectorOf(wide.centerX)], results[0].alerts.single().direction)
    }

    @Test
    fun obstacleCenteredInSideSectorIsReadInTheFrontSectorItReaches() {
        // 가운데는 왼쪽 끝 칸(11시)이지만 앞쪽 칸(12시)까지 걸친 차
        val car = ObjectBox(DetectedClass.CAR, 0.0, 0.6, 0.3, 0.3, score = 0.9)
        assertEquals(listOf(11, 12, 12, 12, 1), clockLabels(frame(0), config))

        val result = ObjectAnalyzer(config).analyze(frame(0, car))

        assertEquals(12, result.alerts.single().direction)
    }

    @Test
    fun firstAlertNeedsConsecutiveFrames() {
        val pole = listOf(box(DetectedClass.POLE))

        val results = run(ObjectAnalyzer(config), listOf(pole, pole, emptyList(), pole, pole, pole))

        assertTrue(results.take(5).all { it.alerts.isEmpty() })
        assertEquals(1, results[5].alerts.size)
    }

    @Test
    fun repeatsWhileStillSeenOnlyAfterRepeatTime() {
        val frames = (config.obstacleRepeatMs / 100 + 3).toInt()

        val results = run(ObjectAnalyzer(config), repeat(listOf(box(DetectedClass.STAIRS)), frames))

        val alertedAt = results.indices.filter { results[it].alerts.isNotEmpty() }
        assertEquals(listOf(2, 2 + (config.obstacleRepeatMs / 100).toInt()), alertedAt)
    }

    @Test
    fun briefGapAfterAlertDoesNotAlertAgain() {
        val pole = listOf(box(DetectedClass.POLE))
        val gap = repeat(emptyList(), config.obstacleMaxMissedFrames)

        val results = run(ObjectAnalyzer(config), repeat(pole, 3) + gap + repeat(pole, 3))

        assertEquals(1, results.sumOf { it.alerts.size })
    }

    @Test
    fun obstacleGoneLongerThanMaxMissedAlertsAgain() {
        val pole = listOf(box(DetectedClass.POLE))
        val gap = repeat(emptyList(), config.obstacleMaxMissedFrames + 1)

        val results = run(ObjectAnalyzer(config), repeat(pole, 3) + gap + repeat(pole, 3))

        assertEquals(2, results.sumOf { it.alerts.size })
        assertEquals(1, results.last().alerts.size)
    }

    @Test
    fun eachClassAlertsOnItsOwn() {
        val both = listOf(box(DetectedClass.POLE, sector = 1), box(DetectedClass.CAR, sector = 3))

        val results = run(ObjectAnalyzer(config), repeat(both, 3))

        assertEquals(listOf(DetectedClass.CAR), results[0].alerts.map { it.objectClass })
        assertEquals(listOf(DetectedClass.POLE), results[2].alerts.map { it.objectClass })
    }

    @Test
    fun veryNearVehiclesOnThePathAlertOnFirstFrame() {
        // 걷는 길 위 vehicleImmediateM 안의 차·이륜차는 움직이는지 판단하기 전에 바로 알린다.
        val results = run(
            ObjectAnalyzer(config),
            listOf(listOf(box(DetectedClass.CAR, sector = 1)), emptyList(), listOf(box(DetectedClass.TWO_WHEELER))),
        )

        assertEquals(listOf(DetectedClass.CAR), results[0].alerts.map { it.objectClass })
        assertEquals(listOf(DetectedClass.TWO_WHEELER), results[2].alerts.map { it.objectClass })
    }

    @Test
    fun vehicleSeenAgainAfterGapWaitsForWarnRepeatTime() {
        val car = listOf(box(DetectedClass.CAR))
        val gap = repeat(emptyList(), config.obstacleMaxMissedFrames + 1)
        // 추적이 끊겨 새 차로 잡혀도 반복 시간 안이면 알리지 않고, 지나면 알린다.
        val afterRepeat = (config.vehicleWarnRepeatMs / 100).toInt()

        val results = run(
            ObjectAnalyzer(config),
            listOf(car) + gap + listOf(car) + repeat(emptyList(), afterRepeat) + listOf(car),
        )

        val alertedAt = results.indices.filter { results[it].alerts.isNotEmpty() }
        assertEquals(listOf(0, results.lastIndex), alertedAt)
    }

    @Test
    fun seenListsNearObstaclesAheadEveryFrameWithoutConfirming() {
        val pole = box(DetectedClass.POLE, sector = 1)
        val car = box(DetectedClass.CAR, sector = 3)
        val labels = clockLabels(frame(0), config)

        val results = run(ObjectAnalyzer(config), listOf(listOf(pole, car), emptyList(), listOf(pole)))

        assertEquals(
            listOf(ObstacleSighting(DetectedClass.CAR, labels[3]), ObstacleSighting(DetectedClass.POLE, labels[1])),
            results[0].seen,
        )
        assertTrue(results[0].alerts.none { it.objectClass == DetectedClass.POLE })
        assertTrue(results[1].seen.isEmpty())
        assertEquals(listOf(ObstacleSighting(DetectedClass.POLE, labels[1])), results[2].seen)
    }

    @Test
    fun vehiclesAreSeenByDistanceFromBoxHeightNotBoxBottom() {
        // 박스 아래 끝(0.6)은 obstacleNearBottom(0.7) 보다 위라 바닥 기준으로는 먼 차·이륜차
        val car = boxAt(DetectedClass.CAR, config.carHeightM, config.carNearM - 1)
        val twoWheeler = boxAt(DetectedClass.TWO_WHEELER, config.twoWheelerHeightM, config.twoWheelerNearM - 1)

        val result = ObjectAnalyzer(config).analyze(note8Frame(car, twoWheeler))

        assertEquals(setOf(DetectedClass.CAR, DetectedClass.TWO_WHEELER), result.seen.map { it.kind }.toSet())
        // 화면에는 바로 보이지만, 먼 차는 움직이는지 판단한 뒤에 알린다(VehicleTrackerTest).
        assertTrue(result.alerts.isEmpty())
    }

    @Test
    fun parkedCarAlertSaysItIsStillWithDistance() {
        val analyzer = ObjectAnalyzer(config)

        // 서 있는 차로 약 1.2m/s 로 걸어간다(0.7초 간격 프레임).
        val results = (0 until 13).map { index ->
            val car = boxAt(DetectedClass.CAR, config.carHeightM, 15.0 - index * 0.84)
            analyzer.analyze(note8Frame(car).copy(timeMs = index * 700L))
        }

        val alert = results.flatMap { it.alerts }.single()
        assertEquals(AlertKind.OBSTACLE, alert.kind)
        assertEquals(false, alert.moving)
        assertTrue(alert.distanceM!! <= config.vehicleStillNearM)
        assertTrue(results.last().vehicles.single().motion == VehicleMotion.STILL)
    }

    @Test
    fun vehiclesFartherThanNearDistanceAreIgnoredEvenAtBottom() {
        val car = boxAt(DetectedClass.CAR, config.carHeightM, config.carNearM + 5, bottom = 0.9)
        val twoWheeler =
            boxAt(DetectedClass.TWO_WHEELER, config.twoWheelerHeightM, config.twoWheelerNearM + 5, bottom = 0.9)

        val result = ObjectAnalyzer(config).analyze(note8Frame(car, twoWheeler))

        assertTrue(result.seen.isEmpty())
        assertTrue(result.alerts.isEmpty())
    }

    @Test
    fun vehicleCutOffAtBottomIsNear() {
        // 바퀴가 영상 아래로 잘려 박스 높이로는 멀게 나오는 차
        val car = ObjectBox(DetectedClass.CAR, 0.45, 0.95, 0.1, 0.05, score = 0.9)

        val result = ObjectAnalyzer(config).analyze(note8Frame(car))

        assertEquals(listOf(DetectedClass.CAR), result.alerts.map { it.objectClass })
    }

    @Test
    fun otherObstaclesStillUseBoxBottom() {
        // 높이로 재면 가깝지만 아래 끝이 높은 기둥과, 작지만 아래 끝이 가까운 바닥 장애물
        val pole = boxAt(DetectedClass.POLE, 1.0, 2.0, bottom = 0.5)
        val low = boxAt(DetectedClass.OBSTACLE, 0.3, 20.0, bottom = 0.9)

        val result = ObjectAnalyzer(config).analyze(note8Frame(pole, low))

        assertEquals(listOf(DetectedClass.OBSTACLE), result.seen.map { it.kind })
    }

    @Test
    fun seenSkipsFarAndSideObstacles() {
        val far = box(DetectedClass.OBSTACLE, bottom = 0.5)
        val side = box(DetectedClass.CAR, sector = 0)

        val result = ObjectAnalyzer(config).analyze(frame(0, far, side))

        assertTrue(result.seen.isEmpty())
    }

    @Test
    fun signalChangesOnlyAfterConfirmFrames() {
        val red = listOf(box(DetectedClass.PED_SIGNAL_RED, bottom = 0.3))

        val results = run(ObjectAnalyzer(config), repeat(red, 3))

        assertNull(results[1].signal)
        assertEquals(SignalState.RED, results[2].signal)
        assertTrue(results.all { it.alerts.isEmpty() })
    }

    @Test
    fun redWinsWhenAheadSignalsAreSameSize() {
        val both = listOf(
            box(DetectedClass.PED_SIGNAL_OTHER, sector = 1, bottom = 0.3),
            box(DetectedClass.PED_SIGNAL_RED, sector = 3, bottom = 0.3),
        )

        val results = run(ObjectAnalyzer(config), repeat(both, 3))

        assertEquals(SignalState.RED, results[2].signal)
    }

    @Test
    fun ignoresSignalsInSideSectors() {
        // 교차로 옆 방향 빨간불은 보지 않고 앞쪽 신호등 색을 쓴다.
        val signals = listOf(
            box(DetectedClass.PED_SIGNAL_RED, sector = 0, bottom = 0.3),
            box(DetectedClass.PED_SIGNAL_RED, sector = 4, bottom = 0.3),
            box(DetectedClass.PED_SIGNAL_OTHER, sector = 2, bottom = 0.3),
        )

        val results = run(ObjectAnalyzer(config), repeat(signals, 3))

        assertEquals(SignalState.OTHER, results[2].signal)
    }

    @Test
    fun onlySideSignalsMeanNoSignal() {
        val side = listOf(box(DetectedClass.PED_SIGNAL_RED, sector = 0, bottom = 0.3))

        val results = run(ObjectAnalyzer(config), repeat(side, 3))

        assertTrue(results.all { it.signal == null })
    }

    @Test
    fun largestAheadSignalWins() {
        // 멀리 보이는 작은 빨간불보다 가까운 큰 신호등을 따른다.
        val signals = listOf(
            box(DetectedClass.PED_SIGNAL_RED, sector = 1, bottom = 0.3, width = 0.05),
            box(DetectedClass.PED_SIGNAL_OTHER, sector = 2, bottom = 0.3, width = 0.15),
        )

        val results = run(ObjectAnalyzer(config), repeat(signals, 3))

        assertEquals(SignalState.OTHER, results[2].signal)
    }

    @Test
    fun signalIgnoresOneFrameFlickerAndFollowsSteadyChange() {
        val red = listOf(box(DetectedClass.PED_SIGNAL_RED, bottom = 0.3))
        val other = listOf(box(DetectedClass.PED_SIGNAL_OTHER, bottom = 0.3))

        val results = run(
            ObjectAnalyzer(config),
            repeat(red, 3) + listOf(other) + repeat(red, 2) + repeat(other, 3) + repeat(emptyList(), 3),
        )

        assertEquals(SignalState.RED, results[3].signal)
        assertEquals(SignalState.RED, results[7].signal)
        assertEquals(SignalState.OTHER, results[8].signal)
        assertEquals(SignalState.OTHER, results[10].signal)
        assertNull(results[11].signal)
    }
}
