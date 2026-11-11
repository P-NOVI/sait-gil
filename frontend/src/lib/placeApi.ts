// 목적지 검색과 좌표의 주소. 응답 형식은 backend/app/routers/places.py 와 같다.

import type { LngLat } from './geo';
import { ApiError, requestJson } from './http';

export type Place = {
    name: string;
    address: string;
    position: LngLat;
    /** 내 위치를 함께 보냈을 때만 온다(m). */
    distance_m: number | null;
};

export type Address = {
    full_address: string;
    /** 음성으로 읽는 도로명 주소 */
    road_address: string;
    road_name: string;
    building_name: string;
};

const NOT_FOUND = 404;

export async function searchPlaces(
    query: string,
    near: LngLat | null,
    signal?: AbortSignal,
    fetcher?: typeof fetch,
): Promise<Place[]> {
    const params = new URLSearchParams({ query });
    if (near) {
        params.set('lng', String(near[0]));
        params.set('lat', String(near[1]));
    }
    const response = await requestJson<{ places: Place[] }>(
        `/api/places?${params}`,
        { signal },
        fetcher,
    );
    return response.places;
}

/** 좌표의 주소. 주소가 없는 곳이면 null */
export async function findAddress(
    position: LngLat,
    signal?: AbortSignal,
    fetcher?: typeof fetch,
): Promise<Address | null> {
    const params = new URLSearchParams({
        lng: String(position[0]),
        lat: String(position[1]),
    });
    try {
        return await requestJson<Address>(
            `/api/places/address?${params}`,
            { signal },
            fetcher,
        );
    } catch (error) {
        if (error instanceof ApiError && error.status === NOT_FOUND) {
            return null;
        }
        throw error;
    }
}

/** 읽어 줄 주소. 도로명 주소가 없으면 전체 주소, 건물 이름이 있으면 앞에 붙인다. */
export function spokenAddress(address: Address): string {
    const road = address.road_address || address.full_address;
    return address.building_name ? `${address.building_name}, ${road}` : road;
}
