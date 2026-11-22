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

/**
 * 모델(YOLO26n, 데이터셋 g8v2)이 찾는 클래스. 순서는 학습 노트북의 CLASSES 순서(모델 출력 번호)와 같아야 한다.
 * person 은 CrowdAnalyzer 가, 나머지는 ObjectAnalyzer 가 판단한다.
 */
enum class DetectedClass(val wire: String) {
    PERSON("person"),
    TWO_WHEELER("two_wheeler"),
    CAR("car"),
    OBSTACLE("obstacle"),
    POLE("pole"),
    STAIRS("stairs"),
    PED_SIGNAL_RED("ped_signal_red"),
    PED_SIGNAL_OTHER("ped_signal_other"),
}

/** 보행 신호등 상태. OTHER 는 빨간불이 아닌 신호등(초록·깜빡임·꺼짐)이다 */
enum class SignalState(val wire: String) {
    RED("red"),
    OTHER("other"),
}

/** crowdState 이벤트 한 건 */
data class CrowdFrame(
    val level: CrowdLevel,
    /** 앞쪽에서 가장 가까운 사람까지 거리(m). 사람이 없으면 null */
    val nearestPersonM: Double?,
    /** 지나갈 만한 빈 방향(시계 방향 10~2시). 넓은 순 */
    val freeDirections: List<Int>,
    /** 몇 프레임 연달아 같았던 보행 신호등 상태. 신호등이 안 보이면 null */
    val signal: SignalState? = null,
    /** 이번 프레임에 앞쪽 가까이 보인 장애물. 여러 프레임 확인을 거치지 않는다 */
    val obstacles: List<ObstacleSighting> = emptyList(),
) {
    fun toJs(): JSObject = JSObject().apply {
        put("level", level.wire)
        // put(key, null) 은 키를 지워 버리므로 null 은 JSONObject.NULL 로 보낸다.
        put("nearestPersonM", nearestPersonM ?: JSONObject.NULL)
        put("freeDirections", JSArray().apply { freeDirections.forEach { put(it) } })
        put("signal", signal?.wire ?: JSONObject.NULL)
        put(
            "obstacles",
            JSArray().apply {
                obstacles.forEach { put(JSObject().put("kind", it.kind.wire).put("direction", it.direction)) }
            },
        )
    }
}

enum class AlertKind(val wire: String) {
    DANGER("danger"),
    OBSTACLE("obstacle"),
    SIGNAL("signal"),
    GATE("gate"),
}

/**
 * 바로 알려야 하는 일(정면 접근, 가까운 장애물, 신호등 변화, 개찰구 위치). 음성·진동은 화면의 알림 중재가 정한다.
 * 정면 접근은 화면이 읽을 문장을 만들도록 거리와 빈 방향을, 장애물은 클래스와 방향을 함께 보낸다.
 */
data class VisionAlert(
    val kind: AlertKind,
    val message: String,
    /** 알릴 대상까지 거리(m). 없으면 null */
    val distanceM: Double? = null,
    /** 지나갈 만한 빈 방향(시계 방향 10~2시). 넓은 순 */
    val freeDirections: List<Int> = emptyList(),
    /** 장애물 클래스. 장애물 알림이 아니면 null */
    val objectClass: DetectedClass? = null,
    /** 장애물이 있는 시계 방향(10~2시). 장애물 알림이 아니면 null */
    val direction: Int? = null,
    /** 차·이륜차가 움직여 조심하라고 알리는지. false 는 서 있는 차, 차·이륜차가 아니면 null */
    val moving: Boolean? = null,
) {
    fun toJs(): JSObject = JSObject().apply {
        put("kind", kind.wire)
        put("message", message)
        put("distanceM", distanceM ?: JSONObject.NULL)
        put("freeDirections", JSArray().apply { freeDirections.forEach { put(it) } })
        put("objectClass", objectClass?.wire ?: JSONObject.NULL)
        put("direction", direction ?: JSONObject.NULL)
        put("moving", moving ?: JSONObject.NULL)
    }
}
