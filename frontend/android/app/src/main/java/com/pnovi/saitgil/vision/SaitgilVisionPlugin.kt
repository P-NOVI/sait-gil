package com.pnovi.saitgil.vision

import android.Manifest
import android.content.Context
import android.os.Handler
import android.os.Looper
import android.os.SystemClock
import android.util.Log
import android.widget.Toast
import androidx.core.app.ActivityCompat
import com.getcapacitor.JSObject
import com.getcapacitor.PermissionState
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.CapacitorPlugin
import com.getcapacitor.annotation.Permission
import com.getcapacitor.annotation.PermissionCallback
import com.pnovi.saitgil.BuildConfig

/**
 * 카메라 인파 인식을 화면(React)에 이어 주는 플러그인.
 * start 하면 카메라 권한을 받아 후면 카메라를 켜고, 프레임을 LiteRT 모델로 추론해 판단기로 넘긴다.
 * 모델 파일이 없으면 결과를 보내지 않는다.
 * 영상은 이 플러그인 밖으로 나가지 않고, 추론 결과만 이벤트(crowdState, alert)로 화면에 넘긴다.
 */
@CapacitorPlugin(
    name = "SaitgilVision",
    permissions = [Permission(alias = SaitgilVisionPlugin.CAMERA, strings = [Manifest.permission.CAMERA])],
)
class SaitgilVisionPlugin : Plugin() {
    private var running = false
    private var camera: CameraSession? = null
    private var preview: DebugPreview? = null

    // 카메라 판정이 붙으면 모드별 인식과 알림 기준에 쓴다.
    private var mode = VisionMode.CROWD
    private var sensitivity = CrowdSensitivity.NORMAL

    private val visionConfig = VisionConfig()
    private val detectorConfig = DetectorConfig()

    // 추론할 모델. 릴리스 빌드는 늘 기본 모델이고, 디버그 빌드는 미리보기를 길게 눌러 바꾼 모델을 기억해 쓴다(#128).
    // 메인 스레드에서 바꾸고 카메라 분석 스레드가 읽으므로 @Volatile 이다.
    @Volatile
    private var modelAsset = detectorConfig.modelAsset

    // 안내마다 새로 만들어 지난 안내의 사람 추적·장애물·신호등 기록을 이어 쓰지 않는다.
    private var analyzer = CrowdAnalyzer()
    private var objectAnalyzer = ObjectAnalyzer()

    // 화면이 GPS 로 알려 주는 사용자 걸음 속도(m/s)와 받은 시각. 멈춰 있으면 0, 모르면 null 이다.
    // 카메라 분석 스레드가 읽으므로 @Volatile 이다.
    @Volatile
    private var walkSpeedMps: Double? = null

    @Volatile
    private var walkSpeedAtMs = 0L

    // 화면이 알려 주는, 길안내 경로의 횡단보도 근처인지(#134). 근처에서는 분석 해상도를 올리고 위쪽 가운데를 잘라 먼 신호등을 한 번 더 찾는다.
    // 카메라 분석 스레드가 읽으므로 @Volatile 이다. 화면이 인식을 켤 때마다 다시 알려 주므로 멈출 때 지우지 않는다.
    @Volatile
    private var nearCrosswalk = false

    // 근처를 벗어나면 highResOffDelayMs 뒤 해상도를 되돌린다. 그 안에 다시 근처가 되면 지워 다시 묶지 않는다.
    private val mainHandler = Handler(Looper.getMainLooper())
    private val lowerResolution = Runnable { camera?.setHighRes(false) }

    // 권한을 요청하기 직전의 rationale 값. 요청 뒤 값과 비교해 "다시 묻지 않음"을 가린다.
    private var rationaleBeforeRequest = false

    // 마지막으로 로그에 남긴 인파 단계·신호등 상태
    private var loggedState: Pair<CrowdLevel, SignalState?>? = null

    // 마지막으로 박스와 함께 로그에 남긴 신호등 상태
    private var loggedSignal: SignalState? = null

