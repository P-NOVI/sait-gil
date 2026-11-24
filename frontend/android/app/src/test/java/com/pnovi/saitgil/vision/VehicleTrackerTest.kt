package com.pnovi.saitgil.vision

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

// 모델 없이 가짜 차 박스로 차 추적·움직임 판단을 확인한다. Android 클래스는 쓰지 않는다.
class VehicleTrackerTest {
    private val config = VisionConfig()

    // 목걸이로 세워 건 노트8 후면 카메라 영상(세운 화면 기준)
    private val widthPx = 480
    private val heightPx = 640
    private val focalPx = 4.3 / 5.645 * heightPx

    // 실기기 추론 간격(약 0.7초)
    private val stepMs = 700L

    /** 실제 거리 distanceM, 옆 위치 lateralM(오른쪽 +)에 있는 차의 박스. 아래 끝은 0.6 에 둔다 */
    private fun car(distanceM: Double, lateralM: Double = 0.0, kind: DetectedClass = DetectedClass.CAR): ObjectBox {
        val heightM = if (kind == DetectedClass.CAR) config.carHeightM else config.twoWheelerHeightM
        val height = focalPx * heightM / distanceM / heightPx
        val width = focalPx * CAR_WIDTH_M / distanceM / widthPx
        val centerX = 0.5 + lateralM * focalPx / distanceM / widthPx
        return ObjectBox(kind, centerX - width / 2, 0.6 - height, width, height, score = 0.9)
    }

    private fun frame(index: Int, vararg objects: ObjectBox) =
        DetectionFrame(index * stepMs, emptyList(), widthPx, heightPx, focalLengthPx = focalPx, objects = objects.toList())

    /** 프레임마다 차 하나씩 넣어 판단한 알림들 */
    private fun run(cars: List<ObjectBox>): List<List<VehicleAlert>> {
        val tracker = VehicleTracker(config)
        return cars.mapIndexed { index, box ->
            val frame = frame(index, box)
            tracker.analyze(frame, clockLabels(frame, config)).alerts
        }
    }

    @Test
    fun approachingCarOnThePathIsWarnedOnceAsMoving() {
        // 약 4.3m/s 로 다가오는 차. 세 프레임째에 다가온다고 판단한다.
        val alerts = run(listOf(14.0, 11.0, 8.0, 6.0).map { car(it) })

        assertTrue(alerts[0].isEmpty())
        assertTrue(alerts[1].isEmpty())
        val warning = alerts[2].single()
        assertEquals(8.0, warning.distanceM!!, 0.01)
        assertEquals(12, warning.direction)
        assertTrue(alerts[3].isEmpty())
    }

    @Test
    fun carIsJudgedByTimeWatchedNotFrameCount() {
        // int8 처럼 100ms 간격으로 프레임이 많이 와도 vehicleMotionSpanMs 를 지켜보기 전에는 서 있는지 판단하지 않는다.
        val tracker = VehicleTracker(config)
        val motions = (0..12).map { index ->
            val frame = DetectionFrame(
                index * 100L,
                emptyList(),
                widthPx,
                heightPx,
                focalLengthPx = focalPx,
                objects = listOf(car(4.0 - index * 0.12)),
            )
            tracker.analyze(frame, clockLabels(frame, config)).states.single().motion
        }

        val judgedAt = (config.vehicleMotionSpanMs / 100).toInt()
        assertTrue(motions.take(judgedAt).all { it == VehicleMotion.UNKNOWN })
        assertEquals(VehicleMotion.STILL, motions[judgedAt])
    }

    @Test
    fun fastApproachingCarIsWarnedAfterTwoFrames() {
        val alerts = run(listOf(15.0, 10.0).map { car(it) })

        assertTrue(alerts[0].isEmpty())
        assertEquals(1, alerts[1].size)
    }

    @Test
    fun parkedCarIsNoticedOnceWhenNearButNeverWarned() {
        // 서 있는 차로 약 1.2m/s 로 걸어간다. 후보로 나오면 바로 알렸다고 적는다.
        val distances = (0 until 13).map { 15.0 - it * 0.84 }
        val tracker = VehicleTracker(config)

        val analyses = distances.mapIndexed { index, distance ->
            val frame = frame(index, car(distance))
            tracker.analyze(frame, clockLabels(frame, config)).also { it.notices.forEach(StillNotice::notified) }
        }

        val noticed = analyses.indices.filter { analyses[it].notices.isNotEmpty() }
        assertEquals(listOf(distances.indexOfFirst { it <= config.obstacleNearM }), noticed)
        assertTrue(analyses.all { it.alerts.isEmpty() })
    }

