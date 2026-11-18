import { useEffect, useMemo, useRef, useState } from 'react';

import type { Alert } from '../lib/alertArbiter';
import { approachAlert, visionReader } from '../lib/visionAlerts';
import {
    type CrowdLevel,
    startVision,
    visionAvailable,
    type VisionApproach,
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
 * 인파 인식을 켜고 결과마다 onFrame 으로 알린다. 돌려준 함수를 부르면 멈춘다.
 * 시작이 끝나기 전에 멈추면 시작이 끝나는 대로 곧바로 멈추고, 멈춘 뒤에 온 결과는 버린다.
 * 시작에 실패해도 오류를 던지지 않는다.
 */
export function connectVision(
    onFrame: (frame: VisionFrame) => void,
    onApproach: (approach: VisionApproach) => void = () => undefined,
): () => void {
    let cancelled = false;
    let stop: (() => void) | null = null;
    startVision(
        (frame) => {
            if (!cancelled) {
                onFrame(frame);
            }
        },
        (approach) => {
            if (!cancelled) {
                onApproach(approach);
            }
        },
    )
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

export type VisionState = {
    /** 화면에 보일 마지막 결과. 꺼져 있거나 안내 중이 아니면 null */
    frame: VisionFrame | null;
    /** 카메라 인식을 켜 두었는지 */
    enabled: boolean;
    /** 카메라 인식을 켜거나 끈다. 안내를 시작할 때 묻고, 안내 중에는 버튼이나 말로 바꾼다. */
    setEnabled: (enabled: boolean) => void;
};

/**
 * 안내 중 카메라 인파 인식 결과를 받아 알림 중재로 넘기고, 화면에 보일 마지막 결과를 돌려준다.
 * 인식 결과는 1초에 몇 번씩 오므로, 읽던 말을 끊지 못한 알림은 버리고 다음 결과에서 다시 고른다.
 * 끄면 카메라를 바로 놓는다. 켜짐 여부는 저장하지 않고 안내를 시작할 때마다 묻는다.
 */
export function useVision({
    active,
    minLevel,
    report,
    buzz,
}: Options): VisionState {
    const [frame, setFrame] = useState<VisionFrame | null>(null);
    const [enabled, setEnabled] = useState(true);
    const latest = useRef({ minLevel, report, buzz });
    useEffect(() => {
        latest.current = { minLevel, report, buzz };
    });
    const running = active && enabled;

    useEffect(() => {
        if (!running || !visionAvailable()) {
            return;
        }
        const read = visionReader();
        const disconnect = connectVision(
            (next) => {
                const current = latest.current;
                setFrame(next);
                const cue = read(next, Date.now(), current.minLevel);
                if (cue?.kind === 'alert') {
                    current.report(cue.alert, 'drop');
                } else if (cue?.kind === 'buzz') {
                    current.buzz(CAUTION_VIBRATION);
                }
            },
            (approach) =>
                latest.current.report(approachAlert(approach), 'drop'),
        );

        return () => {
            disconnect();
            setFrame(null);
        };
    }, [running]);

    return useMemo(() => ({ frame, enabled, setEnabled }), [frame, enabled]);
}
