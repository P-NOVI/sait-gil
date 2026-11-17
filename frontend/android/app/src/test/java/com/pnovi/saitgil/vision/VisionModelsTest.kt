package com.pnovi.saitgil.vision

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

// 화면(vision.ts)과 주고받는 문자열이 어긋나지 않는지 확인한다. Android 클래스는 쓰지 않는다.
class VisionModelsTest {
    @Test
    fun modeAcceptsOnlyKnownWireValues() {
        assertEquals(VisionMode.CROWD, VisionMode.fromWire("crowd"))
        assertEquals(VisionMode.SIGNAL, VisionMode.fromWire("signal"))
        assertEquals(VisionMode.GATE, VisionMode.fromWire("gate"))
        assertNull(VisionMode.fromWire("camera"))
        assertNull(VisionMode.fromWire(null))
    }

    @Test
    fun sensitivityAcceptsOnlyKnownWireValues() {
        assertEquals(CrowdSensitivity.LOW, CrowdSensitivity.fromWire("low"))
        assertEquals(CrowdSensitivity.NORMAL, CrowdSensitivity.fromWire("normal"))
        assertEquals(CrowdSensitivity.HIGH, CrowdSensitivity.fromWire("high"))
        assertNull(CrowdSensitivity.fromWire("max"))
        assertNull(CrowdSensitivity.fromWire(null))
    }

    @Test
    fun crowdLevelWireValuesMatchWebType() {
        val wires = CrowdLevel.entries.map { it.wire }
        assertEquals(listOf("clear", "caution", "crowded", "danger", "unknown"), wires)
    }
}
