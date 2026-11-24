package com.pnovi.saitgil.vision

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

// 가짜 신호등 박스로 신호등 고르기·따라가기·상태 확정을 확인한다(#132).
class SignalTrackerTest {
    private val config = VisionConfig()

    private val red = DetectedClass.PED_SIGNAL_RED
    private val other = DetectedClass.PED_SIGNAL_OTHER

    /** 가운데가 centerX 인 신호등 박스. 빨간불은 위 칸, 나머지는 아래 칸이 켜져 박스 위치가 다르다 */
    private fun signal(kind: DetectedClass, centerX: Double = 0.5): ObjectBox {
        val top = if (kind == red) 0.20 else 0.23
        return ObjectBox(kind, centerX - 0.015, top, 0.03, 0.03, score = 0.7)
    }

    private fun frame(timeMs: Long, vararg objects: ObjectBox) =
        DetectionFrame(timeMs, emptyList(), 480, 640, objects = objects.toList())

    /** fromMs 부터 toMs 까지 stepMs 간격 프레임마다 같은 박스를 넣고 마지막 결과를 돌려준다 */
    private fun SignalTracker.feed(fromMs: Long, toMs: Long, vararg objects: ObjectBox, stepMs: Long = 100): SignalReading {
        var last: SignalReading? = null
        for (timeMs in fromMs..toMs step stepMs) last = update(frame(timeMs, *objects))
        return last!!
    }

    @Test
    fun redConfirmsAfterRedConfirmTime() {
        val tracker = SignalTracker(config)

        assertNull(tracker.feed(0, 400, signal(red)).state)
        assertEquals(SignalState.RED, tracker.update(frame(500, signal(red))).state)
    }

    @Test
    fun otherNeedsLongerThanRed() {
        val tracker = SignalTracker(config)

        assertNull(tracker.feed(0, 2_900, signal(other)).state)
        assertEquals(SignalState.OTHER, tracker.update(frame(3_000, signal(other))).state)
    }

    @Test
    fun shortOtherDuringRedKeepsRed() {
        // 11/24 실기기처럼 빨간불이 1.2초 다르게 보였다 돌아오면 바뀌었다고 하지 않는다.
        val tracker = SignalTracker(config)
        tracker.feed(0, 1_000, signal(red))

        val during = (1_100L..2_300L step 100).map { tracker.update(frame(it, signal(other))) }
        val after = tracker.feed(2_400, 4_000, signal(red))

        assertTrue(during.all { it.state == SignalState.RED })
        assertEquals(SignalState.RED, after.state)
    }

    @Test
    fun steadyOtherAfterRedChanges() {
        val tracker = SignalTracker(config)
        tracker.feed(0, 1_000, signal(red))

        assertEquals(SignalState.RED, tracker.feed(1_100, 4_000, signal(other)).state)
        assertEquals(SignalState.OTHER, tracker.update(frame(4_100, signal(other))).state)
    }

    @Test
    fun briefMissesKeepCounting() {
        // 두 프레임에 한 번 못 잡아도 처음 본 때부터 센다.
        val tracker = SignalTracker(config)
        val results = (0L..3_000L step 100).map { timeMs ->
            if (timeMs % 200 == 0L) tracker.update(frame(timeMs, signal(other))) else tracker.update(frame(timeMs))
        }

        assertNull(results[29].state)
        assertEquals(SignalState.OTHER, results[30].state)
    }

    @Test
    fun longMissClearsState() {
        val tracker = SignalTracker(config)
        tracker.feed(0, 600, signal(red))

        assertEquals(SignalState.RED, tracker.feed(700, 1_600).state)
        assertNull(tracker.update(frame(1_700)).state)
    }

    @Test
    fun missAfterRedDoesNotShortenOtherTime() {
        // 빨간불 → 안 보임 → 빨간불 아님이어도 빨간불 아님은 끝까지 기다린다.
        val tracker = SignalTracker(config)
        tracker.feed(0, 600, signal(red))
        tracker.feed(700, 2_000)

        assertNull(tracker.feed(2_100, 5_000, signal(other)).state)
        assertEquals(SignalState.OTHER, tracker.update(frame(5_100, signal(other))).state)
    }

