package com.pnovi.saitgil.vision

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

// 모델 없이 가짜 출력으로 디코딩·NMS·레터박스 좌표 변환을 확인한다. Android 클래스는 쓰지 않는다.
class YoloDecoderTest {
    private val config = DetectorConfig()

    /** 모델 입력 기준 0~1 박스 하나와 클래스 점수 */
    private data class Candidate(
        val centerX: Float,
        val centerY: Float,
        val width: Float,
        val height: Float,
        val scores: Map<DetectedClass, Float>,
    )

    /** 후보들을 모델 출력처럼 [채널][후보] 순서로 펼친다 */
    private fun output(vararg candidates: Candidate): FloatArray {
        val count = candidates.size
        val values = FloatArray(OUTPUT_CHANNELS * count)
        candidates.forEachIndexed { i, candidate ->
            values[i] = candidate.centerX
            values[count + i] = candidate.centerY
            values[2 * count + i] = candidate.width
            values[3 * count + i] = candidate.height
            candidate.scores.forEach { (kind, score) -> values[(4 + kind.ordinal) * count + i] = score }
        }
        return values
    }

    private fun candidate(kind: DetectedClass, score: Float, centerX: Float = 0.5f, width: Float = 0.2f) =
        Candidate(centerX, 0.5f, width, 0.4f, mapOf(kind to score))

    private fun decode(vararg candidates: Candidate, settings: DetectorConfig = config) =
        decodeDetections(output(*candidates), candidates.size, settings)

    private fun near(expected: Double, actual: Double) = assertEquals(expected, actual, 1e-4)

    @Test
    fun `출력 채널 수는 박스 4개와 학습한 클래스 8개다`() {
        assertEquals(12, OUTPUT_CHANNELS)
    }

    @Test
    fun `후보마다 점수가 가장 높은 클래스로 읽는다`() {
        val mixed = Candidate(
            0.5f,
            0.5f,
            0.2f,
            0.4f,
            mapOf(DetectedClass.POLE to 0.4f, DetectedClass.OBSTACLE to 0.8f),
        )

        val found = decode(mixed)

        assertEquals(1, found.size)
        assertEquals(DetectedClass.OBSTACLE, found[0].kind)
        assertEquals(0.8f, found[0].score)
    }

    @Test
    fun `점수 컷보다 낮은 후보는 버린다`() {
        val found = decode(
            candidate(DetectedClass.PERSON, 0.9f, centerX = 0.2f),
            candidate(DetectedClass.PERSON, config.minScore - 0.01f, centerX = 0.8f),
        )

        assertEquals(listOf(0.9f), found.map { it.score })
    }

    @Test
    fun `같은 클래스로 많이 겹친 박스는 점수 높은 것만 남긴다`() {
        val found = decode(
            candidate(DetectedClass.PERSON, 0.6f, centerX = 0.5f),
            candidate(DetectedClass.PERSON, 0.9f, centerX = 0.51f),
        )

        assertEquals(listOf(0.9f), found.map { it.score })
    }

    @Test
    fun `다른 클래스는 겹쳐도 둘 다 남긴다`() {
        val found = decode(
            candidate(DetectedClass.PERSON, 0.9f),
            candidate(DetectedClass.TWO_WHEELER, 0.8f),
        )

        assertEquals(setOf(DetectedClass.PERSON, DetectedClass.TWO_WHEELER), found.map { it.kind }.toSet())
    }

    @Test
    fun `조금만 겹친 같은 클래스 박스는 둘 다 남긴다`() {
        val found = decode(
            candidate(DetectedClass.PERSON, 0.9f, centerX = 0.4f),
            candidate(DetectedClass.PERSON, 0.8f, centerX = 0.55f),
        )

        assertEquals(2, found.size)
    }