    @PluginMethod
    fun start(call: PluginCall) {
        val requested = call.getString("sensitivity")
        if (requested != null) {
            sensitivity = CrowdSensitivity.fromWire(requested)
                ?: return call.reject("지원하지 않는 민감도입니다: $requested")
        }
        // 카메라 분석 스레드의 onDetections 와 같은 잠금으로 바꿔 쓰던 중인 분석기를 바꾸지 않는다.
        synchronized(this) {
            analyzer = CrowdAnalyzer()
            objectAnalyzer = ObjectAnalyzer()
        }
        if (getPermissionState(CAMERA) == PermissionState.GRANTED) {
            startCamera(call)
        } else {
            rationaleBeforeRequest = shouldShowCameraRationale()
            requestPermissionForAlias(CAMERA, call, "cameraPermissionResult")
        }
    }

    @PermissionCallback
    private fun cameraPermissionResult(call: PluginCall) {
        val prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
        if (getPermissionState(CAMERA) == PermissionState.GRANTED) {
            prefs.edit().remove(KEY_CAMERA_DENIED).apply()
            startCamera(call)
        } else if (shouldShowCameraRationale()) {
            // 사용자가 창에서 거부한 것이 기록됐다. 다시 켜면 시스템 창이 다시 뜬다.
            prefs.edit().putBoolean(KEY_CAMERA_DENIED, true).apply()
            call.reject(CAMERA_DENIED, CAMERA_DENIED_CODE)
        } else if (rationaleBeforeRequest || prefs.getBoolean(KEY_CAMERA_DENIED, false)) {
            // 거부가 이미 기록돼 있는데 설명 창이 더는 뜨지 않는다. 시스템 창이 다시 뜨지 않으므로 설정 화면에서 켜야 한다.
            // 거부한 적 없이 rationale 이 false 인 것(Android 11 이상에서 창 바깥을 눌러 닫음, 정책 제한)은 여기에 오지 않는다.
            call.reject(CAMERA_BLOCKED, CAMERA_BLOCKED_CODE)
        } else {
            call.reject(CAMERA_DENIED, CAMERA_DENIED_CODE)
        }
    }

    private fun shouldShowCameraRationale() =
        ActivityCompat.shouldShowRequestPermissionRationale(activity, Manifest.permission.CAMERA)

    // 미리보기 뷰를 만들고 보여 주는 일이 있어 메인 스레드에서 처리한다.
    private fun startCamera(call: PluginCall) = activity.runOnUiThread {
        if (BuildConfig.VISION_PREVIEW && preview == null) {
            modelAsset = savedModelOrDefault(
                modelPrefs().getString(MODEL_KEY, null),
                availableModels(),
                detectorConfig.modelAsset,
            )
            preview = DebugPreview(activity, ::switchModel)
        }
        val session = camera
            ?: CameraSession(
                context,
                activity,
                LazyModelAnalyzer({ modelAsset }) { asset ->
                    // 디버그 빌드는 횡단보도 근처 신호등 칸 사진을 앱 폴더(Android/data/.../files/signal_captures)에 남긴다.
                    val captureDir = if (BuildConfig.VISION_PREVIEW) context.getExternalFilesDir(SIGNAL_CAPTURE_DIR) else null
                    LiteRtDetector.load(context, detectorConfig, asset, captureDir) { nearCrosswalk }
                },
                ::onDetections,
                preview?.view,
            ).also { camera = it }
        session.setHighRes(nearCrosswalk)
        session.start(
            onStarted = {
                running = true
                preview?.show()
                call.resolve()
            },
            onFailed = { error ->
                // CameraX 원문 오류는 로그에만 남기고 화면에는 안내 문장을 보낸다.
                Log.w(TAG, "카메라를 켜지 못했습니다", error)
                call.reject(CAMERA_FAILED, CAMERA_FAILED_CODE)
            },
        )
    }

