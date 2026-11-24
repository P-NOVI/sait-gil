import { describe, expect, it } from 'vitest';

import type { LocationFix } from '../platform';
import { LOCATION_FILTER } from '../settings';
import type { LngLat } from './geo';
import { filterFix, NEW_LOCATION_FILTER } from './locationFilter';

const START: LngLat = [127, 37.5];
const north = (meters: number): LngLat => [127, 37.5 + meters / 111_195];
const WALKING = { heading: 0, speed: 1.2 };

const at = (meters: number, accuracy = 5): LocationFix => ({
    position: north(meters),
    accuracy,
    course: WALKING,
});

const metersNorth = ([, lat]: LngLat) => (lat - START[1]) * 111_195;

describe('filterFix', () => {
    it('처음 받은 위치는 그대로 쓴다', () => {
        const fix = at(0);

        expect(filterFix(NEW_LOCATION_FILTER, fix, 0).fix).toBe(fix);
    });

    it('멈춘 곳 가까이에서 흔들리면 평균 위치를 쓰고 진행 방향은 버린다', () => {
        const first = filterFix(NEW_LOCATION_FILTER, at(0, 10), 0);

        const { fix } = filterFix(first.state, at(4, 10), 1_000);

        expect(metersNorth(fix!.position)).toBeCloseTo(2, 3);
        expect(fix!.course).toBeUndefined();
        expect(fix!.accuracy).toBe(10);
    });

    it('멈춘 것으로 거른 위치도 기기가 준 속력은 그대로 둔다', () => {
        const first = filterFix(NEW_LOCATION_FILTER, at(0, 10), 0);
        const walking: LocationFix = { ...at(4, 10), speedMps: WALKING.speed };

        const { fix } = filterFix(first.state, walking, 1_000);

        expect(fix!.course).toBeUndefined();
        expect(fix!.speedMps).toBe(WALKING.speed);
    });

    it('오차가 작은 위치일수록 평균에 더 많이 반영한다', () => {
        const first = filterFix(NEW_LOCATION_FILTER, at(0, 10), 0);

        const { fix } = filterFix(first.state, at(4, 5), 1_000);

        // 무게 1/10² : 1/5² = 1 : 4
        expect(metersNorth(fix!.position)).toBeCloseTo(3.2, 3);
    });

    it('멈춘 곳에서 조금씩 멀어져도 평균이 아니라 처음 멈춘 곳에서 잰다', () => {
        let state = filterFix(NEW_LOCATION_FILTER, at(0), 0).state;
        state = filterFix(state, at(3), 1_000).state;

        const walked = at(6);

        expect(filterFix(state, walked, 2_000).fix).toBe(walked);
    });

    it('멈춘 것으로 보는 거리보다 움직이면 받은 위치를 그대로 쓴다', () => {
        const first = filterFix(NEW_LOCATION_FILTER, at(0), 0);
        const walked = at(6);

        const result = filterFix(first.state, walked, 2_000);

        expect(result.fix).toBe(walked);
        expect(result.state.anchor?.origin).toEqual(walked.position);
    });

    it('걸어서 갈 수 없을 만큼 튄 위치는 버리고 다음 위치는 받는다', () => {
        const first = filterFix(NEW_LOCATION_FILTER, at(0), 0);

        const jumped = filterFix(first.state, at(40), 1_000);
        const back = filterFix(jumped.state, at(2), 2_000);

        expect(jumped.fix).toBeNull();
        expect(jumped.state.jump).toEqual({ sinceMs: 1_000, fixes: 1 });
        expect(back.fix).not.toBeNull();
        expect(back.state.jump).toBeNull();
    });

    it('튄 위치가 정한 시간 동안 이어서 오면 실제로 옮겨 간 것으로 받아들인다', () => {
        let state = filterFix(NEW_LOCATION_FILTER, at(0), 0).state;
        const times = [
            1_000,
            2_000,
            3_000,
            1_000 + LOCATION_FILTER.jumpConfirmMs,
        ];
        const results = times.map((nowMs) => {
            const result = filterFix(state, at(100), nowMs);
            state = result.state;
            return result.fix;
        });

        // 위치를 1초마다 받아도 세 번 만에 받아들이지 않는다.
        expect(results.slice(0, 3)).toEqual([null, null, null]);
        expect(results[3]?.position).toEqual(north(100));
        expect(state.anchor?.position).toEqual(north(100));
    });

    it('위치가 끊겼다가 튄 위치가 다시 와도 정한 횟수가 될 때까지 받아들이지 않는다', () => {
        let state = filterFix(NEW_LOCATION_FILTER, at(0), 0).state;
        // 튄 위치를 한 번 받은 뒤 정한 시간 동안 위치를 받지 못했다.
        const late = 1_000 + LOCATION_FILTER.jumpConfirmMs;
        const results = [1_000, late, late + 1_000].map((nowMs) => {
            const result = filterFix(state, at(100), nowMs);
            state = result.state;
            return result.fix;
        });

        // 시간은 지났어도 두 번째로는 받아들이지 않고, 세 번째(jumpConfirmFixes)에 받아들인다.
        expect(results.slice(0, 2)).toEqual([null, null]);
        expect(results[2]?.position).toEqual(north(100));
    });

    it('오래 못 받았으면 그동안 걸어갈 수 있는 거리까지 받는다', () => {
        const first = filterFix(NEW_LOCATION_FILTER, at(0), 0);
        const far = at(40);

        expect(filterFix(first.state, far, 20_000).fix).toBe(far);
    });
});

