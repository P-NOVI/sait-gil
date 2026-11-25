// 집과 최근 간 곳. 기기에만 남기고 서버로 보내지 않는다.

import { RECENT_PLACES_MAX } from '../settings';
import type { LngLat } from './geo';
import type { Place } from './placeApi';

export const HOME_PLACE_KEY = 'saitgil.home';
export const RECENT_PLACES_KEY = 'saitgil.recentPlaces';

function isLngLat(value: unknown): value is LngLat {
    return (
        Array.isArray(value) &&
        value.length === 2 &&
        value.every((n) => typeof n === 'number' && Number.isFinite(n))
    );
}

/** 저장해 둔 값이 장소 모양이면 장소, 아니면 null. 거리는 그때마다 달라 남기지 않는다. */
export function storedPlace(value: unknown): Place | null {
    if (typeof value !== 'object' || value === null) {
        return null;
    }
    const { name, address, position } = value as Record<string, unknown>;
    if (
        typeof name !== 'string' ||
        typeof address !== 'string' ||
        !isLngLat(position)
    ) {
        return null;
    }
    return { name, address, position, distance_m: null };
}

/** 저장해 둔 최근 간 곳. 장소 모양이 아닌 것은 빼고 max 개까지 */
export function storedPlaces(
    value: unknown,
    max: number = RECENT_PLACES_MAX,
): Place[] {
    if (!Array.isArray(value)) {
        return [];
    }
    return value
        .map(storedPlace)
        .filter((place): place is Place => place !== null)
        .slice(0, max);
}

export function samePlace(a: Place, b: Place): boolean {
    return (
        a.name === b.name &&
        a.position[0] === b.position[0] &&
        a.position[1] === b.position[1]
    );
}

/** 방금 간 곳을 맨 앞에 둔다. 같은 곳은 한 번만, max 개까지 */
export function withRecent(
    list: readonly Place[],
    place: Place,
    max: number = RECENT_PLACES_MAX,
): Place[] {
    return [
        { ...place, distance_m: null },
        ...list.filter((other) => !samePlace(other, place)),
    ].slice(0, max);
}
