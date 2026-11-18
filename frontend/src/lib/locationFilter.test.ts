import { describe, expect, it } from 'vitest';

import type { LocationFix } from '../platform';
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
        expect(jumped.state.jumps).toBe(1);
        expect(back.fix).not.toBeNull();
        expect(back.state.jumps).toBe(0);
    });

    it('튄 위치가 연달아 오면 실제로 옮겨 간 것으로 받아들인다', () => {
        let state = filterFix(NEW_LOCATION_FILTER, at(0), 0).state;
        const results = [1_000, 2_000, 3_000].map((nowMs) => {
            const result = filterFix(state, at(40), nowMs);
            state = result.state;
            return result.fix;
        });

        expect(results.slice(0, 2)).toEqual([null, null]);
        expect(results[2]?.position).toEqual(north(40));
        expect(state.anchor?.position).toEqual(north(40));
    });

    it('오래 못 받았으면 그동안 걸어갈 수 있는 거리까지 받는다', () => {
        const first = filterFix(NEW_LOCATION_FILTER, at(0), 0);
        const far = at(40);

        expect(filterFix(first.state, far, 20_000).fix).toBe(far);
    });
});
