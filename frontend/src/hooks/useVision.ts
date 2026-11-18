import { useEffect, useState } from 'react';

import { startVision, visionAvailable, type VisionFrame } from '../platform';

/**
 * 인파 인식을 켜고 결과마다 onFrame 으로 알린다. 돌려준 함수를 부르면 멈춘다.
 * 시작이 끝나기 전에 멈추면 시작이 끝나는 대로 곧바로 멈추고, 멈춘 뒤에 온 결과는 버린다.
 * 시작에 실패해도 오류를 던지지 않는다.
 */
export function connectVision(
    onFrame: (frame: VisionFrame) => void,
): () => void {
    let cancelled = false;
    let stop: (() => void) | null = null;
    startVision((frame) => {
        if (!cancelled) {
            onFrame(frame);
        }
    })
        .then((stopVision) => {
            if (cancelled) {
                stopVision();
            } else {
                stop = stopVision;
            }
        })
        // 인식이 안 돼도 길안내는 계속된다.
        .catch(() => undefined);
    return () => {
        cancelled = true;
        stop?.();
    };
}

/**
 * active 인 동안 카메라 인파 인식을 켜고 마지막 결과를 돌려준다. 꺼지면 인식을 멈추고 결과를 지운다.
 * 인식을 쓸 수 없거나 시작에 실패하면 결과가 null 이라 화면은 "준비 중"으로 남는다.
 */
export function useVision(active: boolean): VisionFrame | null {
    const [frame, setFrame] = useState<VisionFrame | null>(null);

    useEffect(() => {
        if (!active || !visionAvailable()) {
            return;
        }
        const disconnect = connectVision(setFrame);
        return () => {
            disconnect();
            setFrame(null);
        };
    }, [active]);

    return frame;
}