    @Test
    fun `박스 수 상한을 넘으면 점수 높은 순으로 자른다`() {
        val found = decode(
            candidate(DetectedClass.PERSON, 0.5f, centerX = 0.1f, width = 0.05f),
            candidate(DetectedClass.PERSON, 0.9f, centerX = 0.5f, width = 0.05f),
            candidate(DetectedClass.PERSON, 0.7f, centerX = 0.9f, width = 0.05f),
            settings = config.copy(maxDetections = 2),
        )

        assertEquals(listOf(0.9f, 0.7f), found.map { it.score })
    }

    @Test
    fun `IoU 는 겹친 넓이를 합친 넓이로 나눈 값이다`() {
        val a = RawDetection(DetectedClass.PERSON, 1f, 0.25f, 0.5f, 0.5f, 1f)
        val b = RawDetection(DetectedClass.PERSON, 1f, 0.5f, 0.5f, 0.5f, 1f)

        assertEquals(1f / 3f, iou(a, b), 1e-6f)
        assertEquals(0f, iou(a, a.copy(centerX = 0.9f)), 0f)
    }

    @Test
    fun `세운 480x640 영상은 줄이지 않고 좌우에 80px 여백을 둔다`() {
        val letterbox = Letterbox(imageWidth = 480, imageHeight = 640, inputSize = 640)

        assertEquals(1f, letterbox.scale)
        assertEquals(80f, letterbox.padX)
        assertEquals(0f, letterbox.padY)
        near(0.0, letterbox.toImageX(80f / 640))
        near(1.0, letterbox.toImageX(560f / 640))
        near(0.5, letterbox.toImageX(0.5f))
    }

    @Test
    fun `여백에 걸친 좌표는 영상 끝으로 자른다`() {
        val letterbox = Letterbox(imageWidth = 480, imageHeight = 640, inputSize = 640)

        near(0.0, letterbox.toImageX(0.01f))
        near(1.0, letterbox.toImageX(0.99f))
    }

    @Test
    fun `큰 영상은 비율을 지켜 줄이고 위아래에 여백을 둔다`() {
        val letterbox = Letterbox(imageWidth = 1280, imageHeight = 960, inputSize = 640)

        assertEquals(0.5f, letterbox.scale)
        assertEquals(0f, letterbox.padX)
        assertEquals(80f, letterbox.padY)
        near(0.25, letterbox.toImageY((80f + 120f) / 640))
    }

    @Test
    fun `사람은 boxes, 나머지는 objects 로 나누고 세운 화면 기준 0~1 좌표로 옮긴다`() {
        val letterbox = Letterbox(imageWidth = 480, imageHeight = 640, inputSize = 640)
        // 입력 기준 가운데(320, 320), 너비 96px·높이 320px 박스 = 영상 기준 가로 0.4~0.6, 세로 0.25~0.75
        val person = RawDetection(DetectedClass.PERSON, 0.9f, 0.5f, 0.5f, 96f / 640, 0.5f)
        val pole = person.copy(kind = DetectedClass.POLE, score = 0.7f)

        val frame = toDetectionFrame(listOf(person, pole), letterbox, timeMs = 1_234)

        assertEquals(1_234L, frame.timeMs)
        assertEquals(480, frame.imageWidthPx)
        assertEquals(640, frame.imageHeightPx)
        assertEquals(1, frame.boxes.size)
        near(0.4, frame.boxes[0].left)
        near(0.2, frame.boxes[0].width)
        near(0.25, frame.boxes[0].top)
        near(0.5, frame.boxes[0].height)
        near(0.9, frame.boxes[0].score)
        assertEquals(DetectedClass.POLE, frame.objects.single().kind)
        near(0.4, frame.objects.single().left)
    }

    @Test
    fun `여백 안에만 있는 박스는 버린다`() {
        val letterbox = Letterbox(imageWidth = 480, imageHeight = 640, inputSize = 640)
        val inPadding = RawDetection(DetectedClass.CAR, 0.9f, 40f / 640, 0.5f, 40f / 640, 0.2f)

        val frame = toDetectionFrame(listOf(inPadding), letterbox, timeMs = 0)

        assertTrue(frame.boxes.isEmpty())
        assertTrue(frame.objects.isEmpty())
    }
}
