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
    fun unknownAngleRestartsHold() {
        val mount = MountOrientation(config)
        // 0ms 에 거꾸로가 한 번 보이고, 2000ms 까지 각도를 모른다.
        mount.feed(listOf(180) + List(20) { null })

        // 2100ms 부터 다시 거꾸로. 처음 본 0ms 가 아니라 2100ms 부터 1초를 센다.
        val changes = mount.feed(List(11) { 180 }, startMs = 2_100)

        assertFalse(changes.take(10).any { it })
        assertTrue(changes[10])
    }

    @Test
    fun sidewaysRestartsHold() {
        val mount = MountOrientation(config)

        // 거꾸로 0~400ms, 옆으로 500~900ms, 다시 거꾸로 1000~1500ms. 이어진 거꾸로는 500ms 뿐이다.
        mount.feed(List(5) { 180 } + List(5) { 90 } + List(6) { 180 })

        assertFalse(mount.upsideDown)
    }

    @Test
    fun turnsBackUprightAfterHold() {
        val mount = MountOrientation(config)
        mount.feed(List(11) { 180 })

        mount.feed(List(11) { 350 }, startMs = 2_000)

        assertFalse(mount.upsideDown)
    }
}
