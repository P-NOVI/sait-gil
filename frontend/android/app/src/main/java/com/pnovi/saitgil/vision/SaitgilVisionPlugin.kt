package com.pnovi.saitgil.vision

import android.Manifest
import android.os.SystemClock
import android.util.Log
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

    // 안내마다 새로 만들어 지난 안내의 사람 추적·장애물·신호등 기록을 이어 쓰지 않는다.
    private var analyzer = CrowdAnalyzer()
    private var objectAnalyzer = ObjectAnalyzer()

    // 화면이 GPS 로 알려 주는 사용자 걸음 속도(m/s)와 받은 시각. 카메라 분석 스레드가 읽으므로 @Volatile 이다.
    @Volatile
    private var walkSpeedMps = 0.0

    @Volatile
    private var walkSpeedAtMs = 0L

    // 마지막으로 로그에 남긴 인파 단계·신호등 상태
    private var loggedState: Pair<CrowdLevel, SignalState?>? = null

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
            requestPermissionForAlias(CAMERA, call, "cameraPermissionResult")
        }
    }

    @PermissionCallback
    private fun cameraPermissionResult(call: PluginCall) {
        if (getPermissionState(CAMERA) == PermissionState.GRANTED) {
            startCamera(call)
        } else {
            call.reject(CAMERA_DENIED, CAMERA_DENIED_CODE)
        }
    }

    // 미리보기 뷰를 만들고 보여 주는 일이 있어 메인 스레드에서 처리한다.
    private fun startCamera(call: PluginCall) = activity.runOnUiThread {
        if (BuildConfig.VISION_PREVIEW && preview == null) {
            preview = DebugPreview(activity)
        }
        val session = camera
            ?: CameraSession(
                context,
                activity,
                LazyModelAnalyzer { LiteRtDetector.load(context) },
                ::onDetections,
                preview?.view,
            ).also { camera = it }
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

    @PluginMethod
    fun stop(call: PluginCall) {
        running = false
        walkSpeedMps = 0.0
        walkSpeedAtMs = 0L
        camera?.stop()
        activity.runOnUiThread { preview?.hide() }
        call.resolve()
    }

    @PluginMethod
    fun setWalkSpeed(call: PluginCall) {
        val speed = call.getDouble("speedMps")
        if (speed == null || !speed.isFinite()) return call.reject("걸음 속도가 올바르지 않습니다: $speed")
        walkSpeedMps = speed.coerceAtLeast(0.0)
        walkSpeedAtMs = SystemClock.elapsedRealtime()
        call.resolve()
    }

    /** 걸음 속도를 받은 지 walkSpeedStaleMs 가 지났으면 위치가 끊긴 것으로 보고 0 이다 */
    private fun currentWalkSpeedMps(): Double =
        if (SystemClock.elapsedRealtime() - walkSpeedAtMs > visionConfig.walkSpeedStaleMs) 0.0 else walkSpeedMps

    @PluginMethod
    fun setMode(call: PluginCall) {
        val requested = call.getString("mode")
        mode = VisionMode.fromWire(requested)
            ?: return call.reject("지원하지 않는 모드입니다: $requested")
        call.resolve(JSObject().put("mode", mode.wire))
    }

    override fun handleOnDestroy() {
        running = false
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
        emitCrowdState(crowd.frame.copy(signal = objects.signal, obstacles = objects.seen))
        crowd.alert?.let(::emitAlert)
        objects.alerts.forEach(::emitAlert)
        // 실기기에서 차 움직임 기준을 맞추려고 추적 중인 차를 프레임마다 남긴다. 튜닝용이라 릴리스 전에 지우거나 디버그 빌드에서만 남긴다.
        objects.vehicles.forEach { Log.d(TAG, vehicleLog(it, frame.walkSpeedMps)) }
    }

    private fun vehicleLog(state: VehicleState, walkSpeedMps: Double): String {
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
        // 실패 설명. 로그·디버깅용이며 사용자에게 읽지 않는다.
        // 사용자에게 읽는 문장은 화면(visionAlerts.ts)이 아래 코드를 보고 정한다.
        private const val CAMERA_DENIED = "카메라 권한 거부"
        private const val CAMERA_FAILED = "카메라 시작 실패"

        // 화면(vision.ts)이 실패 종류를 가려 안내 문장을 고르는 코드. 화면 쪽 값과 같아야 한다.
        private const val CAMERA_DENIED_CODE = "CAMERA_DENIED"
        private const val CAMERA_FAILED_CODE = "CAMERA_FAILED"
    }
}