    @Test
    fun parkedCarStaysCandidateUntilNotified() {
        // 다른 장애물이 더 가까워 고르지 않은 서 있는 차는 다음 프레임에도 후보다.
        val tracker = VehicleTracker(config)

        // obstacleNearM 밖에서 시작해 네 번째 프레임에 들어온다.
        val analyses = (0 until 7).map { index ->
            val frame = frame(index, car(7.0 - index * 0.84))
            tracker.analyze(frame, clockLabels(frame, config))
        }

        assertTrue(analyses.take(3).all { it.notices.isEmpty() })
        assertTrue(analyses.drop(3).all { it.notices.size == 1 })
    }

    @Test
    fun oncomingCarBesideThePathIsNotWarned() {
        // 옆 차로(2.5m 옆)에서 마주 오는 차
        val alerts = run(listOf(14.0, 11.0, 8.0).map { car(it, lateralM = 2.5) })

        assertTrue(alerts.all { it.isEmpty() })
    }

    @Test
    fun carCrossingIntoThePathIsWarned() {
        // 10m 앞에서 왼쪽 4m 에서 길 쪽으로 약 2.1m/s 로 들어오는 차
        val alerts = run(listOf(-4.0, -2.5, -1.0).map { car(10.0, lateralM = it) })

        assertTrue(alerts[0].isEmpty())
        assertTrue(alerts[1].isEmpty())
        assertEquals(1, alerts[2].size)
    }

    @Test
    fun bodyTurnWithParkedCarBesideThePathIsNotWarned() {
        // 몸을 돌려 8m 앞 왼쪽 주차된 차가 화면에서 길 쪽으로 약 1.4m/s 움직인 것처럼 보인다. 걷는 길 밖이라 알리지 않는다.
        val alerts = run(listOf(-4.5, -3.5, -2.5).map { car(8.0, lateralM = it) })

        assertTrue(alerts.all { it.isEmpty() })
    }

    @Test
    fun leavingCarIsNotWarned() {
        val alerts = run(listOf(11.0, 14.0, 17.0).map { car(it) })

        assertTrue(alerts.all { it.isEmpty() })
    }

    @Test
    fun slowlyLeavingCarIsNotNoticedAsParked() {
        // 약 1.4m/s 로 천천히 멀어지는 2m 앞 차. 서 있는 차로 보고 알리면 안 된다.
        val states = VehicleTracker(config).let { tracker ->
            listOf(2.0, 3.0, 4.0, 5.0).mapIndexed { index, distance ->
                val frame = frame(index, car(distance))
                tracker.analyze(frame, clockLabels(frame, config))
            }
        }

        assertEquals(VehicleMotion.LEAVING, states[2].states.single().motion)
        assertTrue(states.all { it.alerts.isEmpty() && it.notices.isEmpty() })
    }

    @Test
    fun carLeavingSlowerThanThresholdIsStillNoticed() {
        // 약 0.3m/s 로 멀어지는 4m 앞 차는 멀어진다고 보지 않고 서 있는 차로 알린다.
        val states = VehicleTracker(config).let { tracker ->
            listOf(4.0, 4.2, 4.4, 4.6).mapIndexed { index, distance ->
                val frame = frame(index, car(distance))
                tracker.analyze(frame, clockLabels(frame, config))
            }
        }

        assertEquals(VehicleMotion.STILL, states[2].states.single().motion)
        assertTrue(states[2].alerts.isEmpty())
        assertEquals(DetectedClass.CAR, states[2].notices.single().kind)
    }

    /** 내가 walkSpeedMps 로 걷는 동안 프레임마다 차 하나씩 넣어 본 움직임 */
    private fun motionsWhileWalking(walkSpeedMps: Double?, distances: List<Double>): List<VehicleMotion> {
        val tracker = VehicleTracker(config)
        return distances.mapIndexed { index, distance ->
            val frame = frame(index, car(distance)).copy(walkSpeedMps = walkSpeedMps)
            tracker.analyze(frame, clockLabels(frame, config)).states.single().motion
        }
    }

    @Test
    fun carLeavingSlowerThanMyWalkIsStillLeaving() {
        // 내가 1.2m/s 로 걷는 동안 앞 차가 약 1.5m/s 로 멀어져 거리는 0.3m/s 만 늘어난다.
        val motions = motionsWhileWalking(1.2, listOf(6.0, 6.2, 6.4, 6.6))

        assertEquals(VehicleMotion.LEAVING, motions[2])
    }

