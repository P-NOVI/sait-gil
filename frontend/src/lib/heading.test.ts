import { describe, expect, it } from 'vitest';

import { HEADING } from '../settings';
import {
    angleDiff,
    compassFromOrientation,
    displayHeading,
    learnOffset,
    normalizeDegrees,
    smoothAngle,
} from './heading';

const walking = { heading: 90, speed: 1.2 };
const standing = { heading: 90, speed: 0.1 };

describe('각도 계산', () => {
    it('0 이상 360 미만으로 맞춘다', () => {
        expect(normalizeDegrees(-10)).toBe(350);
        expect(normalizeDegrees(370)).toBe(10);
        expect(normalizeDegrees(360)).toBe(0);
    });

    it('북쪽을 넘어가도 짧은 쪽으로 돈다', () => {
        expect(angleDiff(350, 10)).toBe(20);
        expect(angleDiff(10, 350)).toBe(-20);
        expect(angleDiff(0, 180)).toBe(180);
    });

    it('떨림을 줄일 때도 북쪽을 넘어 짧은 쪽으로 옮긴다', () => {
        expect(smoothAngle(350, 10, 0.5)).toBe(0);
        expect(smoothAngle(10, 30, 0.25)).toBe(15);
    });
});

describe('compassFromOrientation', () => {
    it('안드로이드 absolute alpha 를 시계 방향으로 바꾼다', () => {
        expect(compassFromOrientation({ alpha: 90, absolute: true }, 0)).toBe(
            270,
        );
        expect(compassFromOrientation({ alpha: 0, absolute: true }, 0)).toBe(0);
    });

    it('iOS 나침반 값은 그대로 쓴다', () => {
        expect(
            compassFromOrientation(
                { alpha: 10, absolute: false, webkitCompassHeading: 45 },
                0,
            ),
        ).toBe(45);
    });

    it('가로 화면이면 화면 회전만큼 더한다', () => {
        expect(compassFromOrientation({ alpha: 0, absolute: true }, 90)).toBe(
            90,
        );
    });

    it('북쪽 기준이 아닌 값이면 null', () => {
        expect(
            compassFromOrientation({ alpha: 90, absolute: false }, 0),
        ).toBeNull();
        expect(
            compassFromOrientation({ alpha: null, absolute: true }, 0),
        ).toBeNull();
    });
});

describe('learnOffset', () => {
    it('걷는 중이면 GPS 방향과의 차이 쪽으로 조금씩 옮긴다', () => {
        // 나침반 80, GPS 90 → 목표 보정 +10
        expect(learnOffset(0, 80, walking)).toBeCloseTo(
            10 * HEADING.offsetLearnRate,
        );
    });

    it('계속 걸으면 보정값이 차이에 가까워진다', () => {
        let offset = 0;
        for (let i = 0; i < 50; i += 1) {
            offset = learnOffset(offset, 80, walking);
        }
        expect(offset).toBeCloseTo(10, 1);
    });

    it('멈춰 있거나 나침반이 없으면 그대로 둔다', () => {
        expect(learnOffset(5, 80, standing)).toBe(5);
        expect(learnOffset(5, null, walking)).toBe(5);
        expect(learnOffset(5, 80, null)).toBe(5);
    });
});

describe('displayHeading', () => {
    it('나침반에 보정값을 더한다', () => {
        expect(displayHeading(350, 20, null)).toBe(10);
    });

    it('나침반이 없으면 걷는 중에만 GPS 방향을 쓴다', () => {
        expect(displayHeading(null, 0, walking)).toBe(90);
        expect(displayHeading(null, 0, standing)).toBeNull();
        expect(displayHeading(null, 0, null)).toBeNull();
    });
});
