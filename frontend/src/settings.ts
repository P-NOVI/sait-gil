// 길안내·알림 설정값. 모두 초안 값이며, 실제 보행 테스트로 맞춘다.
// 접근성 설정(음성 속도 등)과 달리 사용자가 바꾸지 않는다.

import type { AlertLevel } from './lib/alertArbiter';
import type { EventKind } from './lib/routeEvents';

export const NAVIGATION = {
    // 경로 선에서 이보다 멀면 벗어난 것으로 본다. 위치 오차가 더 크면 오차만큼 봐준다.
    offRouteM: 25,
    // 경로 끝까지 이만큼 남으면 도착
    arrivalM: 20,
    // 오차가 이보다 큰 위치로는 이탈·도착을 판단하지 않는다 (실내, Wi-Fi 기반 위치 등).
    maxAccuracyM: 50,
    // 이 횟수만큼 연달아 벗어나야 경로를 다시 찾는다. 위치가 한 번 튀는 것은 넘긴다.
    offRouteFixes: 2,
    // 다시 찾은 곳에서 이만큼 움직이기 전에는 또 찾지 않는다.
    rerouteMinMoveM: 30,
} as const;

export type NavigationSettings = typeof NAVIGATION;

// 이벤트까지 남은 거리가 이 안에 들어오면 미리 알린다.
export const ALERT_DISTANCE_M: Readonly<Record<EventKind, number>> = {
    turn: 20,
    crosswalk: 20,
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

// 같은 알림(key)을 다시 읽기 전에 기다리는 시간
export const ALERT_COOLDOWN_MS: Readonly<Record<AlertLevel, number>> = {
    danger: 3_000,
    route: 10_000,
    crowd: 30_000,
};
