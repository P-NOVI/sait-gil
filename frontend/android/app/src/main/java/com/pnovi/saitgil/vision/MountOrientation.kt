package com.pnovi.saitgil.vision

// 폰이 목걸이에 위아래 거꾸로 걸렸는지 방향 센서 각도로 판단한다.
// 카메라 분석 방향은 화면 방향 기준이라, 폰을 거꾸로 걸어도 영상을 180° 돌리지 않는다. 이 판단으로 돌린다.
// Android 클래스를 쓰지 않아 JVM 단위 테스트를 할 수 있다.

import kotlin.math.min

class MountOrientation(private val config: MountConfig = MountConfig()) {
    /** 지금 위아래 거꾸로 걸린 것으로 보는지 */
    var upsideDown = false
        private set

    // 지금과 다른 방향이 끊기지 않고 보이기 시작한 시각. 다른 방향이 안 보이면 null
    private var otherSinceMs: Long? = null

    /**
     * 방향 센서 각도(0~359)를 받아 판단을 고친다. 판단이 바뀌었으면 true 다.
     * 폰이 누워 각도를 모르면(null) 또는 옆으로 기울어 판단할 수 없으면 지금 판단을 그대로 두고,
     * 새 방향을 세던 시간도 버린다. 새 방향이 끊기지 않고 flipHoldMs 동안 이어져야 바꾼다.
     */
    fun update(degrees: Int?, nowMs: Long): Boolean {
        val seen = classify(degrees)
        if (seen == null || seen == upsideDown) {
            otherSinceMs = null
            return false
        }
        val since = otherSinceMs ?: nowMs.also { otherSinceMs = it }
        if (nowMs - since < config.flipHoldMs) return false
        upsideDown = seen
        otherSinceMs = null
        return true
    }

    /** 거꾸로면 true, 바로면 false, 판단할 수 없으면 null */
    private fun classify(degrees: Int?): Boolean? {
        if (degrees == null || degrees < 0) return null
        val normalized = degrees % FULL_TURN
        val fromUpright = min(normalized, FULL_TURN - normalized)
        return when {
            fromUpright <= config.maxTiltDeg -> false
            fromUpright >= HALF_TURN - config.maxTiltDeg -> true
            else -> null
        }
    }

    private companion object {
        const val FULL_TURN = 360
        const val HALF_TURN = 180
    }
}
