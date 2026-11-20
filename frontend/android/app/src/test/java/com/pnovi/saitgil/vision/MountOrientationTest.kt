package com.pnovi.saitgil.vision

import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

// 방향 센서 각도만으로 폰이 거꾸로 걸렸는지 판단하는 로직을 확인한다.
class MountOrientationTest {
    private val config = MountConfig()

    /** 100ms 간격으로 각도를 넣고, 판단이 바뀐 결과들을 돌려준다 */
    private fun MountOrientation.feed(degrees: List<Int?>, startMs: Long = 0): List<Boolean> =
        degrees.mapIndexed { index, it -> update(it, startMs + index * 100L) }

    @Test
    fun startsUpright() {
        val mount = MountOrientation(config)

        assertFalse(mount.feed(List(20) { 0 }).any { it })
        assertFalse(mount.upsideDown)
    }

    @Test
    fun flipsAfterUpsideDownHoldsLongEnough() {
        val mount = MountOrientation(config)

        // 0ms 에 처음 보이고 1000ms 가 지난 11번째(1000ms)에 바꾼다.
        val changes = mount.feed(List(12) { 180 })

        assertFalse(changes.take(10).any { it })
        assertTrue(changes[10])
        assertTrue(mount.upsideDown)
    }

    @Test
    fun briefSwingDoesNotFlip() {
        val mount = MountOrientation(config)

        mount.feed(List(5) { 170 } + 0 + List(5) { 190 })

        assertFalse(mount.upsideDown)
    }

    @Test
    fun anglesNearUpsideDownCountOnBothSides() {
        val mount = MountOrientation(config)

        mount.feed(List(6) { 140 } + List(6) { 220 })

        assertTrue(mount.upsideDown)
    }

    @Test
    fun sidewaysOrFlatKeepsCurrentState() {
        val mount = MountOrientation(config)
        mount.feed(List(11) { 180 })

        val changes = mount.feed(List(20) { if (it % 2 == 0) 90 else null }, startMs = 2_000)

        assertFalse(changes.any { it })
        assertTrue(mount.upsideDown)
    }

    @Test
    fun turnsBackUprightAfterHold() {
        val mount = MountOrientation(config)
        mount.feed(List(11) { 180 })

        mount.feed(List(11) { 350 }, startMs = 2_000)

        assertFalse(mount.upsideDown)
    }
}
