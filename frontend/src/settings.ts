// 길안내·알림 설정값. 모두 초안 값이며, 실제 보행 테스트로 맞춘다.
// 접근성 설정(음성 속도 등)과 달리 사용자가 바꾸지 않는다.

import type { AlertLevel } from './lib/alertArbiter';
import type { EventKind } from './lib/routeEvents';

export const NAVIGATION = {
    // 경로 선에서 이보다 멀면 벗어난 것으로 본다. 위치 오차가 더 크면 오차만큼 봐준다.
    offRouteM: 25,
    // 경로 끝(건물 입구)까지 이만큼 남으면 도착. 이보다 먼 20m 앞은 미리 알림이 알린다.
    arrivalM: 8,
    // 위치 오차가 크면 오차만큼 도착 거리를 넓혀 안내가 끝나지 않는 것을 막는다. 넓히는 상한.
    arrivalMaxM: 15,
    // 오차가 이보다 큰 위치로는 이탈·도착을 판단하지 않는다 (실내, Wi-Fi 기반 위치 등).
    maxAccuracyM: 50,
    // 이 시간(ms) 동안 이어서 벗어나야 경로를 다시 찾는다. 건물에 반사돼 잠깐 옆 길로 잡히는 것은 넘긴다.
    // 위치를 받는 간격과 상관없이 같게 횟수가 아닌 시간으로 잰다.
    // 오차가 커서(maxAccuracyM) 판단하지 못한 동안은 세지 않고, 그 전까지 잰 시간은 남긴다.
    offRouteMs: 8_000,
    // 다시 찾은 곳에서 이만큼 움직이기 전에는 또 찾지 않는다.
    rerouteMinMoveM: 30,
    // 사람이 걸어서 낼 수 있는 가장 빠른 속력(m/s). 직전 진행 위치에서
    // (이 속력 × 지난 시간 + 위치 오차)만큼 앞뒤 경로에서만 내 위치를 찾는다.
    // 나란히 붙은 다른 구간(길 건너 반대편 인도 등)으로 건너뛰지 않게 한다.
    maxWalkSpeedMps: 3,
} as const;

export type NavigationSettings = typeof NAVIGATION;

// 앱(Android)에서 위치를 받는 간격(ms). 플러그인 기본값은 5~10초라 걸으면 위치가 한 번에 크게 옮겨 간다.
// 짧을수록 위치가 촘촘히 따라오고 튄 위치를 거르는 범위(LOCATION_FILTER)도 좁아지지만 배터리를 더 쓴다.
export const LOCATION_WATCH_INTERVAL_MS = 1_000;

// 안내 중 받은 GPS 위치 거르기
export const LOCATION_FILTER = {
    // 마지막 위치에서 (이 속력 × 지난 시간 + 새 위치 오차)보다 멀면 튄 위치로 보고 버린다(m/s).
    maxSpeedMps: NAVIGATION.maxWalkSpeedMps,
    // 튄 위치가 이 시간(ms) 동안 이어서 오면 실제로 옮겨 간 것으로 받아들인다.
    // 위치를 받는 간격과 상관없이 같게 시간으로 잰다.
    jumpConfirmMs: 10_000,
    // 시간이 지나도 튄 위치를 이 횟수만큼은 받아야 받아들인다.
    // 위치가 끊겼다가 튄 위치가 한 번 더 온 것만으로 옮기지 않게 한다.
    jumpConfirmFixes: 3,
    // 멈춘 곳에서 이 거리(오차가 더 작으면 오차) 안에서만 흔들리면 멈춰 있는 것으로 본다(m).
    // 크면 걷기 시작해도 늦게 따라가고, 작으면 멈춰 있어도 움직이는 것으로 나온다.
    stillRadiusM: 5,
} as const;

export type LocationFilterSettings = typeof LOCATION_FILTER;

// 내 위치 마커의 방향(나침반 + GPS 보정)
export const HEADING = {
    // GPS 속력이 이보다 빠르면 걷는 중으로 보고 진행 방향을 믿는다(m/s).
    minWalkSpeedMps: 0.7,
    // 걷는 중 위치를 받을 때마다 나침반 보정값을 GPS 쪽으로 옮기는 비율(0~1)
    offsetLearnRate: 0.2,
    // 나침반 값이 올 때마다 새 값 쪽으로 옮기는 비율(0~1). 작을수록 덜 떨린다.
    smoothing: 0.3,
    // 이보다 적게 바뀌면 마커를 다시 돌리지 않는다(도).
    minStepDeg: 2,
} as const;

// 이벤트까지 남은 거리가 이 안에 들어오면 미리 알린다.
export const ALERT_DISTANCE_M: Readonly<Record<EventKind, number>> = {
    turn: 10,
    crosswalk: 10,
    stairs: 20,
    ramp: 20,
    overpass: 30,
    underpass: 30,
    elevator: 20,
    crowd: 300,
    destination: 20,
};

// 남은 거리가 이보다 짧으면 "곧"이라고 읽는다.
export const NEAR_M = 10;