    /** 디버그 빌드에서 다음 비교 모델로 바꾸고 기억한다. 다음 프레임부터 새 모델로 추론한다. 메인 스레드에서 부른다 */
    private fun switchModel() {
        val next = nextModel(detectorConfig.compareModels, availableModels(), modelAsset)
        if (next == null) {
            Toast.makeText(context, "비교할 모델 파일이 없습니다", Toast.LENGTH_SHORT).show()
            return
        }
        modelAsset = next.asset
        modelPrefs().edit().putString(MODEL_KEY, next.asset).apply()
        Log.i(TAG, "비교할 모델을 바꿨습니다: ${next.label} ${next.asset}")
        Toast.makeText(context, "모델 ${next.label}", Toast.LENGTH_SHORT).show()
    }

    private fun modelPrefs() = context.getSharedPreferences(MODEL_PREFS, Context.MODE_PRIVATE)

    /** assets 에 실제로 있는 모델 경로. 가중치는 커밋하지 않아 빌드마다 다를 수 있다 */
    private fun availableModels(): Set<String> {
        val folder = detectorConfig.modelAsset.substringBeforeLast('/')
        return context.assets.list(folder).orEmpty().map { "$folder/$it" }.toSet()
    }

    @PluginMethod
    fun stop(call: PluginCall) {
        running = false
        walkSpeedMps = null
        walkSpeedAtMs = 0L
        camera?.stop()
        activity.runOnUiThread { preview?.hide() }
        call.resolve()
    }

    @PluginMethod
    fun setWalkSpeed(call: PluginCall) {
        // speedMps 가 없거나 null 이면 걸음 속도를 모르는 것이다(위치 오차가 크거나 위치가 없음).
        val speed = call.getDouble("speedMps")
        if (speed != null && !speed.isFinite()) return call.reject("걸음 속도가 올바르지 않습니다: $speed")
        walkSpeedMps = speed?.coerceAtLeast(0.0)
        walkSpeedAtMs = SystemClock.elapsedRealtime()
        call.resolve()
    }

    @PluginMethod
    fun setNearCrosswalk(call: PluginCall) {
        val near = call.getBoolean("near") ?: return call.reject("횡단보도 근처인지(near)가 없습니다")
        nearCrosswalk = near
        mainHandler.removeCallbacks(lowerResolution)
        if (near) {
            camera?.setHighRes(true)
        } else {
            mainHandler.postDelayed(lowerResolution, visionConfig.highResOffDelayMs)
        }
        call.resolve()
    }

    /** 걸음 속도를 받은 지 walkSpeedStaleMs 가 지났으면 위치가 끊긴 것으로 보고 모르는 것(null)으로 본다 */
    private fun currentWalkSpeedMps(): Double? =
        if (SystemClock.elapsedRealtime() - walkSpeedAtMs > visionConfig.walkSpeedStaleMs) null else walkSpeedMps

    @PluginMethod
    fun setMode(call: PluginCall) {
        val requested = call.getString("mode")
        mode = VisionMode.fromWire(requested)
            ?: return call.reject("지원하지 않는 모드입니다: $requested")
        call.resolve(JSObject().put("mode", mode.wire))
    }

    override fun handleOnDestroy() {
        running = false
        mainHandler.removeCallbacks(lowerResolution)
        camera?.close()
        camera = null
        preview?.remove()
        preview = null
        super.handleOnDestroy()
    }

    /**
     * 추론 한 번의 박스를 판단해 화면으로 보낸다. 카메라 분석 스레드에서 부른다.
     * 사람은 인파·정면 접근으로, 그 밖의 클래스는 장애물 알림과 신호등 상태로 보낸다.
     */
    @Synchronized
    private fun onDetections(detected: DetectionFrame) {
        if (!running) return
        val frame = detected.copy(walkSpeedMps = currentWalkSpeedMps())
        val crowd = analyzer.analyze(frame)
        val objects = objectAnalyzer.analyze(frame)
        emitCrowdState(crowd.frame.copy(signal = objects.signal, signalId = objects.signalId, obstacles = objects.seen))
        crowd.alert?.let(::emitAlert)
        objects.alerts.forEach(::emitAlert)
        // 실기기에서 차 움직임 기준을 맞추려고 추적 중인 차를 프레임마다 남긴다. 튜닝용이라 릴리스 전에 지우거나 디버그 빌드에서만 남긴다.
        objects.vehicles.forEach { Log.d(TAG, vehicleLog(it, frame.walkSpeedMps)) }
        // 어느 신호등을 따라갔는지 보려고 새로 고르거나 상태가 바뀔 때 박스 위치·크기를 남긴다(#132).
        if (objects.signalPicked || objects.signal != loggedSignal) {
            Log.d(TAG, signalLog(objects))
            loggedSignal = objects.signal
        }
    }

