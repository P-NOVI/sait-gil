package com.pnovi.saitgil.vision

import android.annotation.SuppressLint
import android.app.Activity
import android.content.Context
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Paint
import android.graphics.RectF
import android.view.View
import android.view.ViewGroup
import android.widget.FrameLayout
import androidx.activity.ComponentActivity
import androidx.activity.OnBackPressedCallback
import androidx.camera.view.PreviewView

/**
 * 관리자 빌드(시연·점검)에서 길안내 중 카메라 화면을 화면 가득 띄우고 인식한 박스를 클래스별 색으로 그린다.
 * 화면 앞을 덮어 아래 버튼이 눌리지 않게 하고, 뒤로 가기를 누르면 닫혀 길안내 화면이 보인다.
 * 화면낭독기가 읽지 않도록 접근성에서 숨긴다. 메인 스레드에서만 만들고 다룬다.
 */
class AdminPreview(activity: Activity, upsideDown: () -> Boolean) {
    private val boxes = BoxOverlay(activity, upsideDown)

    val view: PreviewView = PreviewView(activity).apply {
        // WebView 위에 겹쳐 그리려면 SurfaceView 대신 TextureView 방식을 쓴다.
        implementationMode = PreviewView.ImplementationMode.COMPATIBLE
        scaleType = PreviewView.ScaleType.FILL_CENTER
    }

    private val container = FrameLayout(activity).apply {
        importantForAccessibility = View.IMPORTANT_FOR_ACCESSIBILITY_NO_HIDE_DESCENDANTS
        setBackgroundColor(Color.BLACK)
        visibility = View.GONE
        addView(view, matchParent())
        addView(boxes, matchParent())
    }

    private val back = object : OnBackPressedCallback(false) {
        override fun handleOnBackPressed() = hide()
    }

    init {
        activity.findViewById<FrameLayout>(android.R.id.content).addView(container, matchParent())
        blockTouches()
        (activity as? ComponentActivity)?.onBackPressedDispatcher?.addCallback(activity, back)
    }

    fun show() {
        boxes.clear()
        container.visibility = View.VISIBLE
        back.isEnabled = true
    }

    fun hide() {
        container.visibility = View.GONE
        back.isEnabled = false
    }

    fun remove() {
        back.remove()
        (container.parent as? ViewGroup)?.removeView(container)
    }

    /** 카메라 분석 스레드에서 불러도 된다. 그리는 일은 메인 스레드로 넘긴다 */
    fun draw(frame: DetectionFrame) {
        container.post { boxes.update(frame) }
    }

    // 덮은 동안 아래 길안내 버튼이 잘못 눌리지 않게 손가락을 받아 버린다.
    @SuppressLint("ClickableViewAccessibility")
    private fun blockTouches() {
        container.setOnTouchListener { _, _ -> true }
    }

    private fun matchParent() =
        FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT)
}

/**
 * 세운 분석 영상 기준(0~1) 박스를 FILL_CENTER 로 잘려 보이는 카메라 화면 위 위치로 옮겨 그린다.
 * 분석과 미리보기를 같은 4:3 비율로 묶으므로 같은 비율로 늘리고 가운데를 맞추면 된다.
 * 폰을 거꾸로 걸면 분석 영상만 180° 돌리므로(CameraSession.applyMount) 박스도 되돌려 그린다.
 */
private class BoxOverlay(context: Context, private val upsideDown: () -> Boolean) : View(context) {
    private val density = resources.displayMetrics.density
    private val stroke = Paint(Paint.ANTI_ALIAS_FLAG).apply {
        style = Paint.Style.STROKE
        strokeWidth = STROKE_DP * density
    }
    private val label = Paint(Paint.ANTI_ALIAS_FLAG).apply {
        color = Color.BLACK
        textSize = LABEL_SP * resources.displayMetrics.scaledDensity
        isFakeBoldText = true
    }
    private val labelBack = Paint().apply { style = Paint.Style.FILL }
    private val rect = RectF()
    private var frame: DetectionFrame? = null

    fun update(next: DetectionFrame) {
        frame = next
        invalidate()
    }

    fun clear() {
        frame = null
        invalidate()
    }

    override fun onDraw(canvas: Canvas) {
        val current = frame ?: return
        val imageWidth = current.imageWidthPx.toFloat()
        val imageHeight = current.imageHeightPx.toFloat()
        if (imageWidth <= 0f || imageHeight <= 0f) return
        val scale = maxOf(width / imageWidth, height / imageHeight)
        val shownWidth = imageWidth * scale
        val shownHeight = imageHeight * scale
        val offsetX = (width - shownWidth) / 2
        val offsetY = (height - shownHeight) / 2
        val flip = upsideDown()
        val boxes = current.boxes.map { Shown(DetectedClass.PERSON, it.left, it.top, it.width, it.height, it.score) } +
            current.objects.map { Shown(it.kind, it.left, it.top, it.width, it.height, it.score) }
        for (box in boxes) {
            val left = if (flip) 1 - box.left - box.width else box.left
            val top = if (flip) 1 - box.top - box.height else box.top
            rect.set(
                offsetX + (left * shownWidth).toFloat(),
                offsetY + (top * shownHeight).toFloat(),
                offsetX + ((left + box.width) * shownWidth).toFloat(),
                offsetY + ((top + box.height) * shownHeight).toFloat(),
            )
            val color = CLASS_COLORS.getValue(box.kind)
            stroke.color = color
            canvas.drawRect(rect, stroke)
            drawLabel(canvas, "${box.kind.wire} ${"%.2f".format(box.score)}", color)
        }
    }

    /** 박스 왼쪽 위 바깥에 글자를 쓴다. 화면 위에 닿으면 박스 안쪽에 쓴다 */
    private fun drawLabel(canvas: Canvas, text: String, color: Int) {
        val padding = LABEL_PADDING_DP * density
        val textHeight = label.descent() - label.ascent()
        val backHeight = textHeight + padding * 2
        val top = if (rect.top - backHeight >= 0f) rect.top - backHeight else rect.top
        labelBack.color = color
        canvas.drawRect(rect.left, top, rect.left + label.measureText(text) + padding * 2, top + backHeight, labelBack)
        canvas.drawText(text, rect.left + padding, top + padding - label.ascent(), label)
    }

    private data class Shown(
        val kind: DetectedClass,
        val left: Double,
        val top: Double,
        val width: Double,
        val height: Double,
        val score: Double,
    )

    companion object {
        private const val STROKE_DP = 3f
        private const val LABEL_SP = 14f
        private const val LABEL_PADDING_DP = 3f

        // 클래스마다 다른 색. 글자는 검정으로 쓰므로 밝은 색만 쓴다.
        private val CLASS_COLORS = mapOf(
            DetectedClass.PERSON to Color.rgb(255, 133, 27),
            DetectedClass.TWO_WHEELER to Color.rgb(0, 229, 255),
            DetectedClass.CAR to Color.rgb(68, 138, 255),
            DetectedClass.OBSTACLE to Color.rgb(255, 235, 59),
            DetectedClass.POLE to Color.rgb(224, 64, 251),
            DetectedClass.STAIRS to Color.WHITE,
            DetectedClass.PED_SIGNAL_RED to Color.rgb(255, 23, 68),
            DetectedClass.PED_SIGNAL_OTHER to Color.rgb(0, 230, 118),
        )
    }
}
