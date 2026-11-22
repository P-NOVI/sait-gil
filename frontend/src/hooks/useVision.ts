import {
    useCallback,
    useEffect,
    useMemo,
    useReducer,
    useRef,
    useState,
} from 'react';

import type { Alert, WhenBusy } from '../lib/alertArbiter';
import {
    obstacleAlert,
    signalReader,
    VISION_KEYS,
    visionFailureAlert,
    visionReader,
} from '../lib/visionAlerts';
import { INITIAL_VISION_CONTROL, visionControl } from '../lib/visionControl';
import {
    type CrowdLevel,
    setVisionWalkSpeed,
    startVision,
    visionAvailable,
    type VisionApproach,
    type VisionFailure,
    visionFailure,
    type VisionFrame,
    type VisionObstacle,
} from '../platform';
import { CAUTION_VIBRATION, VISION } from '../settings';

type Options = {
    /** 안내 중일 때만 카메라 인식을 켠다. */
    active: boolean;
    /** 이 단계부터 인파를 알린다(혼잡 민감도). 위험과 판단 불가는 늘 알린다. */
    minLevel: CrowdLevel;
    /** 횡단보도 근처인지. 근처에서만 보행 신호등을 알린다. */
    atCrosswalk: boolean;
    /** 신호를 기다리느라 서 있는지. 서 있을 때 앞에 사람이 서도 "앞에 사람이 있습니다"만 한 번 알린다. */
    waiting: boolean;
    /** 사용자가 걷는 속도(m/s). 모르면 0. 차의 움직임을 잴 때 내 걸음을 뺀다. */
    walkSpeedMps: number;
    report: (alert: Alert, whenBusy?: WhenBusy) => void;
    buzz: (pattern: readonly number[]) => void;
};

/**
 * 인파 인식을 켜고 결과마다 onFrame 으로, 정면 접근은 onApproach 로, 가까운 장애물은 onObstacle 로 알린다.
 * 돌려준 함수를 부르면 멈춘다.
 * 시작이 끝나기 전에 멈추면 시작이 끝나는 대로 곧바로 멈추고, 멈춘 뒤에 온 결과는 버린다.
 * 시작에 실패하면 오류를 던지지 않고 onFailure 로 알린다. 이미 멈췄으면 알리지 않는다.
 */
export function connectVision(
    onFrame: (frame: VisionFrame) => void,
    onApproach: (approach: VisionApproach) => void = () => undefined,
    onFailure: (failure: VisionFailure) => void = () => undefined,
    onObstacle: (obstacle: VisionObstacle) => void = () => undefined,
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
        (obstacle) => {
            if (!cancelled) {
                onObstacle(obstacle);
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
        // 인식이 안 돼도 길안내는 계속된다. 사용자가 인식되는 줄 알고 걷지 않게 실패만 알린다.
        .catch((error: unknown) => {
            if (!cancelled) {
                onFailure(visionFailure(error));
            }
        });
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
    /** 카메라를 켜지 못한 이유. 켜져 있거나 다시 켜는 중이면 null */
    failure: VisionFailure | null;
    /**
     * 카메라 인식을 켜거나 끈다. 안내를 시작할 때 묻고, 안내 중에는 버튼이나 말로 바꾼다.
     * 켜지 못한 상태에서 다시 켜면 카메라를 다시 켜 본다.
     */
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
    atCrosswalk,
    waiting,
    walkSpeedMps,
    report,
    buzz,
}: Options): VisionState {
    const [frame, setFrame] = useState<VisionFrame | null>(null);
    // 켜짐·실패·다시 켜 본 횟수. attempt 가 바뀌면 카메라를 다시 켠다.
    const [{ enabled, failure, attempt }, dispatch] = useReducer(
        visionControl,
        INITIAL_VISION_CONTROL,
    );
    const latest = useRef({ minLevel, atCrosswalk, waiting, report, buzz });
    useEffect(() => {
        latest.current = { minLevel, atCrosswalk, waiting, report, buzz };
    });
    const running = active && enabled;

    // 걸음 속도가 바뀌거나 인식을 켤 때마다 플러그인에 알린다. 멈추면 플러그인이 0으로 되돌린다.
    useEffect(() => {
        if (running && visionAvailable()) {
            setVisionWalkSpeed(walkSpeedMps);
        }
    }, [running, walkSpeedMps]);

    useEffect(() => {
        if (!running || !visionAvailable()) {
            return;
        }
        const read = visionReader();
        const readSignal = signalReader();
        const disconnect = connectVision(
            (next) => {
                const current = latest.current;
                setFrame(next);
                const cue = read(
                    next,
                    Date.now(),
                    current.minLevel,
                    current.waiting,
                );
                if (cue?.kind === 'alert') {
                    // 서 있을 때 앞에 사람이 있다는 말은 한 번만 하므로 버리지 않고 기다렸다 읽는다.
                    current.report(
                        cue.alert,
                        cue.alert.key === VISION_KEYS.waitingFront
                            ? 'wait'
                            : 'drop',
                    );
                } else if (cue?.kind === 'buzz') {
                    current.buzz(CAUTION_VIBRATION);
                }
                // 신호등은 바뀔 때 한 번만 알리므로 읽던 말이 끝난 뒤에라도 읽는다.
                const signal = readSignal(next.signal, current.atCrosswalk);
                if (signal) {
                    current.report(signal, 'wait');
                }
            },
            // 정면으로 다가오는 사람은 알아서 피하므로 알리지 않는다.
            undefined,
            (reason) => {
                dispatch({ type: 'failed', failure: reason });
                // 읽던 말이 끝난 뒤에라도 꼭 읽는다.
                latest.current.report(visionFailureAlert(reason), 'wait');
            },
            // 늦게 읽으면 이미 지나쳤거나 부딪힌 뒤라, 읽던 말이 곧 끝날 때만 기다렸다 읽는다.
            (obstacle) =>
                latest.current.report(obstacleAlert(obstacle), {
                    maxWaitMs: VISION.obstacleMaxWaitMs,
                }),
        );

        return () => {
            disconnect();
            setFrame(null);
            dispatch({ type: 'stopped' });
        };
    }, [running, attempt]);

    const setEnabled = useCallback(
        (on: boolean) => dispatch({ type: 'set', enabled: on }),
        [],
    );

    return useMemo(
        () => ({ frame, enabled, failure, setEnabled }),
        [frame, enabled, failure, setEnabled],
    );
}
