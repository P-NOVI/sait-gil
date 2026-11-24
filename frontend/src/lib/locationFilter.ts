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
        /** 이 위치를 받았을 때의 누적 걸음 수. 걸음 센서를 쓸 수 없었으면 없다. */
        steps?: number;
    } | null;
    /** 이어서 버린 튄 위치. 튄 위치가 없으면 null */
    jump: {
        /** 버리기 시작한 때 */
        sinceMs: number;
        /** 버린 횟수 */
        fixes: number;
        /** 버리기 시작했을 때의 누적 걸음 수. 걸음 센서를 쓸 수 없었으면 없다. */
        fromSteps?: number;
    } | null;
};

/** 걸음 센서로 잰 움직임. 걸음 센서를 쓸 수 있을 때만 넘긴다. */
export type Motion = {
    /** 누적 걸음 수 */
    steps: number;
    /** 걸음 수로 추정한 경로 위 내 위치. 추정할 경로가 없으면 null */
    expected: LngLat | null;
};

export const NEW_LOCATION_FILTER: LocationFilterState = {
    anchor: null,
    jump: null,
};

type Filtered = {
    state: LocationFilterState;
    /** 쓸 위치. 튄 위치라 버렸으면 null */
    fix: LocationFix | null;
    /** 걸음 수와 맞지 않아 믿지 않는 중이면 true. 이때 안내는 걸음 수로 추정한 위치를 쓴다. */
    distrusted?: true;
};

// 오차가 0으로 오더라도 무게가 무한대가 되지 않게 한다.
const MIN_ACCURACY_M = 1;

const weightOf = (accuracy: number) =>
    1 / Math.max(accuracy, MIN_ACCURACY_M) ** 2;

/** fix 를 새 기준 위치로 삼고 그대로 쓴다. */
function moveTo(fix: LocationFix, nowMs: number, motion?: Motion): Filtered {
    return {
        state: {
            anchor: {
                origin: fix.position,
                position: fix.position,
                weight: weightOf(fix.accuracy),
                atMs: nowMs,
                steps: motion?.steps,
            },
            jump: null,
        },
        fix,
    };
}

/**
 * 걸음 수로 튄 위치를 거른다. 걸어서 간 거리보다 GPS 가 훨씬 많이 옮겨 갔으면 튄 위치로 보고 믿지 않는다.
 * 믿지 않기 시작하면, 걸음 수로 추정한 경로 위 위치 가까이로 돌아오거나 distrustLimitMs 가 지날 때까지 계속 믿지 않는다.
 * (옆 길로 튄 위치가 그대로 이어져도 걸을수록 늘어나는 걸음 허용 거리에 들어가 믿어 버리는 것을 막는다.)
 * 믿어도 되는 위치면 null 을 돌려 주고, 멈춤 보정은 filterFix 가 이어서 한다.
 */
function judgeByMotion(
    state: LocationFilterState,
    anchor: NonNullable<LocationFilterState['anchor']>,
    anchorSteps: number,
    fix: LocationFix,
    nowMs: number,
    motion: Motion,
    settings: LocationFilterSettings,
): Filtered | null {
    const { jump } = state;
    const walkedM =
        Math.max(0, motion.steps - anchorSteps) * settings.stepLengthM;
    const apartM = distanceM(anchor.position, fix.position);
    const withinReach =
        apartM <= walkedM * settings.stepReachMargin + fix.accuracy;
    if (!jump) {
        if (withinReach) {
            return null;
        }
        return {
            state: {
                ...state,
                jump: { sinceMs: nowMs, fixes: 1, fromSteps: motion.steps },
            },
            fix: null,
            distrusted: true,
        };
    }
    // 이미 믿지 않는 중. 추정한 위치가 없으면(경로가 없을 때) 걸어서 갈 수 있는 거리로 돌아와야 한다.
    const sinceJumpM =
        Math.max(0, motion.steps - (jump.fromSteps ?? motion.steps)) *
        settings.stepLengthM;
    const back = motion.expected
        ? distanceM(motion.expected, fix.position) <=
          Math.min(
              settings.resumeToleranceM + settings.stepDriftRatio * sinceJumpM,
              settings.resumeToleranceMaxM,
          )
        : withinReach;
    if (back || nowMs - jump.sinceMs >= settings.distrustLimitMs) {
        return moveTo(fix, nowMs, motion);
    }
    return {
        state: { ...state, jump: { ...jump, fixes: jump.fixes + 1 } },
        fix: null,
        distrusted: true,
    };
}

