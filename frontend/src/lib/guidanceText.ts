// 미리 알림 이벤트를 읽어 줄 문장으로 바꾼다.

import { NEAR_M } from '../settings';
import {
    type Direction,
    type EventKind,
    isBlockEnd,
    type RouteEvent,
} from './routeEvents';

export const ARRIVED_TEXT = '목적지에 도착했습니다.';
// 도착하면 이 말을 끝으로 안내를 끝낸다.
export const ARRIVED_END_TEXT = `${ARRIVED_TEXT} 안내를 종료합니다.`;
export const REROUTE_TEXT = '경로를 벗어났습니다. 경로를 다시 찾습니다.';

const DIRECTION_LABELS: Record<Direction, string> = {
    left: '왼쪽',
    right: '오른쪽',
    uturn: '유턴',
    sharp_left: '8시 방향',
    slight_left: '10시 방향',
    slight_right: '2시 방향',
    sharp_right: '4시 방향',
};

// 지점 이름과 조사
const PLACE_NAMES: Record<
    Exclude<EventKind, 'turn' | 'crowd'>,
    [string, string]
> = {
    crosswalk: ['횡단보도', '가'],
    stairs: ['계단', '이'],
    ramp: ['경사로', '가'],
    overpass: ['육교', '가'],
    underpass: ['지하보도', '가'],
    elevator: ['엘리베이터', '가'],
    destination: ['목적지', '가'],
};

/** 읽기 좋은 거리. 10m 단위로 반올림하고 1km 부터는 킬로미터 */
export function spokenDistance(meters: number): string {
    if (meters >= 1000) {
        return `${(meters / 1000).toFixed(1)}킬로미터`;
    }
    return `${Math.max(10, Math.round(meters / 10) * 10)}미터`;
}

/** 이 블럭이 끝나는 교차로 이벤트의 블럭 시작 안내 문장 */
export function blockText({ kind, direction }: RouteEvent): string {
    if (kind === 'turn') {
        const label = direction ? DIRECTION_LABELS[direction] : '방향 전환';
        return `이번 블럭에서 ${label}입니다.`;
    }
    const [name, particle] = PLACE_NAMES.crosswalk;
    const place = direction ? `${DIRECTION_LABELS[direction]} ${name}` : name;
    return `이번 블럭 끝에 ${place}${particle} 있습니다.`;
}

/** 남은 거리가 remainingM 인 이벤트의 안내 문장. 회전·횡단보도는 거리 없이 "곧"으로 읽는다. */
export function eventText(
    { kind, direction }: RouteEvent,
    remainingM: number,
    nearM: number = NEAR_M,
): string {
    const near = remainingM < nearM;
    const ahead = spokenDistance(remainingM);
    if (kind === 'turn') {
        const label = direction ? DIRECTION_LABELS[direction] : '방향 전환';
        return `곧 ${label}입니다.`;
    }
    if (kind === 'crowd') {
        return near
            ? '지금부터 붐비는 구간입니다.'
            : `${ahead} 앞부터 붐비는 구간입니다.`;
    }
    const [name, particle] = PLACE_NAMES[kind];
    const place = direction ? `${DIRECTION_LABELS[direction]} ${name}` : name;
    return near || kind === 'crosswalk'
        ? `곧 ${place}입니다.`
        : `${ahead} 앞에 ${place}${particle} 있습니다.`;
}

/** 아직 지나지 않은 가장 가까운 이벤트의 안내 문장. 남은 이벤트가 없으면 null */
export function upcomingText(
    events: readonly RouteEvent[],
    travelledM: number,
): string | null {
    const next = events
        .filter((event) => event.distance_m >= travelledM)
        .reduce<RouteEvent | null>(
            (nearest, event) =>
                !nearest || event.distance_m < nearest.distance_m
                    ? event
                    : nearest,
            null,
        );
    if (!next) {
        return null;
    }
    // 화면에는 멀리서도 읽히도록 교차로는 블럭 문장으로 보인다.
    return isBlockEnd(next)
        ? blockText(next)
        : eventText(next, next.distance_m - travelledM);
}
