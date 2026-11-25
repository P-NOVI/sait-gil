// 즐겨찾기: 집 하나. 기기 안에만 저장하고 서버로 보내지 않는다.
// 저장된 값은 손상됐거나 옛 형식일 수 있어 읽을 때마다 모양을 확인한다.

import type { LngLat } from './geo';
import type { Place } from './placeApi';

/** 집 저장 키. 최근 간 곳 등 다른 저장 값과 겹치지 않게 따로 둔다. */
export const HOME_STORAGE_KEY = 'sait-gil:home';

function isLngLat(value: unknown): value is LngLat {
    return (
        Array.isArray(value) &&
        value.length === 2 &&
        value.every((each) => typeof each === 'number' && Number.isFinite(each))
    );
}

/** 저장소에서 읽은 값을 집 장소로 바꾼다. 쓸 수 없는 값이면 null(등록 안 됨). */
export function normalizeHome(raw: unknown): Place | null {
    if (typeof raw !== 'object' || raw === null) {
        return null;
    }
    const { name, address, position } = raw as Record<string, unknown>;
    if (typeof name !== 'string' || !name || !isLngLat(position)) {
        return null;
    }
    return {
        name,
        address: typeof address === 'string' ? address : '',
        position,
        // 거리는 그때 위치 기준이라 저장하지 않는다.
        distance_m: null,
    };
}
