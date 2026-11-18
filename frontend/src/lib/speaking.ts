// 지금 읽고 있는 말의 단계. 읽는 중에 같거나 낮은 단계 알림이 오면 끊지 않고 미루는 데 쓴다.

import { type AlertLevel, shouldInterrupt } from './alertArbiter';

export type SpeakingTracker = {
    /**
     * level 의 말을 읽기 시작한다. 돌려준 함수를 부르면 그 말을 다 읽은 것으로 본다.
     * 그사이 다른 말이 시작됐으면 그 함수는 아무것도 하지 않는다.
     */
    start: (level: AlertLevel) => () => void;
    /** 다른 말로 끊었을 때. 기다리던 알림을 깨워 새 말과 견주게 한다. */
    clear: () => void;
    /** 말을 모두 멈췄을 때(안내 종료). 기다리던 알림은 버린다. */
    stop: () => void;
    /** level 알림이 읽던 말을 끊지 못해 기다려야 하는지 */
    busyFor: (level: AlertLevel) => boolean;
    /** 읽던 말이 끝나면(또는 끊기면) 풀린다. */
    whenIdle: () => Promise<void>;
};

export function speakingTracker(): SpeakingTracker {
    let current: { level: AlertLevel } | null = null;
    let waiters: (() => void)[] = [];

    const clear = () => {
        current = null;
        const woken = waiters;
        waiters = [];
        for (const wake of woken) {
            wake();
        }
    };

    return {
        start(level) {
            const mine = { level };
            current = mine;
            return () => {
                if (current === mine) {
                    clear();
                }
            };
        },
        clear,
        stop() {
            current = null;
            waiters = [];
        },
        busyFor: (level) =>
            current !== null && !shouldInterrupt(current.level, level),
        whenIdle: () =>
            current === null
                ? Promise.resolve()
                : new Promise((resolve) => waiters.push(resolve)),
    };
}
