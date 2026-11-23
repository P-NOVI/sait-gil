import { describe, expect, it } from 'vitest';

import type { LocationFix } from '../platform';
import { VISION } from '../settings';

import { isStandingStill, walkSpeedOf } from './walkSpeed';

/** speed 가 null 이면 속력이 안 온 위치, withHeading 이 false 면 방향 없이 속력만 온 위치 */
const fix = (
    speed: number | null,
    accuracy = 5,
    withHeading = true,
): LocationFix => ({
    position: [127, 37],
    accuracy,
    ...(speed === null ? {} : { speedMps: speed }),
    ...(speed !== null && withHeading ? { course: { heading: 0, speed } } : {}),
});

describe('walkSpeedOf', () => {
    it('걷는 속력은 그대로 쓴다', () => {
        expect(walkSpeedOf(fix(1.2))).toBe(1.2);
    });

    it('방향 없이 속력만 와도 그 속력을 쓴다', () => {
        expect(walkSpeedOf(fix(1.2, 5, false))).toBe(1.2);
    });

    it('멈춘 것으로 거른 위치(속력 0)는 0 이다', () => {
        expect(walkSpeedOf(fix(0))).toBe(0);
    });

    it('속력이 안 오면 모른다(null)', () => {
        expect(walkSpeedOf(fix(null))).toBeNull();
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

describe('isStandingStill', () => {
    it('속력이 기준보다 느리면 서 있다', () => {
        expect(isStandingStill(fix(VISION.waitingSpeedMps - 0.1))).toBe(true);
        expect(isStandingStill(fix(0))).toBe(true);
    });

    it('속력이 기준 이상이면 걷는 중이다', () => {
        expect(isStandingStill(fix(VISION.waitingSpeedMps))).toBe(false);
        expect(isStandingStill(fix(1.2))).toBe(false);
    });

    it('방향 없이 속력만 와도 속력으로 본다', () => {
        expect(isStandingStill(fix(1.2, 5, false))).toBe(false);
        expect(isStandingStill(fix(0, 5, false))).toBe(true);
    });

    it('속력이 안 오면 서 있는 것으로 본다', () => {
        expect(isStandingStill(fix(null))).toBe(true);
    });

    it('위치가 없으면 서 있는지 모른다(false)', () => {
        expect(isStandingStill(null)).toBe(false);
    });
});
