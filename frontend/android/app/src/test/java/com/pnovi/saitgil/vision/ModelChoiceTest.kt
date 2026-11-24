package com.pnovi.saitgil.vision

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class ModelChoiceTest {
    // 실제 목록 순서(기본 모델이 앞)와 상관없이 차례를 보도록 테스트용 목록을 둔다
    private val models = listOf(
        DetectorModel("fp32", "models/sidewalk_yolo26n.tflite"),
        DetectorModel("fp16", "models/sidewalk_yolo26n_fp16.tflite"),
        DetectorModel("int8", "models/sidewalk_yolo26n_int8.tflite"),
    )
    private val fp32 = models[0].asset
    private val fp16 = models[1].asset
    private val int8 = models[2].asset

    @Test
    fun nextModelCyclesInOrderAndWrapsAround() {
        val all = setOf(fp32, fp16, int8)

        assertEquals(fp16, nextModel(models, all, fp32)?.asset)
        assertEquals(int8, nextModel(models, all, fp16)?.asset)
        assertEquals(fp32, nextModel(models, all, int8)?.asset)
    }

    @Test
    fun nextModelSkipsModelsWithoutFile() {
        // INT8 을 내보내지 못해 넣지 않았으면 FP32·FP16 만 오간다.
        val noInt8 = setOf(fp32, fp16)

        assertEquals(fp32, nextModel(models, noInt8, fp16)?.asset)
    }

    @Test
    fun nextModelStartsFromFirstWhenCurrentIsUnknown() {
        assertEquals(fp32, nextModel(models, setOf(fp32, int8), "models/old.tflite")?.asset)
    }

    @Test
    fun nextModelIsNullWithoutAnyModelFile() {
        assertNull(nextModel(models, emptySet(), fp32))
    }

    @Test
    fun savedModelFallsBackToDefaultWhenFileIsGone() {
        assertEquals(fp16, savedModelOrDefault(fp16, setOf(fp32, fp16), fp32))
        assertEquals(fp32, savedModelOrDefault(int8, setOf(fp32, fp16), fp32))
        assertEquals(fp32, savedModelOrDefault(null, setOf(fp32, fp16), fp32))
    }

    @Test
    fun modelLabelUsesShortNameOrPath() {
        assertEquals("int8", modelLabel(models, int8))
        assertEquals("models/other.tflite", modelLabel(models, "models/other.tflite"))
    }
}
