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
    private fun boxAt(
        kind: DetectedClass,
        heightM: Double,
        distanceM: Double,
        bottom: Double = 0.6,
        sector: Int = 2,
    ): ObjectBox {
        val height = note8FocalPx * heightM / distanceM / heightPx
        val centerX = (sector + 0.5) / CLOCK_SECTORS.size
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

    /** 100ms 간격 노트8 프레임들을 차례로 판단한다. walkSpeedMps 는 GPS 걸음 속도다 */
    private fun runNote8(
        analyzer: ObjectAnalyzer,
        frames: List<List<ObjectBox>>,
        walkSpeedMps: Double? = null,
    ): List<ObjectAnalysis> =
        frames.mapIndexed { index, objects ->
            analyzer.analyze(note8Frame(*objects.toTypedArray()).copy(timeMs = index * 100L, walkSpeedMps = walkSpeedMps))
        }

    // 100ms 간격 프레임으로 obstacleConfirmMs 를 채우는 프레임 번호와, 알림 간격(noticeGapMs)·추적이 끊기는 시간(objectLostMs)의 프레임 수
    private val confirmAt = (config.obstacleConfirmMs / 100).toInt()
    private val gapFrames = (config.noticeGapMs / 100).toInt()
    private val lostFrames = (config.objectLostMs / 100).toInt()

    /** 걸음 속도 0 인 빈 프레임을 넣고 standingConfirmMs 뒤 시각을 돌려준다. 그 시각부터는 서 있는 것으로 본다 */
    private fun standStill(analyzer: ObjectAnalyzer): Long {
        analyzer.analyze(note8Frame().copy(timeMs = 0, walkSpeedMps = 0.0))
        return config.standingConfirmMs
    }

    @Test
    fun alertsNearObstacleAheadAfterConfirmTime() {
        val results = run(ObjectAnalyzer(config), repeat(listOf(box(DetectedClass.POLE)), confirmAt + 1))

        assertTrue(results.take(confirmAt).all { it.alerts.isEmpty() })
        val alert = results[confirmAt].alerts.single()
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
    fun ignoresObstacleFartherThanNearDistance() {
        val pole = groundBox(DetectedClass.POLE, config.obstacleNearM + 1)

        val results = runNote8(ObjectAnalyzer(config), repeat(listOf(pole), 20))

        assertTrue(results.all { it.alerts.isEmpty() && it.seen.isEmpty() })
    }

    @Test
    fun ignoresObstacleBesideTheWalkingCorridor() {
        // 4.5m 앞 왼쪽 끝 칸 기둥은 걷는 길(좌우 1m) 밖이라 알리지 않고, 다음 칸 기둥은 통로에 걸쳐 알린다.
        val side = groundBox(DetectedClass.POLE, 4.5, sector = 0)
        val inner = groundBox(DetectedClass.STAIRS, 4.5, sector = 1)

        val results = runNote8(ObjectAnalyzer(config), repeat(listOf(side, inner), confirmAt + 1))

        assertEquals(listOf(DetectedClass.STAIRS), results.flatMap { it.alerts }.map { it.objectClass })
        assertEquals(listOf(DetectedClass.STAIRS), results.last().seen.map { it.kind })
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

        val results = run(ObjectAnalyzer(config), repeat(listOf(wide), 3))

        assertEquals(CLOCK_SECTORS[sectorOf(wide.centerX)], results[0].seen.single().direction)
    }

    @Test
    fun obstacleCenteredInSideSectorIsReadInTheAheadSectorItReaches() {
        // 가운데는 왼쪽 끝 칸(10시)이지만 앞쪽 칸(11시)까지 걸친 차는 11시로 읽는다.
        val car = ObjectBox(DetectedClass.CAR, 0.0, 0.6, 0.3, 0.3, score = 0.9)

        val result = ObjectAnalyzer(config).analyze(frame(0, car))

        assertEquals(11, result.seen.single().direction)
    }

    @Test
    fun briefMissDoesNotRestartConfirmTime() {
        // int8 처럼 fps 가 높으면 같은 물체를 한두 프레임씩 자주 놓친다. objectLostMs 안이면 이어서 잰다.
        val pole = listOf(box(DetectedClass.POLE))

        val results = run(ObjectAnalyzer(config), listOf(pole, pole, emptyList()) + repeat(pole, confirmAt))

        assertTrue(results.take(confirmAt).all { it.alerts.isEmpty() })
        assertEquals(1, results[confirmAt].alerts.size)
    }

    @Test
    fun obstacleSeenOnlyBrieflyIsNotAlerted() {
        // 잘못 잡힌 박스처럼 잠깐 보였다 추적이 끊길 만큼 사라지면, 다시 보여도 처음부터 잰다.
        val pole = listOf(box(DetectedClass.POLE))

        val results = run(
            ObjectAnalyzer(config),
            repeat(pole, confirmAt - 1) + repeat(emptyList(), lostFrames + 1) + repeat(pole, confirmAt - 1),
        )

        assertTrue(results.all { it.alerts.isEmpty() })
    }

    @Test
    fun sameObstacleIsAlertedOnceWhileSeen() {
        // 약 2.5m 앞 계단이 12초 동안 계속 보인다.
        val results = run(ObjectAnalyzer(config), repeat(listOf(box(DetectedClass.STAIRS)), 120))

        val alertedAt = results.indices.filter { results[it].alerts.isNotEmpty() }
        assertEquals(listOf(confirmAt), alertedAt)
    }

    @Test
    fun walkingTowardPoleAlertsOnceWithinNearDistance() {
        // 7m 앞 기둥으로 1.2m/s 로 걸어간다(100ms 간격). obstacleNearM 안에 들어와 obstacleConfirmMs 뒤 한 번만 알린다.
        val distances = List(40) { 7.0 - it * 0.12 }

        val results = runNote8(ObjectAnalyzer(config), distances.map { listOf(groundBox(DetectedClass.POLE, it)) })

        val alertedAt = results.indices.filter { results[it].alerts.isNotEmpty() }
        assertEquals(listOf(distances.indexOfFirst { it <= config.obstacleNearM } + confirmAt), alertedAt)
        val alert = results[alertedAt.single()].alerts.single()
        assertTrue(alert.distanceM!! <= config.obstacleNearM)
        assertNull(alert.moving)
    }

    @Test
    fun nearestObstacleIsAlertedFirstAndNextAfterGap() {
        val analyzer = ObjectAnalyzer(config)
        val pole = groundBox(DetectedClass.POLE, 4.5, sector = 1)
        val low = groundBox(DetectedClass.OBSTACLE, 3.0, sector = 3)

        val results = (0 until 6).map { analyzer.analyze(walkFrame(it, pole, low)) }

        val alerted = results.map { result -> result.alerts.map { it.objectClass } }
        // 0.7초 간격 프레임이라 두 번째 프레임에 obstacleConfirmMs 를 채운다. 앞 알림 뒤 noticeGapMs(1.5초) 안의 프레임은 건너뛴다.
        assertEquals(
            listOf(emptyList(), listOf(DetectedClass.OBSTACLE), emptyList(), emptyList(), listOf(DetectedClass.POLE), emptyList()),
            alerted,
        )
    }

    @Test
    fun parkedCarCloserThanPoleIsAlertedFirst() {
        val analyzer = ObjectAnalyzer(config)

        // 약 0.6m/s 로 걷는다. 가까운 바닥 장애물을 알린 뒤 기다리는 동안, 서 있는 차(5.9m 에서 시작)와
        // 그보다 조금 먼 기둥(6.2m 에서 시작)이 함께 알릴 차례가 된다.
        val results = (0 until 8).map { index ->
            val walked = index * 0.42
            val car = boxAt(DetectedClass.CAR, config.carHeightM, 5.9 - walked)
            val pole = groundBox(DetectedClass.POLE, 6.2 - walked, sector = 3)
            val low = groundBox(DetectedClass.OBSTACLE, 3.0 - walked, sector = 1).takeIf { index <= 3 }
            walkFrame(index, *listOfNotNull(car, pole, low).toTypedArray())
        }.map(analyzer::analyze)

        val alerted = results.indices.filter { results[it].alerts.isNotEmpty() }
        assertEquals(listOf(1, 4, 7), alerted)
        assertEquals(DetectedClass.OBSTACLE, results[1].alerts.single().objectClass)
        val car = results[4].alerts.single()
        assertEquals(DetectedClass.CAR, car.objectClass)
        assertEquals(false, car.moving)
        assertEquals(DetectedClass.POLE, results[7].alerts.single().objectClass)
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
        val gap = repeat(emptyList(), lostFrames - 1)

        val results = run(ObjectAnalyzer(config), repeat(pole, confirmAt + 1) + gap + repeat(pole, confirmAt + 1))

        assertEquals(1, results.sumOf { it.alerts.size })
    }

    @Test
    fun obstacleTrackedAgainIsNotAlertedWithinRepeatTime() {
        // 추적이 끊길 만큼 안 보였다 다시 보인 같은 종류·방향 기둥은 stillRepeatMs 안에는 다시 알리지 않고, 지나면 알린다.
        val pole = listOf(box(DetectedClass.POLE))
        val lost = repeat(emptyList(), lostFrames + 1)
        val untilRepeat = repeat(emptyList(), (config.stillRepeatMs / 100).toInt())

        val results = run(
            ObjectAnalyzer(config),
            repeat(pole, confirmAt + 1) + lost + repeat(pole, confirmAt + gapFrames) + untilRepeat + repeat(pole, confirmAt + 1),
        )

        assertEquals(2, results.sumOf { it.alerts.size })
        assertEquals(1, results.last().alerts.size)
    }

    @Test
    fun eachClassAlertsOnItsOwn() {
        val both = listOf(box(DetectedClass.POLE, sector = 1), box(DetectedClass.STAIRS, sector = 3))

        // 한 번에 하나씩, 알림 간격(noticeGapMs)을 두고 각각 한 번 알린다.
        val results = run(ObjectAnalyzer(config), repeat(both, confirmAt + gapFrames + 1))

        val alerted = results.flatMap { result -> result.alerts.map { it.objectClass } }
        assertEquals(1, results[confirmAt].alerts.size)
        assertEquals(setOf(DetectedClass.POLE, DetectedClass.STAIRS), alerted.toSet())
        assertEquals(2, alerted.size)
    }

    @Test
    fun sameKindInAnotherDirectionIsAlertedToo() {
        // 2.5m 앞 왼쪽 끝 칸(10시)과 가운데(12시)의 기둥은 종류가 같아도 방향이 달라 각각 알린다.
        val poles = listOf(box(DetectedClass.POLE, sector = 0), box(DetectedClass.POLE, sector = 2))

        val results = run(ObjectAnalyzer(config), repeat(poles, confirmAt + gapFrames + 1))

        val directions = results.flatMap { result -> result.alerts.map { it.direction } }
        assertEquals(setOf(10, 12), directions.toSet())
        assertEquals(2, directions.size)
    }

    @Test
    fun standingStillDoesNotAlertObstaclesAndAlertsWhenWalkingAgain() {
        // 신호를 기다리며 standingConfirmMs 넘게 서 있는 동안 3m 앞 기둥·서 있는 차는 알리지 않는다. 걷기 시작하면 알린다.
        val pole = groundBox(DetectedClass.POLE, 3.0, sector = 1)
        val car = boxAt(DetectedClass.CAR, config.carHeightM, 4.0, sector = 3)
        val analyzer = ObjectAnalyzer(config)
        val start = standStill(analyzer)

        val standing = (0 until 30).map {
            analyzer.analyze(note8Frame(pole, car).copy(timeMs = start + it * 100L, walkSpeedMps = 0.0))
        }
        val walking = analyzer.analyze(note8Frame(pole, car).copy(timeMs = start + 3_000, walkSpeedMps = 1.0))

        assertTrue(standing.all { it.alerts.isEmpty() })
        assertEquals(listOf(DetectedClass.POLE), walking.alerts.map { it.objectClass })
        assertEquals(setOf(DetectedClass.POLE, DetectedClass.CAR), standing.last().seen.map { it.kind }.toSet())
    }

    @Test
    fun briefZeroSpeedStillAlertsObstacles() {
        // 천천히 걸을 때 GPS 속력이 standingConfirmMs 보다 짧게 0 으로 튀어도 장애물은 알린다.
        val pole = listOf(groundBox(DetectedClass.POLE, 3.0))
        val glitch = (config.standingConfirmMs / 100).toInt() - 1

        val results = runNote8(ObjectAnalyzer(config), repeat(pole, glitch), walkSpeedMps = 0.0)

        assertEquals(1, results.sumOf { it.alerts.size })
    }

    @Test
    fun nextPoleWithinRepeatTimeIsAlerted() {
        // 1.1m/s 로 걸으며 5m 간격으로 선 기둥 두 개를 지난다. 뒤 기둥은 앞 기둥을 알린 지 stillRepeatMs 안이어도 알린다.
        val analyzer = ObjectAnalyzer(config)
        val speed = 1.1
        val alerts = (0 until 60).sumOf { index ->
            val seconds = index / 10.0
            val first = 5.0 - speed * seconds
            val second = first + 5.0
            val boxes = listOf(first, second)
                .filter { it in 1.5..config.obstacleNearM }
                .map { groundBox(DetectedClass.POLE, it) }
            analyzer.analyze(note8Frame(*boxes.toTypedArray()).copy(timeMs = index * 100L, walkSpeedMps = speed)).alerts.size
        }

        assertEquals(2, alerts)
    }

    @Test
    fun samePoleSeenAgainWhileWalkingIsNotAlertedAgain() {
        // 걷는 동안 앞 기둥이 objectLostMs 넘게 가려졌다 그동안 걸은 만큼 가까워진 곳에 다시 보이면 같은 기둥이라 다시 알리지 않는다.
        val analyzer = ObjectAnalyzer(config)
        val speed = 1.1
        val hiddenFrom = confirmAt + 2
        val hiddenUntil = hiddenFrom + lostFrames + 2
        val alerts = (0 until hiddenUntil + confirmAt + 3).sumOf { index ->
            val distance = 5.0 - speed * index / 10.0
            val boxes = if (index in hiddenFrom until hiddenUntil) emptyArray() else arrayOf(groundBox(DetectedClass.POLE, distance))
            analyzer.analyze(note8Frame(*boxes).copy(timeMs = index * 100L, walkSpeedMps = speed)).alerts.size
        }

        assertEquals(1, alerts)
    }

    @Test
    fun approachingCarIsWarnedWhileStandingStill() {
        // 서 있어도 내 쪽으로 다가오는 차는 알린다.
        val analyzer = ObjectAnalyzer(config)
        val start = standStill(analyzer)

        val results = listOf(9.0, 6.5).mapIndexed { index, distance ->
            val car = boxAt(DetectedClass.CAR, config.carHeightM, distance)
            analyzer.analyze(walkFrame(index, car).copy(timeMs = start + index * 700L, walkSpeedMps = 0.0))
        }

        assertEquals(true, results[1].alerts.single().moving)
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
        // 걷는 길 위 vehicleImmediateM 안에서 처음 보인 서 있는 차. 한 프레임만 보고 "조심" 하지 않고, 서 있는 차로 알린다.
        val analyzer = ObjectAnalyzer(config)

        val results = (0 until 3).map { index ->
            analyzer.analyze(walkFrame(index, boxAt(DetectedClass.CAR, config.carHeightM, 6.0 - index * 0.84)))
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
        // 0.7초 간격 프레임으로 objectLostMs 보다 오래 안 보여 추적에서 빠진다.
        val gap = List((config.objectLostMs / 700 + 1).toInt()) { null }
        val boxes = approach + gap + approach + List(10) { null } + approach
        val analyzer = ObjectAnalyzer(config)

        val alertedAt = boxes.indices.filter { index ->
            analyzer.analyze(walkFrame(index, *listOfNotNull(boxes[index]).toTypedArray())).alerts.isNotEmpty()
        }

        assertEquals(listOf(1, boxes.lastIndex), alertedAt)
    }

    @Test
    fun seenListsNearObstaclesAheadEveryFrameWithoutConfirming() {
        val pole = box(DetectedClass.POLE, sector = 1)
        val car = box(DetectedClass.CAR, sector = 3)

        val results = run(ObjectAnalyzer(config), listOf(listOf(pole, car), emptyList(), listOf(pole)))

        assertEquals(
            listOf(
                ObstacleSighting(DetectedClass.CAR, CLOCK_SECTORS[3]),
                ObstacleSighting(DetectedClass.POLE, CLOCK_SECTORS[1]),
            ),
            results[0].seen,
        )
        assertTrue(results[0].alerts.none { it.objectClass == DetectedClass.POLE })
        assertTrue(results[1].seen.isEmpty())
        assertEquals(listOf(ObstacleSighting(DetectedClass.POLE, CLOCK_SECTORS[1])), results[2].seen)
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
        // results[1] 은 확인하지 않는다. vehicleMotionSpanMs 만큼 지켜보기 전에는 움직임을 몰라 아직 보이는 것이 의도된 동작이다.
        assertTrue(results[2].seen.isEmpty())
        assertTrue(results[3].seen.isEmpty())
    }

    /** 내 걸음 walkSpeedMps 로 걷는 동안 프레임마다 차 하나를 넣어 본 마지막 프레임의 결과 */
    private fun lastWhileWalking(walkSpeedMps: Double, distances: List<Double>): ObjectAnalysis {
        val analyzer = ObjectAnalyzer(config)
        return distances.mapIndexed { index, distance ->
            val frame = walkFrame(index, boxAt(DetectedClass.CAR, config.carHeightM, distance))
            analyzer.analyze(frame.copy(walkSpeedMps = walkSpeedMps))
        }.last()
    }

    @Test
    fun carKeepingPaceWithMeIsStillSeen() {
        // 내가 1.2m/s 로 따라 걷는 동안 앞 차도 같은 속도로 가 거리는 그대로다. 차는 멀어지지만 화면에서는 빼지 않는다.
        val result = lastWhileWalking(1.2, listOf(8.0, 8.0, 8.0, 8.0))

        assertEquals(VehicleMotion.LEAVING, result.vehicles.single().motion)
        assertEquals(listOf(DetectedClass.CAR), result.seen.map { it.kind })
    }

    @Test
    fun parkedCarIsStillSeenWhenGpsOverestimatesMyWalk() {
        // 서 있는 차로 1.2m/s 로 걸어 다가가는데 GPS 가 걸음을 2.0m/s 로 잡아 차가 -0.8m/s 로 멀어지는 것처럼 보인다.
        val result = lastWhileWalking(2.0, listOf(8.0, 7.16, 6.32, 5.48))

        assertEquals(VehicleMotion.LEAVING, result.vehicles.single().motion)
        assertEquals(listOf(DetectedClass.CAR), result.seen.map { it.kind })
    }

    @Test
    fun carLeavingWhileIWalkIsNotSeen() {
        // 내가 1.2m/s 로 걷는데 앞 차가 더 빨라 거리가 1.4m/s 로 늘어난다. 실제로 멀어지므로 화면에서 뺀다.
        val result = lastWhileWalking(1.2, listOf(6.0, 7.0, 8.0, 9.0))

        assertTrue(result.seen.isEmpty())
    }

    @Test
    fun leavingVehicleDoesNotHideOtherNearbyVehicle() {
        // 멀어지는 차 옆에 서 있는 다른 차는 박스 단위로 거르므로 계속 보인다. 종류(CAR) 단위로 거르면 이 테스트가 깨진다.
        val analyzer = ObjectAnalyzer(config)
        val results = listOf(6.0, 7.0, 8.0, 9.0).mapIndexed { index, distance ->
            analyzer.analyze(
                walkFrame(
                    index,
                    boxAt(DetectedClass.CAR, config.carHeightM, distance),
                    boxAt(DetectedClass.CAR, config.carHeightM, config.carNearM - 1, sector = 1),
                ),
            )
        }

        // 남은 차는 옆 칸(sector 1)에 서 있는 차다.
        assertEquals(listOf(ObstacleSighting(DetectedClass.CAR, CLOCK_SECTORS[1])), results.last().seen)
    }

    @Test
    fun parkedCarIsAlertedOnceAsStillWithinNearDistance() {
        val analyzer = ObjectAnalyzer(config)

        // 서 있는 차로 약 1.2m/s 로 걸어간다(0.7초 간격 프레임). 마지막은 약 2.1m 다.
        val results = (0 until 8).map { index ->
            analyzer.analyze(walkFrame(index, boxAt(DetectedClass.CAR, config.carHeightM, 8.0 - index * 0.84)))
        }

        val alert = results.flatMap { it.alerts }.single()
        assertEquals(AlertKind.OBSTACLE, alert.kind)
        assertEquals(false, alert.moving)
        assertTrue(alert.distanceM!! <= config.obstacleNearM)
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
    fun analysisCarriesTrackedSignal() {
        // 신호등 고르기·확정은 SignalTrackerTest 에서 본다. 여기서는 판단 결과에 실려 나오는지만 본다.
        val red = listOf(box(DetectedClass.PED_SIGNAL_RED, bottom = 0.3))

        val results = run(ObjectAnalyzer(config), repeat(red, 6))

        assertTrue(results[0].signalPicked)
        assertEquals(DetectedClass.PED_SIGNAL_RED, results[0].signalBox?.kind)
        assertNull(results[4].signal)
        assertEquals(SignalState.RED, results[5].signal)
        assertTrue(results.all { it.alerts.isEmpty() })
    }
}
