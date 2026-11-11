// 경위도 좌표 계산. 걷는 거리 안에서는 평면으로 봐도 오차가 작다.

/** [경도, 위도] */
export type LngLat = [number, number];

// backend/core/geo.py 와 같은 지구 반지름
const EARTH_RADIUS_M = 6_371_000;
const METERS_PER_DEGREE = (EARTH_RADIUS_M * Math.PI) / 180;

/** origin 기준 동쪽·북쪽 m */
export function toLocal(
    [lng, lat]: LngLat,
    [lng0, lat0]: LngLat,
): [number, number] {
    const cos = Math.cos((lat0 * Math.PI) / 180);
    return [
        (lng - lng0) * METERS_PER_DEGREE * cos,
        (lat - lat0) * METERS_PER_DEGREE,
    ];
}

/** 두 좌표 사이 거리(m) */
export function distanceM(a: LngLat, b: LngLat): number {
    const [x, y] = toLocal(b, a);
    return Math.hypot(x, y);
}
