package com.pnovi.saitgil.vision

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
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
        assertTrue(warning.moving)
        assertEquals(8.0, warning.distanceM!!, 0.01)
        assertEquals(12, warning.direction)
        assertTrue(alerts[3].isEmpty())
    }

    @Test
    fun fastApproachingCarIsWarnedAfterTwoFrames() {
        val alerts = run(listOf(15.0, 10.0).map { car(it) })

        assertTrue(alerts[0].isEmpty())
        assertTrue(alerts[1].single().moving)
    }

    @Test
    fun parkedCarIsNoticedOnceWhenCloseAndNeverWarned() {
        // 서 있는 차로 약 1.2m/s 로 걸어간다.
        val distances = (0 until 13).map { 15.0 - it * 0.84 }

        val alerts = run(distances.map { car(it) })

        val alerted = alerts.indices.filter { alerts[it].isNotEmpty() }
        assertEquals(listOf(distances.indexOfFirst { it <= config.vehicleStillNearM }), alerted)
        assertFalse(alerts[alerted.single()].single().moving)
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
        assertTrue(alerts[2].single().moving)
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
        // 약 1.4m/s 로 천천히 멀어지는 6m 앞 차. 서 있는 차로 보고 알리면 안 된다.
        val states = VehicleTracker(config).let { tracker ->
            listOf(6.0, 7.0, 8.0, 9.0).mapIndexed { index, distance ->
                val frame = frame(index, car(distance))
                tracker.analyze(frame, clockLabels(frame, config))
            }
        }

        assertEquals(VehicleMotion.LEAVING, states[2].states.single().motion)
        assertTrue(states.all { it.alerts.isEmpty() })
    }

    @Test
    fun carLeavingSlowerThanThresholdIsStillNoticed() {
        // 약 0.3m/s 로 멀어지는 6m 앞 차는 멀어진다고 보지 않고 서 있는 차로 알린다.
        val states = VehicleTracker(config).let { tracker ->
            listOf(6.0, 6.2, 6.4, 6.6).mapIndexed { index, distance ->
                val frame = frame(index, car(distance))
                tracker.analyze(frame, clockLabels(frame, config))
            }
        }

        assertEquals(VehicleMotion.STILL, states[2].states.single().motion)
        assertFalse(states[2].alerts.single().moving)
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
