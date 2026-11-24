// 경로 위 이벤트(회전, 횡단보도, 계단, 혼잡 구간 시작 등) 중 지금 미리 알릴 것을 고른다.
// 이벤트 목록은 백엔드(core/route_events.py)가 고른 경로마다 만들어 준다.

import {
    ALERT_DISTANCE_M,
    BLOCK,
    type BlockSettings,
    CROSSING_FACING,
    type CrossingFacingSettings,
    CROSSWALK_SIGNAL_M,
    type CrosswalkSignalSettings,
} from '../settings';
import { bearingDeg, distanceM, type LngLat } from './geo';
import { angleDiff } from './heading';
import type { RouteLine } from './navigation';

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

/** 블럭 안내 알림의 이름. 같은 교차로의 블럭·거리 안내는 각각 한 번만 읽는다. */
export function blockKey(event: RouteEvent, far: boolean): string {
    return `${far ? 'far' : 'block'}:${eventKey(event)}`;
}

export type BlockAlert = {
    event: RouteEvent;
    /** true 면 교차로가 멀어 블럭 대신 미터로 알린다. */
    far: boolean;
};

/**
 * 지금 알릴 블럭 안내. 다음 교차로(회전·횡단보도) 하나만 본다. 없으면 null.
 * 교차로까지 남은 거리가 settings.maxM 이하면 "이번 블럭", 더 멀면 미터로 한 번씩 알린다.
 * "곧" 안내 전까지 걸을 거리가 settings.minWalkM 보다 짧으면(짧은 블럭, 이미 가까이 와서 시작한 블럭) 내지 않는다.
 * 방금 지난 횡단보도를 아직 다 건너지 못했으면(settings.crosswalkWidthM 안) 새 블럭에 들어온 것이 아니므로 내지 않는다.
 */
export function dueBlockAlert(
    events: readonly RouteEvent[],
    travelledM: number,
    announced: ReadonlySet<string>,
    settings: BlockSettings = BLOCK,
    alertDistanceM: Readonly<Record<EventKind, number>> = ALERT_DISTANCE_M,
): BlockAlert | null {
    const crossing = events.some(
        (end) =>
            end.kind === 'crosswalk' &&
            end.distance_m < travelledM &&
            travelledM < end.distance_m + settings.crosswalkWidthM,
    );
    if (crossing) {
        return null;
    }
    const event = events
        .filter((end) => isBlockEnd(end) && end.distance_m >= travelledM)
        .reduce<RouteEvent | null>(
            (nearest, end) =>
                !nearest || end.distance_m < nearest.distance_m ? end : nearest,
            null,
        );
    if (!event) {
        return null;
    }
    const remainingM = event.distance_m - travelledM;
    const walkM = remainingM - alertDistanceM[event.kind];
    const far = remainingM > settings.maxM;
    if (walkM < settings.minWalkM || announced.has(blockKey(event, far))) {
        return null;
    }
    return { event, far };
}

/** 횡단보도 앞(남은 거리가 aheadM 안)이거나 막 지난(pastM 안) 곳의 횡단보도 중 가장 가까운 것. 없으면 null */
export function nearestCrosswalk(
    events: readonly RouteEvent[],
    travelledM: number,
    settings: CrosswalkSignalSettings = CROSSWALK_SIGNAL_M,
): RouteEvent | null {
    const gap = (event: RouteEvent) => Math.abs(event.distance_m - travelledM);
    return events
        .filter((event) => {
            const remainingM = event.distance_m - travelledM;
            return (
                event.kind === 'crosswalk' &&
                remainingM <= settings.aheadM &&
                remainingM >= -settings.pastM
            );
        })
        .reduce<RouteEvent | null>(
            (nearest, event) =>
                nearest === null || gap(event) < gap(nearest) ? event : nearest,
            null,
        );
}

/** 횡단보도 앞(남은 거리가 aheadM 안)이거나 막 지난(pastM 안) 곳에 있는지. 보행 신호등을 알릴지 정한다. */
export function nearCrosswalk(
    events: readonly RouteEvent[],
    travelledM: number,
    settings: CrosswalkSignalSettings = CROSSWALK_SIGNAL_M,
): boolean {
    return nearestCrosswalk(events, travelledM, settings) !== null;
}

/** 경로를 따라 alongM 간 지점. 출발점보다 앞이면 출발점, 끝을 넘으면 도착점이다 */
function pointAlong(
    { coordinates, distances_m }: RouteLine,
    alongM: number,
): LngLat {
    const next = distances_m.findIndex((distance) => distance >= alongM);
    if (next === -1) {
        return coordinates[coordinates.length - 1];
    }
    if (next === 0) {
        return coordinates[0];
    }
    const [from, to] = [coordinates[next - 1], coordinates[next]];
    const span = distances_m[next] - distances_m[next - 1];
    const share = span > 0 ? (alongM - distances_m[next - 1]) / span : 0;
    return [
        from[0] + (to[0] - from[0]) * share,
        from[1] + (to[1] - from[1]) * share,
    ];
}

/**
 * 가까운 횡단보도를 건너는 방향(북쪽 0도, 시계 방향).
 * Tmap 안내점은 다음 구간(횡단보도)이 시작하는 꼭짓점에 있어, 안내점에서 다음 꼭짓점(횡단보도 끝)까지를 본다.
 * 정한 거리만큼 더 가서 보면 짧은 횡단보도를 건너 바로 꺾는 길이 섞여 방향이 틀어진다. 긴 횡단보도는 lookAheadM 까지만 본다.
 * 근처에 횡단보도가 없거나 경로가 끝나 방향을 잴 수 없으면 null.
 */
export function crossingBearing(
    route: RouteLine,
    events: readonly RouteEvent[],
    travelledM: number,
    settings: CrossingFacingSettings = CROSSING_FACING,
): number | null {
    const crosswalk = nearestCrosswalk(events, travelledM);
    if (crosswalk === null) {
        return null;
    }
    const startM = crosswalk.distance_m;
    const nextVertexM = route.distances_m.find(
        (distance) => distance >= startM + settings.minSpanM,
    );
    const endM = Math.min(
        nextVertexM ?? Infinity,
        startM + settings.lookAheadM,
    );
    const start = pointAlong(route, startM);
    const end = pointAlong(route, endM);
    return distanceM(start, end) > 0 ? bearingDeg(start, end) : null;
}

/**
 * 카메라가 횡단보도를 건너는 방향을 보는지. 신호등이 경로에서 건널 횡단보도의 것인지 가릴 때 쓴다.
 * 카메라 방향이나 건너는 방향을 모르면 막지 않는다(true). 지금까지처럼 횡단보도 근처면 신호를 알린다.
 */
export function facingCrossing(
    cameraHeading: number | null,
    crossing: number | null,
    settings: CrossingFacingSettings = CROSSING_FACING,
): boolean {
    if (cameraHeading === null || crossing === null) {
        return true;
    }
    return Math.abs(angleDiff(cameraHeading, crossing)) <= settings.maxDeg;
}
