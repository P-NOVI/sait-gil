// 미리 알림 이벤트를 읽어 줄 문장으로 바꾼다.

import { NEAR_M } from '../settings';
import type { Direction, EventKind, RouteEvent } from './routeEvents';

export const ARRIVED_TEXT = '목적지에 도착했습니다.';
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

/** 남은 거리가 remainingM 인 이벤트의 안내 문장 */
export function eventText(
    { kind, direction }: RouteEvent,
    remainingM: number,
    nearM: number = NEAR_M,
): string {
    const near = remainingM < nearM;
    const ahead = spokenDistance(remainingM);
    if (kind === 'turn') {
        const label = direction ? DIRECTION_LABELS[direction] : '방향 전환';
        return near ? `곧 ${label}입니다.` : `${ahead} 앞에서 ${label}입니다.`;
    }
    if (kind === 'crowd') {
        return near
            ? '지금부터 붐비는 구간입니다.'
            : `${ahead} 앞부터 붐비는 구간입니다.`;
    }
    const [name, particle] = PLACE_NAMES[kind];
    const place = direction ? `${DIRECTION_LABELS[direction]} ${name}` : name;
    return near
        ? `곧 ${place}입니다.`
        : `${ahead} 앞에 ${place}${particle} 있습니다.`;
}