// 블럭(회전·횡단보도 사이 구간) 안내. 자체 도로망이 없어 Tmap 이 주는 교차로(회전·횡단보도)만 블럭 경계로 본다.
export const BLOCK = {
    // "곧" 안내 전까지 이만큼 걸을 거리가 남아야 블럭 안내를 한다(m).
    // 이보다 짧으면 블럭 안내 직후 "곧"이 또 나오므로 "곧 ○○"만 읽는다.
    minWalkM: 20,
    // 교차로까지 남은 거리가 이보다 길면 블럭 대신 미터로 알린다(m).
    // Tmap 안내점이 없어 한 블럭이 수백 m 로 묶일 수 있어, 이 안에 들어오면 그때 블럭으로 다시 알린다.
    maxM: 150,
    // 횡단보도 안내점은 건너기 직전 지점이라, 이만큼 더 걸어야 다 건넌 것으로 본다(m).
    // 건너는 중에는 다음 블럭 안내를 내지 않는다. 실기기에서 맞출 초안 값.
    crosswalkWidthM: 15,
} as const;

export type BlockSettings = typeof BLOCK;

// 같은 알림(key)을 다시 읽기 전에 기다리는 시간
export const ALERT_COOLDOWN_MS: Readonly<Record<AlertLevel, number>> = {
    danger: 3_000,
    route: 10_000,
    crowd: 30_000,
};

// 안내 중 위치를 놓쳤다는 말을 다시 하기 전에 기다리는 시간.
// 건물 사이처럼 신호가 잡혔다 놓쳤다 해도 이보다 자주 읽지 않는다.
export const LOCATION_LOST_COOLDOWN_MS = 30_000;

// 한 문장을 읽는 중으로 보는 가장 긴 시간. 끝 이벤트를 놓쳐도 이보다 오래 알림을 미루지 않는다.
export const SPEECH_BUSY_MAX_MS = 15_000;

// 음성 명령을 듣기 전에 블루투스 이어폰 마이크 연결을 기다리는 가장 긴 시간(ms).
// 넘으면 폰 마이크로 듣는다. 그동안은 듣기 시작이 늦어진다. 실기기에서 맞출 초안 값.
export const BLUETOOTH_MIC_CONNECT_MS = 3_000;

// 카메라 인파 인식 알림
export const VISION = {
    // 같은 단계·같은 빈 방향이 이만큼 연달아 나와야 믿는다. 한 프레임 튀는 것은 넘긴다.
    confirmFrames: 3,
    // 위험(정면 1m 안 사람)은 이만큼만 보여도 알린다. 늦으면 이미 부딪힌 뒤라 한 프레임 잘못 잡힌 것도 알린다.
    dangerFrames: 1,
    // 위험이 이만큼 이어지면 멈추라는 말 대신 가장자리로 비키라고 한다(ms).
    sustainedDangerMs: 5_000,
    // 가장자리로 비키라는 말을 다시 하기 전에 기다리는 시간(ms)
    moveAsideCooldownMs: 20_000,
    // 장애물 알림은 읽던 말이 이보다 길게 이어지면 버린다(ms). 걸으며 지나치기 전에 읽어야 한다. 실기기에서 맞출 초안 값.
    obstacleMaxWaitMs: 1_500,
    // 횡단보도 근처에서 GPS 속력이 이보다 느리면 신호를 기다리며 서 있는 것으로 본다(m/s). 멈춰 있으면 속력이 아예 안 올 수도 있다.
    waitingSpeedMps: 0.5,
    // 차의 움직임에서 뺄 걸음 속도(GPS 속력)의 상한(m/s). 걸음으로 볼 수 없는 속력은 이 값으로 자른다.
    walkSpeedMaxMps: 2,
    // GPS 위치 오차가 이 반경(m)보다 크면 속력을 믿지 않고 걸음 속도를 0 으로 본다. 실기기에서 맞출 초안 값.
    walkSpeedMaxAccuracyM: 20,
} as const;

export type VisionSettings = typeof VISION;

// 길안내 중 횡단보도 근처에서만 카메라가 본 보행 신호등을 알린다.
export const CROSSWALK_SIGNAL_M = {
    // 횡단보도까지 남은 거리가 이 안이면 알린다. 횡단보도 미리 알림(ALERT_DISTANCE_M)보다 넉넉히 둔다.
    aheadM: 30,
    // 횡단보도 지점을 이만큼 지나도 알린다. 횡단보도 앞에 서 있어도 GPS 가 앞뒤로 튀어서다.
    pastM: 10,
};

export type CrosswalkSignalSettings = typeof CROSSWALK_SIGNAL_M;

// 인파가 주의 단계가 됐을 때 말 없이 주는 짧은 진동(ms)
export const CAUTION_VIBRATION: readonly number[] = [150];

// 알림 종류별 진동 패턴 [진동, 멈춤, 진동, …](ms). 접근성 설정의 진동 세기만큼 늘이고 줄인다.
export const VIBRATION_PATTERNS: Readonly<Record<AlertLevel, number[]>> = {
    danger: [400, 100, 400, 100, 400],
    route: [200, 100, 200],
    crowd: [300],
};

// 안내 중 화면 아무 곳이나 두 번 탭하면 말하기(마이크)를 켠다.
export const DOUBLE_TAP = {
    // 두 탭 사이가 이보다 길면 따로 누른 것으로 본다(ms).
    maxIntervalMs: 350,
    // 두 탭 위치가 이보다 멀면 따로 누른 것으로 본다(px).
    maxDistancePx: 40,
} as const;

export type DoubleTapSettings = typeof DOUBLE_TAP;
