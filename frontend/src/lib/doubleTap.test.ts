import { describe, expect, it } from 'vitest';

import { DOUBLE_TAP } from '../settings';
import { doubleTapDetector, type Tap } from './doubleTap';

const tap = (timeMs: number, x = 100, y = 100): Tap => ({ timeMs, x, y });

describe('doubleTapDetector', () => {
    it('가까운 곳을 빠르게 두 번 누르면 두 번 탭이다', () => {
        const detect = doubleTapDetector();

        expect(detect(tap(0))).toBe(false);
        expect(detect(tap(DOUBLE_TAP.maxIntervalMs))).toBe(true);
    });

    it('두 탭 사이가 길면 두 번 탭이 아니다', () => {
        const detect = doubleTapDetector();

        detect(tap(0));
        expect(detect(tap(DOUBLE_TAP.maxIntervalMs + 1))).toBe(false);
    });

    it('두 탭 위치가 멀면 두 번 탭이 아니다', () => {
        const detect = doubleTapDetector();

        detect(tap(0, 100, 100));
        expect(detect(tap(100, 100 + DOUBLE_TAP.maxDistancePx + 1, 100))).toBe(
            false,
        );
    });

    it('세 번 빠르게 눌러도 두 번 탭은 한 번만 본다', () => {
        const detect = doubleTapDetector();

        const results = [0, 100, 200].map((time) => detect(tap(time)));

        expect(results).toEqual([false, true, false]);
    });

    it('늦은 탭은 새 첫 탭이 되어 다음 탭과 두 번 탭을 이룬다', () => {
        const detect = doubleTapDetector();

        detect(tap(0));
        detect(tap(1_000));
        expect(detect(tap(1_100))).toBe(true);
    });
});
