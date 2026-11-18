package com.pnovi.saitgil.vision

import com.getcapacitor.JSArray
import com.getcapacitor.JSObject
import org.json.JSONObject

// 화면(frontend/src/platform/vision.ts)과 주고받는 값. 문자열(wire)은 화면 쪽 타입과 같아야 한다.

/** 인식 모드. crowd 가 기본이다. */
enum class VisionMode(val wire: String) {
    CROWD("crowd"),
    SIGNAL("signal"),
    GATE("gate");

    companion object {
        fun fromWire(value: String?): VisionMode? = entries.firstOrNull { it.wire == value }
    }
}

/** 인파 알림 민감도. 화면의 접근성 설정(CrowdSensitivity)과 같다. */
enum class CrowdSensitivity(val wire: String) {
    LOW("low"),
    NORMAL("normal"),
    HIGH("high");

    companion object {
        fun fromWire(value: String?): CrowdSensitivity? = entries.firstOrNull { it.wire == value }
    }
}

/** 인파 단계. UNKNOWN 은 카메라 가림·신뢰도 부족처럼 판단할 수 없는 상태다. */
enum class CrowdLevel(val wire: String) {
    CLEAR("clear"),
    CAUTION("caution"),
    CROWDED("crowded"),
    DANGER("danger"),
    UNKNOWN("unknown"),
}

/** crowdState 이벤트 한 건 */
data class CrowdFrame(
    val level: CrowdLevel,
    /** 앞쪽에서 가장 가까운 사람까지 거리(m). 사람이 없으면 null */
    val nearestPersonM: Double?,
    /** 지나갈 만한 빈 방향(시계 방향 10~2시). 넓은 순 */
    val freeDirections: List<Int>,
) {
    fun toJs(): JSObject = JSObject().apply {
        put("level", level.wire)
        // put(key, null) 은 키를 지워 버리므로 null 은 JSONObject.NULL 로 보낸다.
        put("nearestPersonM", nearestPersonM ?: JSONObject.NULL)
        put("freeDirections", JSArray().apply { freeDirections.forEach { put(it) } })
    }
}

enum class AlertKind(val wire: String) {
    DANGER("danger"),
    SIGNAL("signal"),
    GATE("gate"),
}

/**
 * 바로 알려야 하는 일(정면 접근, 신호등 변화, 개찰구 위치). 음성·진동은 화면의 알림 중재가 정한다.
 * 정면 접근은 화면이 읽을 문장을 만들도록 거리와 빈 방향을 함께 보낸다.
 */
data class VisionAlert(
    val kind: AlertKind,
    val message: String,
    /** 알릴 대상까지 거리(m). 없으면 null */
    val distanceM: Double? = null,
    /** 지나갈 만한 빈 방향(시계 방향 10~2시). 넓은 순 */
    val freeDirections: List<Int> = emptyList(),
) {
    fun toJs(): JSObject = JSObject().apply {
        put("kind", kind.wire)
        put("message", message)
        put("distanceM", distanceM ?: JSONObject.NULL)
        put("freeDirections", JSArray().apply { freeDirections.forEach { put(it) } })
    }
}
