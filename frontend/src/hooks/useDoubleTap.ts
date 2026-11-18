import { useEffect, useRef } from 'react';

import { doubleTapDetector } from '../lib/doubleTap';

// 버튼·입력 같은 조작 요소에서 두 번 누른 것은 그 요소를 쓰려던 것이라 두 번 탭으로 보지 않는다.
const CONTROLS = 'button, a, input, select, textarea, [role="button"]';

function onControl(target: EventTarget | null): boolean {
    return target instanceof Element && target.closest(CONTROLS) !== null;
}

/**
 * 화면 아무 곳이나 두 번 탭하면 onDoubleTap 을 부른다. enabled 가 false 면 듣지 않는다.
 * 화면낭독기(TalkBack)가 켜져 있으면 두 번 탭은 화면낭독기가 가져가므로 오지 않는다.
 */
export function useDoubleTap(enabled: boolean, onDoubleTap: () => void) {
    const latest = useRef(onDoubleTap);
    useEffect(() => {
        latest.current = onDoubleTap;
    });

    useEffect(() => {
        if (!enabled) {
            return;
        }
        const detect = doubleTapDetector();
        const onPointerUp = (event: PointerEvent) => {
            if (!event.isPrimary || onControl(event.target)) {
                return;
            }
            const tapped = detect({
                timeMs: event.timeStamp,
                x: event.clientX,
                y: event.clientY,
            });
            if (tapped) {
                latest.current();
            }
        };
        window.addEventListener('pointerup', onPointerUp);
        return () => window.removeEventListener('pointerup', onPointerUp);
    }, [enabled]);
}
