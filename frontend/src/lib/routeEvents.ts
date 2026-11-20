// 경로 위 이벤트(회전, 횡단보도, 계단, 혼잡 구간 시작 등) 중 지금 미리 알릴 것을 고른다.
// 이벤트 목록은 백엔드(core/route_events.py)가 고른 경로마다 만들어 준다.

import {
    ALERT_DISTANCE_M,
    BLOCK_MIN_M,
    CROSSWALK_SIGNAL_M,
    type CrosswalkSignalSettings,
} from '../settings';
import type { LngLat } from './geo';

export type EventKind =
    | 'turn'
    | 'crosswalk'
    | 'stairs'
    | 'ramp'
    | 'overpass'
    | 'underpass'
    | 'elevator'
    | 'crowd'
    | 'destination';

/** sharp_left 8시, slight_left 10시, slight_right 2시, sharp_right 4시 방향 */
export type Direction =
    | 'left'
    | 'right'
    | 'uturn'
    | 'sharp_left'
    | 'slight_left'
    | 'slight_right'
    | 'sharp_right';

export type RouteEvent = {
    kind: EventKind;
    /** 출발점부터 경로를 따라 이벤트 지점까지 거리(m) */
    distance_m: number;
    position: LngLat;
    direction: Direction | null;
};

// 좌표를 이 자릿수로 맞춰 이벤트 이름을 짓는다. 소수 5자리는 약 1m 다.
const KEY_DIGITS = 5;

/** 경로를 다시 찾아도 같은 지점의 이벤트는 같은 이름이 되도록 좌표로 부른다. */
export function eventKey({
    kind,
    position: [lng, lat],
    direction,
}: RouteEvent) {
    return `${kind}:${lng.toFixed(KEY_DIGITS)},${lat.toFixed(KEY_DIGITS)}:${direction ?? ''}`;
}

/** 지나지 않았고, 남은 거리가 알림 거리 안이며, 아직 알리지 않은 이벤트. 가까운 것부터 */
export function dueEvents(
    events: readonly RouteEvent[],
    travelledM: number,
    announced: ReadonlySet<string>,
    alertDistanceM: Readonly<Record<EventKind, number>> = ALERT_DISTANCE_M,
): RouteEvent[] {
    return events
        .filter((event) => {
            const remainingM = event.distance_m - travelledM;
            return (
                remainingM >= 0 &&
                remainingM <= alertDistanceM[event.kind] &&
                !announced.has(eventKey(event))
            );
        })
        .sort((a, b) => a.distance_m - b.distance_m);
}

/** 블럭 단위로 알리는 이벤트인지. 회전·횡단보도만 블럭 끝(교차로)으로 본다. */
export function isBlockEnd({ kind }: RouteEvent): boolean {
    return kind === 'turn' || kind === 'crosswalk';
}

/**
 * 지금 블럭 시작을 알릴 교차로 이벤트. 없으면 null.
 * 블럭은 직전 교차로(없으면 출발점)부터 이 교차로까지다. 직전 교차로를 지났고, 블럭이 minBlockM 이상이며,
 * 교차로가 아직 알림 거리 밖이고, 아직 알리지 않았을 때만 낸다. 짧은 블럭·막 닿은 교차로는 "곧"만 읽는다.
 */
export function dueBlockStart(
    events: readonly RouteEvent[],
    travelledM: number,
    announced: ReadonlySet<string>,
    minBlockM: number = BLOCK_MIN_M,
    alertDistanceM: Readonly<Record<EventKind, number>> = ALERT_DISTANCE_M,
): RouteEvent | null {
    const ends = events
        .filter(isBlockEnd)
        .sort((a, b) => a.distance_m - b.distance_m);
    const index = ends.findIndex((event) => event.distance_m >= travelledM);
    if (index < 0) {
        return null;
    }
    const event = ends[index];
    const startM = index > 0 ? ends[index - 1].distance_m : 0;
    if (
        event.distance_m - startM < minBlockM ||
        event.distance_m - travelledM <= alertDistanceM[event.kind] ||
        announced.has(blockKey(event))
    ) {
        return null;
    }
    return event;
}

/** 블럭 시작 알림의 이름. 같은 교차로의 블럭 안내는 한 번만 읽는다. */
export function blockKey(event: RouteEvent): string {
    return `block:${eventKey(event)}`;
}

/** 횡단보도 앞(남은 거리가 aheadM 안)이거나 막 지난(pastM 안) 곳에 있는지. 보행 신호등을 알릴지 정한다. */
export function nearCrosswalk(
    events: readonly RouteEvent[],
    travelledM: number,
    settings: CrosswalkSignalSettings = CROSSWALK_SIGNAL_M,
): boolean {
    return events.some((event) => {
        const remainingM = event.distance_m - travelledM;
        return (
            event.kind === 'crosswalk' &&
            remainingM <= settings.aheadM &&
            remainingM >= -settings.pastM
        );
    });
}
