import { describe, expect, it } from 'vitest';

import type { LocationFix } from '../platform';
import { VISION } from '../settings';

import { walkSpeedOf } from './walkSpeed';

const fix = (speed: number | null, accuracy = 5): LocationFix => ({
    position: [127, 37],
    accuracy,
    ...(speed === null ? {} : { course: { heading: 0, speed } }),
});

describe('walkSpeedOf', () => {
    it('걷는 속력은 그대로 쓴다', () => {
        expect(walkSpeedOf(fix(1.2))).toBe(1.2);
    });

    it('멈춰 있어 속력이 안 오면 0 이다', () => {
        expect(walkSpeedOf(fix(null))).toBe(0);
    });

    it('위치가 없으면 모른다(null)', () => {
        expect(walkSpeedOf(null)).toBeNull();
    });

    it('걸음으로 볼 수 없는 속력은 상한으로 자른다', () => {
        expect(walkSpeedOf(fix(8))).toBe(VISION.walkSpeedMaxMps);
    });

    it('위치 오차가 크면 속력을 믿지 않고 모른다(null)', () => {
        expect(
            walkSpeedOf(fix(1.2, VISION.walkSpeedMaxAccuracyM + 1)),
        ).toBeNull();
        expect(
            walkSpeedOf(fix(null, VISION.walkSpeedMaxAccuracyM + 1)),
        ).toBeNull();
        expect(walkSpeedOf(fix(1.2, VISION.walkSpeedMaxAccuracyM))).toBe(1.2);
    });

    it('음수 속력은 0 으로 본다', () => {
        expect(walkSpeedOf(fix(-1))).toBe(0);
    });
});
