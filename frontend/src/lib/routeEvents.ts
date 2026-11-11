// 경로 위 이벤트(회전, 횡단보도, 계단, 혼잡 구간 시작 등) 중 지금 미리 알릴 것을 고른다.
// 이벤트 목록은 백엔드(core/route_events.py)가 고른 경로마다 만들어 준다.

import { ALERT_DISTANCE_M } from '../settings';
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
