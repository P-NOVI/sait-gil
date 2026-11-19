package com.pnovi.saitgil.vision

import android.content.Context
import android.util.Log
import android.util.Size
import androidx.camera.core.CameraSelector
import androidx.camera.core.ImageAnalysis
import androidx.camera.core.ImageProxy
import androidx.camera.core.Preview
import androidx.camera.core.UseCase
import androidx.camera.core.resolutionselector.ResolutionSelector
import androidx.camera.core.resolutionselector.ResolutionStrategy
import androidx.camera.lifecycle.ProcessCameraProvider
import androidx.camera.view.PreviewView
import androidx.core.content.ContextCompat
import androidx.lifecycle.LifecycleOwner
import java.util.concurrent.Executors

/**
 * 후면 카메라를 분석용으로 켜고 끈다. 영상은 기기 밖으로 보내지 않는다.
 * previewView 를 주면(개발용) 같은 카메라 화면을 그 뷰에 함께 보여 준다.
 * 화면(액티비티) 수명에 묶여 앱이 뒤로 가면 카메라도 쉬고, 돌아오면 다시 켜진다.
 * CameraX 는 메인 스레드에서 다뤄야 하므로 켜고 끄는 일은 메인 스레드로 넘긴다.
 */
class CameraSession(
    private val context: Context,
    private val owner: LifecycleOwner,
    private val analyzer: FrameAnalyzer,
    private val onFrame: (DetectionFrame) -> Unit,
    private val previewView: PreviewView? = null,
) {
    private val main = ContextCompat.getMainExecutor(context)
    private val worker = Executors.newSingleThreadExecutor()
    private var provider: ProcessCameraProvider? = null
    private var useCases: List<UseCase> = emptyList()
    private var frames = 0L

    fun start(onStarted: () -> Unit, onFailed: (Exception) -> Unit) {
        val future = ProcessCameraProvider.getInstance(context)
        future.addListener({
            try {
                val cameraProvider = future.get()
                if (useCases.isEmpty()) {
                    useCases = listOfNotNull(buildAnalysis(), previewView?.let(::buildPreview))
                }
                if (useCases.any { !cameraProvider.isBound(it) }) {
                    cameraProvider.bindToLifecycle(owner, CameraSelector.DEFAULT_BACK_CAMERA, *useCases.toTypedArray())
                }
                provider = cameraProvider
                onStarted()
            } catch (error: Exception) {
                onFailed(error)
            }
        }, main)
    }

    fun stop() {
        main.execute {
            provider?.unbind(*useCases.toTypedArray())
        }
    }

    /** 플러그인이 사라질 때. 카메라를 끄고, 분석 중인 프레임이 끝나면 분석기를 닫은 뒤 분석 스레드를 닫는다. */
    fun close() {
        stop()
        worker.execute(analyzer::close)
        worker.shutdown()
    }

    private fun buildAnalysis(): ImageAnalysis {
        val resolution = ResolutionSelector.Builder()
            .setResolutionStrategy(
                ResolutionStrategy(ANALYSIS_SIZE, ResolutionStrategy.FALLBACK_RULE_CLOSEST_LOWER_THEN_HIGHER),
            )
            .build()
        return ImageAnalysis.Builder()
            .setResolutionSelector(resolution)
            // 분석이 밀리면 지난 프레임은 버리고 가장 최근 것만 본다.
            .setBackpressureStrategy(ImageAnalysis.STRATEGY_KEEP_ONLY_LATEST)
            // 모델 입력(RGB)으로 바로 옮길 수 있게 RGBA 로 받는다.
            .setOutputImageFormat(ImageAnalysis.OUTPUT_IMAGE_FORMAT_RGBA_8888)
            .build()
            .also { it.setAnalyzer(worker, ::analyze) }
    }

    private fun buildPreview(view: PreviewView): Preview =
        Preview.Builder().build().also { it.surfaceProvider = view.surfaceProvider }

    private fun analyze(image: ImageProxy) {
        image.use {
            frames += 1
            if (frames % LOG_EVERY_FRAMES == 0L) {
                Log.d(TAG, "분석한 프레임 ${frames}장 (${it.width}x${it.height})")
            }
            // 한 프레임 분석이 실패해도 앱을 멈추지 않고 다음 프레임을 본다.
            val frame = try {
                analyzer.analyze(it)
            } catch (error: RuntimeException) {
                Log.w(TAG, "프레임을 분석하지 못했습니다", error)
                null
            }
            frame?.let(onFrame)
        }
    }

    companion object {
        private const val TAG = "SaitgilVision"

        // 모델 입력(640×640)에 맞춘 해상도. 세우면 480×640 이라 줄이지 않고 좌우 여백만 붙여 넣는다.
        private val ANALYSIS_SIZE = Size(640, 480)

        // 카메라가 돌고 있는지 로그로 확인할 간격(프레임 수)
        private const val LOG_EVERY_FRAMES = 30L
    }
}
