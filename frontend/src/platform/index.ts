// 음성·진동·화면 유지·위치·카메라 같은 기기 기능은 이 폴더를 통해서만 쓴다.
// 웹(PWA)에서는 Web API, 앱(Capacitor)에서는 네이티브 플러그인을 고른다.
export { canOpenAppSettings, openAppSettings } from './appSettings';
export { requestCompassPermission, watchCompass } from './compass';
export { vibrate } from './haptics';
export { allowScreenOff, keepScreenOn } from './keepAwake';
export { canListen, listenOnce, stopListening } from './listen';
export {
    APPROXIMATE_TEXT,
    getCurrentPosition,
    isLocationDenied,
    LocationError,
    type LocationFix,
    watchLocation,
} from './location';
export { isNativeApp, SPEECH_LANG } from './runtime';
export { speak, stopSpeaking } from './speech';
export { watchSteps } from './steps';
export { readStored, writeStored } from './storage';
export {
    type ClockDirection,
    type CrowdLevel,
    type ObstacleKind,
    type PedSignal,
    setVisionWalkSpeed,
    startVision,
    VISION_NOT_READY,
    visionAvailable,
    type VisionApproach,
    type VisionFailure,
    visionFailure,
    type VisionFrame,
    type VisionLevel,
    type VisionObstacle,
} from './vision';