describe('filterFix (걸음 센서)', () => {
    const motion = (steps: number, expectedM: number | null = null) => ({
        steps,
        expected: expectedM === null ? null : north(expectedM),
    });
    const run = (
        state: ReturnType<typeof filterFix>['state'],
        fix: LocationFix,
        nowMs: number,
        walked: ReturnType<typeof motion>,
    ) => filterFix(state, fix, nowMs, LOCATION_FILTER, walked);
    const first = () =>
        filterFix(NEW_LOCATION_FILTER, at(0), 0, LOCATION_FILTER, motion(0));

    it('걸음 수보다 훨씬 많이 옮겨 간 위치는 시간이 지나도 믿지 않는다', () => {
        let state = first().state;
        const results = [];
        // 2초마다 걸음 수는 2걸음(1m)씩 늘지만 GPS 는 60m 앞에 머문다.
        for (let second = 2; second <= 60; second += 2) {
            const result = run(
                state,
                at(60),
                second * 1_000,
                motion(second, second / 2),
            );
            state = result.state;
            results.push(result);
        }

        expect(results.every((result) => result.fix === null)).toBe(true);
        expect(results.every((result) => result.distrusted)).toBe(true);
    });

    it('옆 길로 튄 위치가 이어져도 걸을수록 믿게 되지 않고, 추정한 위치로 돌아오면 다시 믿는다', () => {
        let state = first().state;
        // 오래 걸어 걸음으로 갈 수 있는 거리가 튄 거리(30m)보다 커진 뒤에도 믿지 않는다.
        state = run(state, at(30), 1_000, motion(2, 1)).state;
        const still = run(state, at(130), 100_000, motion(200, 100));
        const back = run(still.state, at(101), 101_000, motion(202, 101));

        expect(still.fix).toBeNull();
        expect(back.fix?.position).toEqual(north(101));
        expect(back.state.jump).toBeNull();
    });

    it('걸음 수만큼 경로 밖으로 걸으면 진짜 이동으로 받아들인다', () => {
        const state = first().state;
        // 20걸음(10m)을 걷고 GPS 도 10m 옮겨 갔다.
        const result = run(state, at(10), 20_000, motion(20, 10));

        expect(result.fix?.position).toEqual(north(10));
        expect(result.distrusted).toBeUndefined();
    });

    it('믿지 않은 시간이 한도를 넘으면 현재 위치를 믿는다', () => {
        let state = first().state;
        state = run(state, at(60), 1_000, motion(2, 1)).state;
        const early = run(
            state,
            at(60),
            LOCATION_FILTER.distrustLimitMs,
            motion(4, 2),
        );
        const late = run(
            early.state,
            at(60),
            LOCATION_FILTER.distrustLimitMs + 1_000,
            motion(6, 3),
        );

        expect(early.fix).toBeNull();
        expect(late.fix?.position).toEqual(north(60));
    });

    it('추정할 경로가 없으면 걸어서 갈 수 있는 거리로 돌아올 때 다시 믿는다', () => {
        let state = first().state;
        state = run(state, at(60), 1_000, motion(2)).state;
        const back = run(state, at(3), 2_000, motion(4));

        expect(back.fix?.position).toEqual(north(3));
    });

    it('걸음 센서가 없으면 기존처럼 시간으로 받아들인다', () => {
        let state = filterFix(NEW_LOCATION_FILTER, at(0), 0).state;
        const results = [];
        for (const nowMs of [1_000, 6_000, 12_000]) {
            const result = filterFix(state, at(100), nowMs);
            state = result.state;
            results.push(result);
        }

        expect(results.map((result) => result.fix === null)).toEqual([
            true,
            true,
            false,
        ]);
        expect(results.some((result) => result.distrusted)).toBe(false);
    });
});