    @Test
    fun walkingTowardParkedCarIsNotApproaching() {
        // 내가 1.2m/s 로 걸어 서 있는 차에 다가가 거리가 1.2m/s 로 줄어도 차는 서 있다.
        val motions = motionsWhileWalking(1.2, listOf(8.0, 7.2, 6.4, 5.6))

        assertEquals(VehicleMotion.STILL, motions[2])
    }

    @Test
    fun slowlyApproachingCarIsNotMissedWhileWalking() {
        // 내가 1.2m/s 로 걷는 동안 차가 약 2.4m/s 로 다가와 거리는 3.6m/s 로 줄어든다. 걸음을 빼도 다가오는 차로 본다.
        val motions = motionsWhileWalking(1.2, listOf(14.0, 11.5, 9.0, 6.5))

        assertEquals(VehicleMotion.APPROACHING, motions[2])
    }

    @Test
    fun walkingTowardParkedCarWithUnknownWalkSpeedIsNotApproaching() {
        // 걸음 속도를 모르면(null) 걸음을 못 빼 걸음 1.2m/s 에 박스 크기 흔들림이 더해져 거리가 2.0m/s 로 줄어도
        // 예전 기준(3.0)으로 본다. 걸음을 안 뺀 채 1.8 을 쓰면 서 있는 차가 다가오는 차로 잡힌다.
        val motions = motionsWhileWalking(null, listOf(8.0, 6.6, 5.2, 3.8))

        assertEquals(VehicleMotion.STILL, motions[2])
    }

    @Test
    fun carApproachingFasterThanThresholdIsApproachingWithUnknownWalkSpeed() {
        // 걸음 속도를 몰라도 거리가 3.6m/s 로 줄면 다가오는 차로 본다.
        val motions = motionsWhileWalking(null, listOf(14.0, 11.5, 9.0, 6.5))

        assertEquals(VehicleMotion.APPROACHING, motions[2])
    }

    @Test
    fun slowlyApproachingCarIsApproachingWhenIAmStopped() {
        // 멈춰 있음(0)은 아는 값이라 1.8 기준을 쓴다. 거리가 2.4m/s 로 줄면 다가오는 차다.
        val motions = motionsWhileWalking(0.0, listOf(14.0, 12.3, 10.6, 8.9))

        assertEquals(VehicleMotion.APPROACHING, motions[2])
    }

    @Test
    fun walkSpeedIsSubtractedFromReportedApproach() {
        val tracker = VehicleTracker(config)
        val states = listOf(14.0, 11.0, 8.0).mapIndexed { index, distance ->
            val frame = frame(index, car(distance)).copy(walkSpeedMps = 1.0)
            tracker.analyze(frame, clockLabels(frame, config)).states.single()
        }

        // 거리가 약 4.29m/s 로 줄고 내 걸음 1m/s 를 빼면 차는 약 3.29m/s 로 다가온다.
        assertEquals(3.0 / 0.7 - 1.0, states[2].approachMps!!, 0.01)
    }

    @Test
    fun twoWheelerUsesItsOwnNearDistance() {
        // 이륜차는 twoWheelerNearM(15m) 안에서만 알린다. 약 4.3m/s 로 다가와 세 프레임째 거리 16m 는 아직 멀다.
        val far = run(listOf(22.0, 19.0, 16.0).map { car(it, kind = DetectedClass.TWO_WHEELER) })
        val near = run(listOf(14.0, 11.0, 8.0).map { car(it, kind = DetectedClass.TWO_WHEELER) })

        assertTrue(far.all { it.isEmpty() })
        assertEquals(DetectedClass.TWO_WHEELER, near[2].single().kind)
    }

    @Test
    fun statesReportDistanceLateralAndMotion() {
        val tracker = VehicleTracker(config)
        val cars = listOf(14.0, 11.0, 8.0).map { car(it, lateralM = 0.5) }

        val states = cars.mapIndexed { index, box ->
            val frame = frame(index, box)
            tracker.analyze(frame, clockLabels(frame, config)).states.single()
        }

        assertEquals(VehicleMotion.UNKNOWN, states[0].motion)
        assertEquals(VehicleMotion.APPROACHING, states[2].motion)
        assertEquals(8.0, states[2].distanceM!!, 0.01)
        assertEquals(0.5, states[2].lateralM!!, 0.01)
        assertEquals(states[0].id, states[2].id)
    }

    private companion object {
        // 박스 폭을 정할 때 쓰는 차 폭(m)
        const val CAR_WIDTH_M = 1.8
    }
}
