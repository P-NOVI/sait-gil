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

    /** 실기기 추론 간격(약 0.7초)으로 index 번째 노트8 프레임 */
    private fun walkFrame(index: Int, vararg objects: ObjectBox) = note8Frame(*objects).copy(timeMs = index * 700L)

    /** 바닥 기준 distanceM 앞에 서 있는 높이 1m 장애물 박스. 목걸이 높이에서 수평으로 찍은 노트8 영상이다 */
    private fun groundBox(kind: DetectedClass, distanceM: Double, sector: Int = 2): ObjectBox {
        val bottom = config.horizonY + config.cameraHeightM * note8FocalPx / distanceM / heightPx
        val height = note8FocalPx * 1.0 / distanceM / heightPx
        val centerX = (sector + 0.5) / CLOCK_SECTORS.size
        return ObjectBox(kind, centerX - 0.05, bottom - height, 0.1, height, score = 0.9)
    }

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

        assertEquals(labels[sectorOf(wide.centerX)], results[0].seen.single().direction)
    }

    @Test
    fun obstacleCenteredInSideSectorIsReadInTheFrontSectorItReaches() {
        // 가운데는 왼쪽 끝 칸(11시)이지만 앞쪽 칸(12시)까지 걸친 차
        val car = ObjectBox(DetectedClass.CAR, 0.0, 0.6, 0.3, 0.3, score = 0.9)
        assertEquals(listOf(11, 12, 12, 12, 1), clockLabels(frame(0), config))

        val result = ObjectAnalyzer(config).analyze(frame(0, car))

        assertEquals(12, result.seen.single().direction)
    }

    @Test
    fun firstAlertNeedsConsecutiveFrames() {
        val pole = listOf(box(DetectedClass.POLE))

        val results = run(ObjectAnalyzer(config), listOf(pole, pole, emptyList(), pole, pole, pole))

        assertTrue(results.take(5).all { it.alerts.isEmpty() })
        assertEquals(1, results[5].alerts.size)
    }

    @Test
    fun sameObstacleIsAlertedOnceWhileSeen() {
        // 약 2.5m 앞 계단이 12초 동안 계속 보인다.
        val results = run(ObjectAnalyzer(config), repeat(listOf(box(DetectedClass.STAIRS)), 120))

        val alertedAt = results.indices.filter { results[it].alerts.isNotEmpty() }
        assertEquals(listOf(2), alertedAt)
    }

    @Test
    fun obstacleAlertedFarIsAlertedAgainWhenClose() {
        val analyzer = ObjectAnalyzer(config)

        // 9m 앞 기둥으로 약 1.2m/s 로 걸어간다.
        val results = (0 until 8).map { index ->
            walkFrame(index, groundBox(DetectedClass.POLE, 9.0 - index * 0.84))
        }.map(analyzer::analyze)

        val alertedAt = results.indices.filter { results[it].alerts.isNotEmpty() }
        assertEquals(listOf(2, 5), alertedAt)
        assertEquals(9.0 - 2 * 0.84, results[2].alerts.single().distanceM!!, 0.01)
        assertTrue(results[5].alerts.single().distanceM!! <= config.obstacleCloseM)
        assertNull(results[5].alerts.single().moving)
    }

    @Test
    fun nearestObstacleIsAlertedFirstAndNextAfterGap() {
        val analyzer = ObjectAnalyzer(config)
        val pole = groundBox(DetectedClass.POLE, 8.0, sector = 1)
        val low = groundBox(DetectedClass.OBSTACLE, 4.0, sector = 3)

        val results = (0 until 6).map { analyzer.analyze(walkFrame(it, pole, low)) }

        val alerted = results.map { result -> result.alerts.map { it.objectClass } }
        // 앞 알림 뒤 noticeGapMs(1.5초) 안의 프레임(0.7초 간격)은 건너뛴다.
        assertEquals(
            listOf(emptyList(), emptyList(), listOf(DetectedClass.OBSTACLE), emptyList(), emptyList(), listOf(DetectedClass.POLE)),
            alerted,
        )
    }

    @Test
    fun parkedCarCloserThanPoleIsAlertedFirst() {
        val analyzer = ObjectAnalyzer(config)

        // 약 1.2m/s 로 걷는다. 가까운 바닥 장애물을 알린 뒤 기다리는 동안, 서 있는 차(12m 에서 시작)와
        // 그보다 조금 먼 기둥(12.3m 에서 시작)이 함께 알릴 차례가 된다.
        val results = (0 until 9).map { index ->
            val walked = index * 0.84
            val car = boxAt(DetectedClass.CAR, config.carHeightM, 12.0 - walked)
            val pole = groundBox(DetectedClass.POLE, 12.3 - walked, sector = 3)
            val low = groundBox(DetectedClass.OBSTACLE, 5.0 - walked, sector = 1).takeIf { index <= 2 }
            walkFrame(index, *listOfNotNull(car, pole, low).toTypedArray())
        }.map(analyzer::analyze)

        val alerted = results.indices.filter { results[it].alerts.isNotEmpty() }
        assertEquals(listOf(2, 5, 8), alerted)
        assertEquals(DetectedClass.OBSTACLE, results[2].alerts.single().objectClass)
        val car = results[5].alerts.single()
        assertEquals(DetectedClass.CAR, car.objectClass)
        assertEquals(false, car.moving)
        assertEquals(DetectedClass.POLE, results[8].alerts.single().objectClass)
    }

    @Test
    fun groundDistanceComesFromBoxBottom() {
        val frame = note8Frame()

        assertEquals(1.3 * note8FocalPx / (0.1 * heightPx), groundDistanceM(box(DetectedClass.POLE, bottom = 0.6), frame, config)!!, 0.01)
        assertNull(groundDistanceM(box(DetectedClass.POLE, bottom = 0.5), frame, config))
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
        // 추적에서 빠질 만큼 오래, 그리고 알림 간격(noticeGapMs)보다 길게 안 보인다.
        val gap = repeat(emptyList(), maxOf(config.obstacleMaxMissedFrames + 1, (config.noticeGapMs / 100).toInt()))

        val results = run(ObjectAnalyzer(config), repeat(pole, 3) + gap + repeat(pole, 3))

        assertEquals(2, results.sumOf { it.alerts.size })
        assertEquals(1, results.last().alerts.size)
    }

    @Test
    fun eachClassAlertsOnItsOwn() {
        val both = listOf(box(DetectedClass.POLE, sector = 1), box(DetectedClass.STAIRS, sector = 3))

        // 한 번에 하나씩, 알림 간격(noticeGapMs)을 두고 각각 한 번 알린다.
        val results = run(ObjectAnalyzer(config), repeat(both, 3 + (config.noticeGapMs / 100).toInt()))

        val alerted = results.flatMap { result -> result.alerts.map { it.objectClass } }
        assertEquals(1, results[2].alerts.size)
        assertEquals(setOf(DetectedClass.POLE, DetectedClass.STAIRS), alerted.toSet())
        assertEquals(2, alerted.size)
    }

    @Test
    fun veryNearApproachingVehicleAlertsOnSecondFrame() {
        // 걷는 길 위 vehicleImmediateM 안에서 두 프레임 사이 약 3.6m/s 로 다가오는 차는 세 프레임을 기다리지 않는다.
        val analyzer = ObjectAnalyzer(config)

        val results = listOf(9.0, 6.5).mapIndexed { index, distance ->
            analyzer.analyze(walkFrame(index, boxAt(DetectedClass.CAR, config.carHeightM, distance)))
        }

        assertTrue(results[0].alerts.isEmpty())
        assertEquals(true, results[1].alerts.single().moving)
    }

    @Test
    fun veryNearParkedCarIsNeverWarnedAsMoving() {
        // 걷는 길 위 10m 안에서 처음 보인 서 있는 차. 한 프레임만 보고 "조심" 하지 않고, 서 있는 차로 알린다.
        val analyzer = ObjectAnalyzer(config)

        val results = (0 until 3).map { index ->
            analyzer.analyze(walkFrame(index, boxAt(DetectedClass.CAR, config.carHeightM, 9.0 - index * 0.84)))
        }

        assertTrue(results.take(2).all { it.alerts.isEmpty() })
        assertEquals(false, results[2].alerts.single().moving)
    }

    @Test
    fun cutOffParkedCarIsJudgedByBoxWidth() {
        // 바로 옆 주차된 차라 박스 아래가 잘렸다. 폭으로 거리를 재 서 있는 차로 본다.
        val analyzer = ObjectAnalyzer(config)

        val results = (0 until 3).map { index ->
            val width = note8FocalPx * config.carWidthM / (4.0 - index * 0.84) / widthPx
            val car = ObjectBox(DetectedClass.CAR, 0.5 - width / 2, 0.6, width, 0.4, score = 0.9)
            analyzer.analyze(walkFrame(index, car))
        }

        assertTrue(results.take(2).all { it.alerts.isEmpty() })
        assertEquals(false, results[2].alerts.single().moving)
        assertEquals(4.0 - 2 * 0.84, results[2].alerts.single().distanceM!!, 0.01)
    }

    @Test
    fun vehicleSeenAgainAfterGapWaitsForWarnRepeatTime() {
        // 다가오는 차(두 프레임에 9m → 6.5m)가 추적이 끊겨 새 차로 잡혀도 반복 시간 안이면 알리지 않고, 지나면 알린다.
        val approach = listOf(9.0, 6.5).map { boxAt(DetectedClass.CAR, config.carHeightM, it) }
        val gap = List(config.obstacleMaxMissedFrames + 1) { null }
        val boxes = approach + gap + approach + List(10) { null } + approach
        // 0.7초 간격으로는 추적에서 빠지는 데만 4초 넘게 걸려, 반복 시간을 늘려 확인한다.
        val analyzer = ObjectAnalyzer(config.copy(vehicleWarnRepeatMs = 8_000))

        val alertedAt = boxes.indices.filter { index ->
            analyzer.analyze(walkFrame(index, *listOfNotNull(boxes[index]).toTypedArray())).alerts.isNotEmpty()
        }

        assertEquals(listOf(1, boxes.lastIndex), alertedAt)
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
        // 박스 아래 끝(0.55)은 바닥 기준으로 약 20m 라 obstacleNearM 보다 먼 차·이륜차
        val car = boxAt(DetectedClass.CAR, config.carHeightM, config.carNearM - 1, bottom = 0.55)
        val twoWheeler =
            boxAt(DetectedClass.TWO_WHEELER, config.twoWheelerHeightM, config.twoWheelerNearM - 1, bottom = 0.55)

        val result = ObjectAnalyzer(config).analyze(note8Frame(car, twoWheeler))

        assertEquals(setOf(DetectedClass.CAR, DetectedClass.TWO_WHEELER), result.seen.map { it.kind }.toSet())
        // 화면에는 바로 보이지만, 먼 차는 움직이는지 판단한 뒤에 알린다(VehicleTrackerTest).
        assertTrue(result.alerts.isEmpty())
    }

    @Test
    fun leavingVehicleIsNotSeen() {
        // 약 1.4m/s 로 멀어지는 차. 멀어지는 것으로 판단한 뒤에는 화면의 앞 장애물에서도 뺀다.
        val analyzer = ObjectAnalyzer(config)
        val results = listOf(6.0, 7.0, 8.0, 9.0).mapIndexed { index, distance ->
            analyzer.analyze(walkFrame(index, boxAt(DetectedClass.CAR, config.carHeightM, distance)))
        }

        assertEquals(listOf(DetectedClass.CAR), results[0].seen.map { it.kind })
        // results[1] 은 확인하지 않는다. 세 프레임을 보기 전에는 움직임을 몰라 아직 보이는 것이 의도된 동작이다.
        assertTrue(results[2].seen.isEmpty())
        assertTrue(results[3].seen.isEmpty())
    }

    @Test
    fun leavingVehicleDoesNotHideOtherNearbyVehicle() {
        // 멀어지는 차 옆의 이륜차는 박스 단위로 거르므로 계속 보인다. 종류 단위로 거르면 이 테스트가 깨진다.
        val analyzer = ObjectAnalyzer(config)
        val results = listOf(6.0, 7.0, 8.0, 9.0).mapIndexed { index, distance ->
            analyzer.analyze(
                walkFrame(
                    index,
                    boxAt(DetectedClass.CAR, config.carHeightM, distance),
                    boxAt(DetectedClass.TWO_WHEELER, config.twoWheelerHeightM, config.twoWheelerNearM - 1),
                ),
            )
        }

        assertEquals(listOf(DetectedClass.TWO_WHEELER), results.last().seen.map { it.kind })
    }

    @Test
    fun parkedCarAlertSaysItIsStillWithDistanceAndAgainWhenClose() {
        val analyzer = ObjectAnalyzer(config)

        // 서 있는 차로 약 1.2m/s 로 걸어간다(0.7초 간격 프레임). 마지막은 약 4.9m 다.
        val results = (0 until 13).map { index ->
            analyzer.analyze(walkFrame(index, boxAt(DetectedClass.CAR, config.carHeightM, 15.0 - index * 0.84)))
        }

        val (far, close) = results.flatMap { it.alerts }
        assertEquals(AlertKind.OBSTACLE, far.kind)
        assertEquals(false, far.moving)
        assertTrue(far.distanceM!! in config.obstacleCloseM..config.vehicleStillNearM)
        assertEquals(false, close.moving)
        assertTrue(close.distanceM!! <= config.obstacleCloseM)
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
    fun vehicleCutOffAtBottomIsSeenAsNear() {
        // 바퀴가 영상 아래로 잘려 박스 높이로는 멀게 나오는 차. 화면에는 가깝게 보이지만 한 프레임으로는 알리지 않는다.
        val car = ObjectBox(DetectedClass.CAR, 0.45, 0.95, 0.1, 0.05, score = 0.9)

        val result = ObjectAnalyzer(config).analyze(note8Frame(car))

        assertEquals(listOf(DetectedClass.CAR), result.seen.map { it.kind })
        assertTrue(result.alerts.isEmpty())
    }

    @Test
    fun otherObstaclesUseGroundDistanceFromBoxBottom() {
        // 높이로 재면 가깝지만 아래 끝이 수평선에 있는 기둥과, 작지만 아래 끝이 가까운 바닥 장애물
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
