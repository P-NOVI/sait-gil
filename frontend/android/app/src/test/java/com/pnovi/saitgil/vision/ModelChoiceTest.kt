package com.pnovi.saitgil.vision

import org.junit.Assert.assertEquals
import org.junit.Test

class ModelChoiceTest {
    private val models = listOf(
        DetectorModel("fp32", "models/sidewalk_yolo26n.tflite"),
        DetectorModel("fp16", "models/sidewalk_yolo26n_fp16.tflite"),
        DetectorModel("int8", "models/sidewalk_yolo26n_int8.tflite"),
    )
    private val int8 = models[2].asset

    @Test
    fun modelLabelUsesShortNameOrPath() {
        assertEquals("int8", modelLabel(models, int8))
        assertEquals("models/other.tflite", modelLabel(models, "models/other.tflite"))
    }
}