/**
 * 새 위치를 거른다.
 * - 걸음 센서를 쓸 수 있으면(motion) 걸어서 간 거리와 맞지 않는 위치를 믿지 않는다. judgeByMotion 참고.
 * - 걸음 센서가 없으면 마지막 위치에서 걸어서 갈 수 없을 만큼 멀 때 버린다. 한동안 여러 번 이어서 오면 실제로 옮겨 간 것으로 받아들인다.
 * - 멈춘 곳 가까이에서만 흔들리면 멈춘 것으로 보고, 평균 위치를 쓰고 GPS 진행 방향은 버린다.
 */
export function filterFix(
    state: LocationFilterState,
    fix: LocationFix,
    nowMs: number,
    settings: LocationFilterSettings = LOCATION_FILTER,
    motion?: Motion,
): Filtered {
    const { anchor } = state;
    if (!anchor) {
        return moveTo(fix, nowMs, motion);
    }
    if (motion && anchor.steps !== undefined) {
        const judged = judgeByMotion(
            state,
            anchor,
            anchor.steps,
            fix,
            nowMs,
            motion,
            settings,
        );
        if (judged) {
            return judged;
        }
        return stillOrMove(state, anchor, fix, nowMs, settings, motion);
    }
    const elapsedS = Math.max(0, nowMs - anchor.atMs) / 1000;
    const reachM = settings.maxSpeedMps * elapsedS + fix.accuracy;
    if (distanceM(anchor.position, fix.position) > reachM) {
        const jump = {
            sinceMs: state.jump?.sinceMs ?? nowMs,
            fixes: (state.jump?.fixes ?? 0) + 1,
        };
        return nowMs - jump.sinceMs >= settings.jumpConfirmMs &&
            jump.fixes >= settings.jumpConfirmFixes
            ? moveTo(fix, nowMs, motion)
            : { state: { ...state, jump }, fix: null };
    }
    return stillOrMove(state, anchor, fix, nowMs, settings, motion);
}

/** 믿어도 되는 위치를 멈춤 보정한다. 멈춘 곳에서 벗어났으면 새 기준 위치로 삼는다. */
function stillOrMove(
    state: LocationFilterState,
    anchor: NonNullable<LocationFilterState['anchor']>,
    fix: LocationFix,
    nowMs: number,
    settings: LocationFilterSettings,
    motion?: Motion,
): Filtered {
    const stillRadiusM = Math.min(settings.stillRadiusM, fix.accuracy);
    if (distanceM(anchor.origin, fix.position) > stillRadiusM) {
        return moveTo(fix, nowMs, motion);
    }
    const weight = weightOf(fix.accuracy);
    const total = anchor.weight + weight;
    const [lng, lat] = anchor.position;
    const position: LngLat = [
        lng + ((fix.position[0] - lng) * weight) / total,
        lat + ((fix.position[1] - lat) * weight) / total,
    ];
    // 멈춘 것으로 본 위치는 방향을 뺀다. 속력(speedMps)은 기기가 준 값을 그대로 둔다.
    // 걷기 시작해도 stillRadiusM 안에서는 멈춘 것으로 거르므로, 속력을 0 으로 덮으면 걷는 중에 멈춤으로 잡힌다.
    const still: LocationFix = { ...fix, position };
    delete still.course;
    return {
        state: {
            anchor: {
                ...anchor,
                position,
                weight: total,
                atMs: nowMs,
                steps: motion?.steps ?? anchor.steps,
            },
            jump: null,
        },
        fix: still,
    };
}
