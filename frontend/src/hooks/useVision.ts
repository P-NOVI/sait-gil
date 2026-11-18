import { useEffect, useRef, useState } from 'react';

import type { Alert } from '../lib/alertArbiter';
import { visionReader } from '../lib/visionAlerts';
import {
    type CrowdLevel,
    startVision,
    visionAvailable,
    type VisionFrame,
} from '../platform';
import { CAUTION_VIBRATION } from '../settings';
import type { WhenBusy } from './useGuidance';

type Options = {
    /** 안내 중일 때만 카메라 인식을 켠다. */
    active: boolean;
    /** 이 단계부터 인파를 알린다(혼잡 민감도). 위험과 판단 불가는 늘 알린다. */
    minLevel: CrowdLevel;
    report: (alert: Alert, whenBusy?: WhenBusy) => void;
    buzz: (pattern: readonly number[]) => void;
};

/**
 * 안내 중 카메라 인파 인식 결과를 받아 알림 중재로 넘기고, 화면에 보일 마지막 결과를 돌려준다.
 * 인식 결과는 1초에 몇 번씩 오므로, 읽던 말을 끊지 못한 알림은 버리고 다음 결과에서 다시 고른다.
 */
export function useVision({
    active,
    minLevel,
    report,
    buzz,
}: Options): VisionFrame | null {
    const [frame, setFrame] = useState<VisionFrame | null>(null);
    const latest = useRef({ minLevel, report, buzz });
    useEffect(() => {
        latest.current = { minLevel, report, buzz };
    });

    useEffect(() => {
        if (!active || !visionAvailable()) {
            return;
        }
        const read = visionReader();
        let stopped = false;
        let stop: (() => void) | null = null;

        startVision((next) => {
            if (stopped) {
                return;
            }
            const current = latest.current;
            setFrame(next);
            const cue = read(next, Date.now(), current.minLevel);
            if (cue?.kind === 'alert') {
                current.report(cue.alert, 'drop');
            } else if (cue?.kind === 'buzz') {
                current.buzz(CAUTION_VIBRATION);
            }
        })
            .then((stopVision) => {
                if (stopped) {
                    stopVision();
                } else {
                    stop = stopVision;
                }
            })
            .catch((error: unknown) => console.warn(error));

        return () => {
            stopped = true;
            stop?.();
            setFrame(null);
        };
    }, [active]);

    return frame;
}