    private fun signalLog(objects: ObjectAnalysis): String {
        val box = objects.signalBox?.let {
            "%s 가운데 %.2f 위 %.2f 크기 %.3fx%.3f 점수 %.2f".format(
                it.kind.wire, it.centerX, it.top, it.width, it.height, it.score,
            )
        } ?: "못 잡음"
        val picked = if (objects.signalPicked) " (새로 고름)" else ""
        return "신호등 #${objects.signalId} 상태 ${objects.signal?.wire ?: "없음"}, 박스 $box$picked"
    }

    private fun vehicleLog(state: VehicleState, walkSpeedMps: Double?): String {
        fun fmt(value: Double?) = value?.let { "%.1f".format(it) } ?: "-"
        return "차 #${state.id} ${state.kind.wire} 거리 ${fmt(state.distanceM)}m 옆 ${fmt(state.lateralM)}m " +
            "내 걸음 ${fmt(walkSpeedMps)}m/s 다가옴 ${fmt(state.approachMps)}m/s 안쪽 ${fmt(state.inwardMps)}m/s ${state.motion.wire}"
    }

    private fun emitCrowdState(frame: CrowdFrame) {
        if (!running) return
        // 실기기에서 판단이 맞는지 보려고 단계·신호등이 바뀔 때만 로그로 남긴다.
        val state = frame.level to frame.signal
        if (state != loggedState) {
            Log.d(TAG, "인파 단계 ${frame.level.wire}, 신호등 ${frame.signal?.wire ?: "없음"}")
            loggedState = state
        }
        notifyListeners("crowdState", frame.toJs())
    }

    private fun emitAlert(alert: VisionAlert) {
        if (!running) return
        val distance = alert.distanceM?.let { " %.1fm".format(it) } ?: ""
        val moving = alert.moving?.let { if (it) " 움직임" else " 서 있음" } ?: ""
        Log.d(
            TAG,
            "알림 ${alert.kind.wire} ${alert.objectClass?.wire ?: ""} ${alert.direction?.let { "${it}시" } ?: ""}$distance$moving",
        )
        notifyListeners("alert", alert.toJs())
    }

    companion object {
        const val CAMERA = "camera"
        private const val TAG = "SaitgilVision"
        private const val SIGNAL_CAPTURE_DIR = "signal_captures"
        // 사용자가 카메라 권한 창에서 거부한 적이 있는지 적어 두는 저장소
        private const val PREFS = "saitgil_vision"
        private const val KEY_CAMERA_DENIED = "camera_denied"
        // 디버그 빌드에서 고른 비교 모델을 기억하는 곳
        private const val MODEL_PREFS = "saitgil_vision_debug"
        private const val MODEL_KEY = "model_asset"
        // 실패 설명. 로그·디버깅용이며 사용자에게 읽지 않는다.
        // 사용자에게 읽는 문장은 화면(visionAlerts.ts)이 아래 코드를 보고 정한다.
        private const val CAMERA_DENIED = "카메라 권한 거부"
        private const val CAMERA_BLOCKED = "카메라 권한 거부(다시 묻지 않음)"
        private const val CAMERA_FAILED = "카메라 시작 실패"

        // 화면(vision.ts)이 실패 종류를 가려 안내 문장을 고르는 코드. 화면 쪽 값과 같아야 한다.
        private const val CAMERA_DENIED_CODE = "CAMERA_DENIED"
        private const val CAMERA_BLOCKED_CODE = "CAMERA_BLOCKED"
        private const val CAMERA_FAILED_CODE = "CAMERA_FAILED"
    }
}
