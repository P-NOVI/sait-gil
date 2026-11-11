// 음성·진동·화면 유지·위치·카메라 같은 기기 기능은 이 폴더를 통해서만 쓴다.
// 웹(PWA)에서는 Web API, 앱(Capacitor)에서는 네이티브 플러그인을 고른다.
export { vibrate } from './haptics';
export { allowScreenOff, keepScreenOn } from './keepAwake';
export { listenOnce } from './listen';
export {
    getCurrentPosition,
    LocationError,
    type LocationFix,
    watchLocation,
} from './location';
export { isNativeApp, SPEECH_LANG } from './runtime';
export { speak, stopSpeaking } from './speech';
export { readStored, writeStored } from './storage';
export {
    type ClockDirection,
    type CrowdLevel,
    startVision,
    VISION_NOT_READY,
    visionAvailable,
    type VisionFrame,
} from './vision';
