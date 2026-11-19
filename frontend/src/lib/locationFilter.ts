// 안내 중 받은 GPS 위치를 거른다. 멈춰 있을 때 흔들리는 위치와 한두 번 튀는 위치를 그대로 쓰지 않는다.

import type { LocationFix } from '../platform';
import { LOCATION_FILTER, type LocationFilterSettings } from '../settings';
import { distanceM, type LngLat } from './geo';

export type LocationFilterState = {
    /** 마지막으로 받아들인 위치 */
    anchor: {
        /** 멈춘 것으로 보기 시작한 위치. 여기서 멀어지면 다시 걷는 것으로 본다. */
        origin: LngLat;
        /** 멈춰 있는 동안 받은 위치들을 오차로 무게를 둔 평균 */
        position: LngLat;
        /** 평균에 들어간 위치들의 무게(1 / 오차²) 합 */
        weight: number;
        atMs: number;
    } | null;
    /** 튄 위치를 이어서 버리기 시작한 때. 튄 위치가 없으면 null */
    jumpSince: number | null;
};

export const NEW_LOCATION_FILTER: LocationFilterState = {
    anchor: null,
    jumpSince: null,
};

type Filtered = {
    state: LocationFilterState;
    /** 쓸 위치. 튄 위치라 버렸으면 null */
    fix: LocationFix | null;
};

// 오차가 0으로 오더라도 무게가 무한대가 되지 않게 한다.
const MIN_ACCURACY_M = 1;

const weightOf = (accuracy: number) =>
    1 / Math.max(accuracy, MIN_ACCURACY_M) ** 2;

/** fix 를 새 기준 위치로 삼고 그대로 쓴다. */
function moveTo(fix: LocationFix, nowMs: number): Filtered {
    return {
        state: {
            anchor: {
                origin: fix.position,
                position: fix.position,
                weight: weightOf(fix.accuracy),
                atMs: nowMs,
            },
            jumpSince: null,
        },
        fix,
    };
}

/**
 * 새 위치를 거른다.
 * - 마지막 위치에서 걸어서 갈 수 없을 만큼 멀면 버린다. 한동안 이어서 오면 실제로 옮겨 간 것으로 받아들인다.
 * - 멈춘 곳 가까이에서만 흔들리면 멈춘 것으로 보고, 평균 위치를 쓰고 GPS 진행 방향은 버린다.
 */
export function filterFix(
    state: LocationFilterState,
    fix: LocationFix,
    nowMs: number,
    settings: LocationFilterSettings = LOCATION_FILTER,
): Filtered {
    const { anchor } = state;
    if (!anchor) {
        return moveTo(fix, nowMs);
    }
    const elapsedS = Math.max(0, nowMs - anchor.atMs) / 1000;
    const reachM = settings.maxSpeedMps * elapsedS + fix.accuracy;
    if (distanceM(anchor.position, fix.position) > reachM) {
        const jumpSince = state.jumpSince ?? nowMs;
        return nowMs - jumpSince >= settings.jumpConfirmMs
            ? moveTo(fix, nowMs)
            : { state: { ...state, jumpSince }, fix: null };
    }
    const stillRadiusM = Math.min(settings.stillRadiusM, fix.accuracy);
    if (distanceM(anchor.origin, fix.position) > stillRadiusM) {
        return moveTo(fix, nowMs);
    }
    const weight = weightOf(fix.accuracy);
    const total = anchor.weight + weight;
    const [lng, lat] = anchor.position;
    const position: LngLat = [
        lng + ((fix.position[0] - lng) * weight) / total,
        lat + ((fix.position[1] - lat) * weight) / total,
    ];
    const still: LocationFix = { ...fix, position };
    delete still.course;
    return {
        state: {
            anchor: { ...anchor, position, weight: total, atMs: nowMs },
            jumpSince: null,
        },
        fix: still,
    };
}
