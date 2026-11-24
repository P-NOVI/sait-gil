package com.pnovi.saitgil.vision

import android.annotation.SuppressLint
import android.app.Activity
import android.view.GestureDetector
import android.view.Gravity
import android.view.MotionEvent
import android.view.ScaleGestureDetector
import android.view.View
import android.widget.FrameLayout
import androidx.camera.view.PreviewView

/**
 * 개발용 카메라 화면. 디버그 빌드(BuildConfig.VISION_PREVIEW)에서만 띄워 인식이 잘 되는지 본다.
 * 두 손가락으로 벌리고 오므려 크기를 바꾸고, 한 손가락으로 끌어 옮긴다. 경로가 가려지면 치워 둔다.
 * 길게 누르면 onLongPress 를 부른다(비교할 모델 바꾸기, #128).
 * 화면낭독기가 읽지 않도록 접근성에서 숨긴다. 메인 스레드에서만 만들고 다룬다.
 */
class DebugPreview(private val activity: Activity, private val onLongPress: () -> Unit = {}) {
    private val screen = activity.resources.displayMetrics
    private val params = FrameLayout.LayoutParams(0, 0, Gravity.TOP or Gravity.START)
    private var lastX = 0f
    private var lastY = 0f

    // 크기를 바꾼 직후 첫 이동은 기준점만 다시 잡는다. 손가락이 바뀌어 화면이 튀지 않게 한다.
    private var dragFromHere = true

    val view: PreviewView = PreviewView(activity).apply {
        // WebView 위에 겹쳐 그리려면 SurfaceView 대신 TextureView 방식을 쓴다.
        implementationMode = PreviewView.ImplementationMode.COMPATIBLE
        scaleType = PreviewView.ScaleType.FILL_CENTER
        importantForAccessibility = View.IMPORTANT_FOR_ACCESSIBILITY_NO_HIDE_DESCENDANTS
        visibility = View.GONE
    }

    private val scaler = ScaleGestureDetector(
        activity,
        object : ScaleGestureDetector.SimpleOnScaleGestureListener() {
            override fun onScale(detector: ScaleGestureDetector): Boolean {
                resize((params.width * detector.scaleFactor).toInt())
                return true
            }
        },
    )

    private val presser = GestureDetector(
        activity,
        object : GestureDetector.SimpleOnGestureListener() {
            override fun onLongPress(event: MotionEvent) = onLongPress()
        },
    )

    init {
        resize((screen.widthPixels * DEFAULT_WIDTH_SHARE).toInt())
        activity.findViewById<FrameLayout>(android.R.id.content).addView(view, params)
        listenTouches()
    }

    fun show() {
        view.visibility = View.VISIBLE
    }

    fun hide() {
        view.visibility = View.GONE
    }

    fun remove() {
        (view.parent as? FrameLayout)?.removeView(view)
    }

    // 개발용 화면이라 접근성 클릭은 두지 않는다.
    @SuppressLint("ClickableViewAccessibility")
    private fun listenTouches() {
        view.setOnTouchListener { _, event ->
            scaler.onTouchEvent(event)
            presser.onTouchEvent(event)
            when {
                event.actionMasked == MotionEvent.ACTION_DOWN -> dragFromHere = true
                event.actionMasked != MotionEvent.ACTION_MOVE -> Unit
                scaler.isInProgress || event.pointerCount > 1 -> dragFromHere = true
                dragFromHere -> dragFromHere = false
                else -> move(event.rawX - lastX, event.rawY - lastY)
            }
            lastX = event.rawX
            lastY = event.rawY
            true
        }
    }

    /** 가로 폭을 정하고 세로는 카메라 비율(3:4)에 맞춘다. */
    private fun resize(width: Int) {
        val clamped = width.coerceIn(
            (screen.widthPixels * MIN_WIDTH_SHARE).toInt(),
            (screen.widthPixels * MAX_WIDTH_SHARE).toInt(),
        )
        params.width = clamped
        params.height = clamped * ASPECT_HEIGHT / ASPECT_WIDTH
        move(0f, 0f)
    }

    /** 화면 밖으로 나가지 않게 옮긴다. */
    private fun move(dx: Float, dy: Float) {
        val parent = view.parent as? View
        val maxLeft = (parent?.width?.takeIf { it > 0 } ?: screen.widthPixels) - params.width
        val maxTop = (parent?.height?.takeIf { it > 0 } ?: screen.heightPixels) - params.height
        params.leftMargin = (params.leftMargin + dx.toInt()).coerceIn(0, maxOf(0, maxLeft))
        params.topMargin = (params.topMargin + dy.toInt()).coerceIn(0, maxOf(0, maxTop))
        view.layoutParams = params
    }

    companion object {
        // 화면 가로 폭 중 미리보기 폭의 비율. 처음 크기와 손으로 바꿀 수 있는 범위
        private const val DEFAULT_WIDTH_SHARE = 0.5f
        private const val MIN_WIDTH_SHARE = 0.25f
        private const val MAX_WIDTH_SHARE = 1.0f

        // 카메라 분석 비율(640x480)을 세로로 세운 3:4
        private const val ASPECT_WIDTH = 3
        private const val ASPECT_HEIGHT = 4
    }
}
