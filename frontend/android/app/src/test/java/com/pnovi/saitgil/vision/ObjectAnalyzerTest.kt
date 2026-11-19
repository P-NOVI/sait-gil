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

        assertEquals(labels[sectorOf(wide.centerX)], results[2].alerts.single().direction)
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

        val classes = results[2].alerts.map { it.objectClass }.toSet()
        assertEquals(setOf(DetectedClass.POLE, DetectedClass.CAR), classes)
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
    fun redWinsWhenBothSignalsAreSeen() {
        val both = listOf(
            box(DetectedClass.PED_SIGNAL_OTHER, sector = 1, bottom = 0.3),
            box(DetectedClass.PED_SIGNAL_RED, sector = 3, bottom = 0.3),
        )

        val results = run(ObjectAnalyzer(config), repeat(both, 3))

        assertEquals(SignalState.RED, results[2].signal)
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
