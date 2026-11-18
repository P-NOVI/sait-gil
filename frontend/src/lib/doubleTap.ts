// 화면 두 번 탭을 알아낸다. 브라우저 이벤트와 떼어 두어 시각·위치만으로 테스트한다.

import { DOUBLE_TAP, type DoubleTapSettings } from '../settings';

/** 탭 한 번. 시각(ms)과 화면 위치(px) */
export type Tap = { timeMs: number; x: number; y: number };

/**
 * 탭을 차례로 받아 두 번 탭이면 true 를 돌려준다.
 * 두 번 탭으로 본 뒤에는 처음부터 다시 세어 세 번 탭이 두 번 탭 두 번이 되지 않게 한다.
 */
export function doubleTapDetector(
    settings: DoubleTapSettings = DOUBLE_TAP,
): (tap: Tap) => boolean {
    let last: Tap | null = null;
    return (tap) => {
        const previous = last;
        const isDouble =
            previous !== null &&
            tap.timeMs - previous.timeMs <= settings.maxIntervalMs &&
            Math.hypot(tap.x - previous.x, tap.y - previous.y) <=
                settings.maxDistancePx;
        last = isDouble ? null : tap;
        return isDouble;
    };
}
