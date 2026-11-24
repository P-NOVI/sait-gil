package com.pnovi.saitgil.vision

import android.content.Context
import android.hardware.camera2.CameraCharacteristics
import android.os.SystemClock
import android.util.Log
import android.util.Size
import android.view.OrientationEventListener
import android.view.Surface
import androidx.annotation.MainThread
import androidx.annotation.OptIn
import androidx.camera.camera2.interop.Camera2CameraInfo
import androidx.camera.camera2.interop.ExperimentalCamera2Interop
import androidx.camera.core.CameraInfo
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

    // 렌즈 초점거리 ÷ 센서 긴 변. 카메라를 켤 때(메인 스레드) 읽고 분석 스레드에서 쓴다. 못 읽으면 null
    @Volatile
    private var focalPerLongSide: Double? = null

    // 목걸이에 위아래 거꾸로 걸리면 분석 영상을 180° 더 돌린다. 개발용 미리보기는 돌리지 않는다.
    // mount·analysis·baseRotation 과 applyMount 는 메인 스레드에서만 쓴다. 카메라 준비 리스너는
    // main 실행기에서 돌고, OrientationEventListener 는 Handler 없이 등록해 메인 스레드로 알린다.
    private val mount = MountOrientation()
    private var analysis: ImageAnalysis? = null
    // 화면은 세로 고정(AndroidManifest 의 screenOrientation="portrait")이라 화면 방향이 바뀌지 않는다.
    // 그래서 분석을 만들 때 한 번만 잡고, 거꾸로 걸린 것은 applyMount 가 180° 더 돌린다.
    private var baseRotation = Surface.ROTATION_0

    // 횡단보도 근처라 분석 해상도를 올렸는지(#134). 메인 스레드에서만 쓴다.
    private var highRes = false
    private val orientation = object : OrientationEventListener(context) {
        override fun onOrientationChanged(degrees: Int) {
            val known = degrees.takeIf { it != ORIENTATION_UNKNOWN }
            if (mount.update(known, SystemClock.elapsedRealtime())) applyMount()
        }
    }

    fun start(onStarted: () -> Unit, onFailed: (Exception) -> Unit) {
        val future = ProcessCameraProvider.getInstance(context)
        future.addListener({
            try {
                val cameraProvider = future.get()
                if (useCases.isEmpty()) {
                    useCases = listOfNotNull(buildAnalysis(), previewView?.let(::buildPreview))
                }
                if (useCases.any { !cameraProvider.isBound(it) }) {
                    val camera = cameraProvider.bindToLifecycle(
                        owner,
                        CameraSelector.DEFAULT_BACK_CAMERA,
                        *useCases.toTypedArray(),
                    )
                    focalPerLongSide = readFocalPerLongSide(camera.cameraInfo)
                }
                provider = cameraProvider
                if (orientation.canDetectOrientation()) {
                    orientation.enable()
                } else {
                    Log.w(TAG, "방향 센서가 없어 폰을 거꾸로 걸어도 영상을 돌리지 못합니다")
                }
                onStarted()
            } catch (error: Exception) {
                onFailed(error)
            }
        }, main)
    }

    fun stop() {
        main.execute {
            orientation.disable()
            provider?.unbind(*useCases.toTypedArray())
        }
    }

    /**
     * 분석 해상도를 올리거나(SIGNAL_ANALYSIS_SIZE) 되돌린다(ANALYSIS_SIZE). 횡단보도 근처에서 먼 신호등을 잘라 볼 큰 영상을 받으려고 쓴다.
     * CameraX 는 분석 해상도를 묶을 때만 정하므로, 켜져 있으면 분석만 새로 만들어 다시 묶는다. 그동안 잠깐 프레임이 오지 않는다.
     * 꺼져 있으면 다음에 켤 때 이 해상도로 묶는다. 다시 묶지 못하면 원래 해상도로 되돌린다.
     */
    fun setHighRes(on: Boolean) {
        main.execute {
            if (highRes != on) {
                highRes = on
                analysis?.let(::rebindAnalysis)
            }
        }
    }

    @MainThread
    private fun rebindAnalysis(old: ImageAnalysis) {
        val next = buildAnalysis()
        useCases = useCases.map { if (it === old) next else it }
        old.clearAnalyzer()
        val cameraProvider = provider ?: return
        if (!cameraProvider.isBound(old)) return
        cameraProvider.unbind(old)
        try {
            cameraProvider.bindToLifecycle(owner, CameraSelector.DEFAULT_BACK_CAMERA, next)
            Log.i(TAG, if (highRes) "횡단보도 근처라 분석 해상도를 올립니다" else "분석 해상도를 되돌립니다")
        } catch (error: RuntimeException) {
            Log.w(TAG, "분석 해상도를 바꾸지 못해 되돌립니다", error)
            highRes = !highRes
            val back = buildAnalysis()
            useCases = useCases.map { if (it === next) back else it }
            next.clearAnalyzer()
            try {
                cameraProvider.bindToLifecycle(owner, CameraSelector.DEFAULT_BACK_CAMERA, back)
            } catch (again: RuntimeException) {
                Log.e(TAG, "분석을 다시 묶지 못했습니다", again)
            }
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
                ResolutionStrategy(
                    if (highRes) SIGNAL_ANALYSIS_SIZE else ANALYSIS_SIZE,
                    ResolutionStrategy.FALLBACK_RULE_CLOSEST_LOWER_THEN_HIGHER,
                ),
            )
            .build()
        return ImageAnalysis.Builder()
            .setResolutionSelector(resolution)
            // 분석이 밀리면 지난 프레임은 버리고 가장 최근 것만 본다.
            .setBackpressureStrategy(ImageAnalysis.STRATEGY_KEEP_ONLY_LATEST)
            // 모델 입력(RGB)으로 바로 옮길 수 있게 RGBA 로 받는다.
            .setOutputImageFormat(ImageAnalysis.OUTPUT_IMAGE_FORMAT_RGBA_8888)
            .build()
            .also {
                it.setAnalyzer(worker, ::analyze)
                baseRotation = it.targetRotation
                analysis = it
                applyMount()
            }
    }

    /** 분석 영상 방향을 폰이 걸린 방향에 맞춘다. 돌린 만큼 프레임의 rotationDegrees 가 바뀌어 분석기가 바로 세운다 */
    @MainThread
    private fun applyMount() {
        val target = if (mount.upsideDown) (baseRotation + HALF_TURN_STEPS) % ROTATION_STEPS else baseRotation
        val current = analysis ?: return
        if (current.targetRotation == target) return
        current.targetRotation = target
        Log.i(TAG, if (mount.upsideDown) "폰이 위아래 거꾸로 걸려 영상을 180° 돌려 봅니다" else "폰이 바로 걸려 영상을 돌리지 않습니다")
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
            frame?.withFocalPerLongSide(focalPerLongSide)?.let(onFrame)
        }
    }

    /** 거리 계산에 쓸 실제 초점거리를 카메라 정보에서 읽는다. 기기마다 화각이 달라 기본 화각으로 재면 거리가 틀린다 */
    @OptIn(ExperimentalCamera2Interop::class)
    private fun readFocalPerLongSide(info: CameraInfo): Double? {
        val camera2 = Camera2CameraInfo.from(info)
        val focalMm = camera2.getCameraCharacteristic(CameraCharacteristics.LENS_INFO_AVAILABLE_FOCAL_LENGTHS)?.firstOrNull()
        val sensor = camera2.getCameraCharacteristic(CameraCharacteristics.SENSOR_INFO_PHYSICAL_SIZE)
        val perLongSide = focalPerLongSide(focalMm, sensor?.width, sensor?.height)
        Log.i(TAG, "카메라 초점거리 ${focalMm}mm, 센서 ${sensor}mm → 긴 변 대비 $perLongSide")
        return perLongSide
    }

    companion object {
        private const val TAG = "SaitgilVision"

        // 모델 입력(640×640)에 맞춘 해상도. 세우면 480×640 이라 줄이지 않고 좌우 여백만 붙여 넣는다.
        private val ANALYSIS_SIZE = Size(640, 480)

        // 횡단보도 근처 해상도(#134). 세우면 960×1280 이라 전체는 반으로 줄여 넣고, 위쪽 가운데 640×640 은 줄이지 않고 신호등만 다시 찾는다.
        // 건너편 보행등(30m)이 480×640 에서 약 6×12px 라 nano 모델이 잡기 어려워 두 배로 키운다.
        private val SIGNAL_ANALYSIS_SIZE = Size(1280, 960)

        // 카메라가 돌고 있는지 로그로 확인할 간격(프레임 수)
        private const val LOG_EVERY_FRAMES = 30L

        // Surface.ROTATION_* 는 90° 단위 0~3 이다.
        private const val ROTATION_STEPS = 4
        private const val HALF_TURN_STEPS = 2
    }
}