    @Test
    fun lightChangeKeepsSameSignal() {
        // 불이 바뀌어 켜진 칸이 달라져도 같은 신호등이다.
        val tracker = SignalTracker(config)
        val first = tracker.update(frame(0, signal(red)))
        val changed = tracker.update(frame(100, signal(other)))

        assertTrue(first.picked)
        assertFalse(changed.picked)
        assertEquals(other, changed.box?.kind)
    }

    @Test
    fun doesNotJumpToNeighborSignalWhileTrackedOneIsBriefMissed() {
        // 따라가던 빨간불을 잠깐 못 잡을 때 옆의 다른 신호등으로 넘어가지 않는다.
        val tracker = SignalTracker(config)
        tracker.feed(0, 600, signal(red))

        val missed = tracker.feed(700, 1_600, signal(other, centerX = 0.65))

        assertNull(missed.box)
        assertEquals(SignalState.RED, missed.state)
    }

    @Test
    fun picksAnotherSignalAfterTrackedOneIsLost() {
        val tracker = SignalTracker(config)
        tracker.feed(0, 600, signal(red))
        tracker.feed(700, 1_600, signal(other, centerX = 0.65))

        val repicked = tracker.update(frame(1_700, signal(other, centerX = 0.65)))

        assertTrue(repicked.picked)
        assertEquals(0.65, repicked.box!!.centerX, 1e-9)
    }

    @Test
    fun picksSignalNearestToCenter() {
        // 크기가 아니라 가운데에 가까운 신호등(건너편)을 고른다.
        val tracker = SignalTracker(config)
        val nearSide = ObjectBox(red, 0.30, 0.1, 0.1, 0.1, score = 0.9)

        val reading = tracker.update(frame(0, nearSide, signal(other, centerX = 0.52)))

        assertEquals(other, reading.box?.kind)
    }

    @Test
    fun redWinsWhenSignalsAreEquallyCentered() {
        // 가운데(0.375, 0.625)를 소수점 오차 없이 같은 거리에 둔다.
        val tracker = SignalTracker(config)
        val left = ObjectBox(other, 0.25, 0.2, 0.25, 0.25, score = 0.7)
        val right = ObjectBox(red, 0.5, 0.2, 0.25, 0.25, score = 0.7)

        val reading = tracker.update(frame(0, left, right))

        assertEquals(red, reading.box?.kind)
    }

    @Test
    fun ignoresSignalsOutsideAheadWidth() {
        // 옆 방향 횡단보도 신호등은 보지 않는다.
        val tracker = SignalTracker(config)

        val reading = tracker.feed(0, 600, signal(red, centerX = 0.1), signal(red, centerX = 0.9))

        assertNull(reading.box)
        assertNull(reading.state)
    }

    @Test
    fun newlyPickedSignalStartsOverWithoutEarlierStateOrTime() {
        // 따라가던 빨간불이 한 프레임 다르게 보인 뒤 버스에 가려 놓치고, 가운데 가까운 다른 신호등(초록)을 골랐다.
        // 앞 신호등의 빨간불과 잘못 본 시각을 이어 가지 않고, 새 신호등을 고른 때부터 다시 센다.
        val tracker = SignalTracker(config)
        val first = tracker.feed(0, 600, signal(red))
        tracker.update(frame(700, signal(other)))
        tracker.feed(800, 1_700)

        val repicked = tracker.update(frame(1_800, signal(other, centerX = 0.62)))
        val waiting = tracker.feed(1_900, 4_700, signal(other, centerX = 0.62))
        val confirmed = tracker.update(frame(4_800, signal(other, centerX = 0.62)))

        assertTrue(repicked.picked)
        assertNull(repicked.state)
        assertEquals(first.id + 1, repicked.id)
        assertNull(waiting.state)
        assertEquals(SignalState.OTHER, confirmed.state)
        assertEquals(repicked.id, confirmed.id)
    }

    @Test
    fun signalIdStaysWhileFollowingSameSignal() {
        // 불이 바뀌거나 잠깐 못 잡아도 같은 신호등이면 번호가 그대로다. 그래야 화면이 바뀐 것을 알린다.
        val tracker = SignalTracker(config)
        val first = tracker.feed(0, 600, signal(red))
        tracker.feed(700, 1_200)
        val changed = tracker.feed(1_300, 4_300, signal(other))

        assertEquals(SignalState.OTHER, changed.state)
        assertEquals(first.id, changed.id)
    }
}
