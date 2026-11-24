import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import type { Alert, AlertLevel, WhenBusy } from '../lib/alertArbiter';
import { pickAlert, stillTimely } from '../lib/alertArbiter';
import type { LngLat } from '../lib/geo';
import {
    APPROXIMATE_KEY,
    ARRIVED_KEY,
    deadReckon,
    type GuidanceStep,
    type GuidedRoute,
    guidanceStep,
    LOCATION_LOST_KEY,
    markAnnounced,
    NEW_GUIDANCE,
} from '../lib/guidance';
import {
    filterFix,
    type Motion,
    NEW_LOCATION_FILTER,
} from '../lib/locationFilter';
import {
    allowScreenOff,
    APPROXIMATE_TEXT,
    keepScreenOn,
    type LocationFix,
    watchLocation,
    watchSteps,
} from '../platform';
import { LOCATION_FILTER, LOCATION_LOST_COOLDOWN_MS } from '../settings';

export type Guidance = {
    /** 마지막으로 받은 위치 */
    fix: LocationFix | null;
    /** 마지막 위치로 계산한 진행 정도·판단 */
    step: GuidanceStep | null;
    /** 마지막으로 알린 문장. 화면에도 보이고 다시 듣기에 쓴다. */
    lastAlert: string | null;
    /** 위치를 받지 못하거나 대략적인 위치만 받을 때의 이유 */
    error: string | null;
};

type Options = {
    active: boolean;
    route: GuidedRoute | null;
    announce: (text: string, level?: AlertLevel) => void;
    /** level 알림이 읽던 말을 끊지 못해 기다려야 하는지 */
    busyFor: (level: AlertLevel) => boolean;
    /** 읽던 말이 끝나면 풀린다. */
    whenIdle: () => Promise<void>;
    /** 경로를 벗어났을 때. 이 위치를 출발지로 경로를 다시 찾는다. */
    onReroute: (position: LngLat) => void;
    /** 도착 안내를 읽기 시작한 뒤. 읽는 말을 끊지 않고 안내를 끝낸다. */
    onArrive: () => void;
};

export type GuidanceControl = Guidance & {
    /**
     * 안내 중 생긴 알림(오류·인파 등)을 알림 중재의 쿨다운을 거쳐 읽는다.
     * 읽던 말을 끊지 못하면 whenBusy 에 따라 기다리거나 버린다.
     */
    report: (alert: Alert, whenBusy?: WhenBusy) => void;
};

const IDLE: Guidance = { fix: null, step: null, lastAlert: null, error: null };

/**
 * 안내 중 GPS 위치를 받을 때마다 길안내 엔진을 한 걸음 돌린다.
 * 알릴 것이 여럿이면 알림 중재(위험 > 경로 > 혼잡)로 하나만 고르고, 나머지는 다음 위치에서 다시 고른다.
 * 읽던 말보다 높은 단계가 아니면 끊지 않고 미룬다.
 */
export function useGuidance({
    active,
    route,
    announce,
    busyFor,
    whenIdle,
    onReroute,
    onArrive,
}: Options): GuidanceControl {
    const [guidance, setGuidance] = useState<Guidance>(IDLE);
    // 위치 콜백이 최신 값을 쓰도록 ref 에 둔다.
    const latest = useRef({
        route,
        announce,
        busyFor,
        whenIdle,
        onReroute,
        onArrive,
    });
    useEffect(() => {
        latest.current = {
            route,
            announce,
            busyFor,
            whenIdle,
            onReroute,
            onArrive,
        };
    });
    // key 별 마지막으로 읽은 시각. 안내를 시작할 때마다 비운다.
    const spokenAt = useRef(new Map<string, number>());
    // 안내를 시작하고 끝낼 때마다 늘린다. 기다리던 알림은 안내가 바뀌면 버린다.
    const session = useRef(0);

    const report = useCallback((alert: Alert, whenBusy: WhenBusy = 'wait') => {
        const mine = session.current;
        const reportedAt = Date.now();
        const tell = () => {
            if (session.current !== mine) {
                return;
            }
            const current = latest.current;
            const now = Date.now();
            if (
                !stillTimely(whenBusy, now - reportedAt) ||
                !pickAlert([alert], spokenAt.current, now)
            ) {
                return;
            }
            if (current.busyFor(alert.level)) {
                if (whenBusy !== 'drop') {
                    void current.whenIdle().then(tell);
                }
                return;
            }
            spokenAt.current.set(alert.key, now);
            current.announce(alert.text, alert.level);
        };
        tell();
    }, []);

    useEffect(() => {
        if (!active) {
            return;
        }
        let state = NEW_GUIDANCE;
        let filter = NEW_LOCATION_FILTER;
        spokenAt.current = new Map();
        session.current += 1;
        void keepScreenOn().catch(() => false);

        // 걸음 센서를 쓸 수 있으면 누적 걸음 수가 들어온다. 쓸 수 없으면 null 로 남아 시간 기준으로 거른다.
        let steps: number | null = null;
        // 직전 길안내 걸음을 돌렸을 때의 걸음 수. 이후 걸은 만큼 경로 위 내 위치를 추정한다.
        let stepsAtLast: number | null = null;
        const stopSteps = watchSteps((total) => {
            steps = total;
        });

        const stop = watchLocation(
            (received) => {
                const now = Date.now();
                const current = latest.current;
                const motion: Motion | undefined =
                    steps === null
                        ? undefined
                        : {
                              steps,
                              expected:
                                  current.route && stepsAtLast !== null
                                      ? deadReckon(
                                            current.route,
                                            state.last,
                                            (steps - stepsAtLast) *
                                                LOCATION_FILTER.stepLengthM,
                                        )
                                      : null,
                          };
                const filtered = filterFix(
                    filter,
                    received,
                    now,
                    LOCATION_FILTER,
                    motion,
                );
                filter = filtered.state;
                let { fix } = filtered;
                // 걸음 수와 맞지 않아 믿지 않는 동안에는 걸음 수로 추정한 경로 위 위치로 안내를 잇는다.
                // 경로를 벗어난 것으로 보지 않아 다시 찾지 않는다. 믿지 않는 시간에는 상한이 있다(distrustLimitMs).
                if (!fix && filtered.distrusted && motion?.expected) {
                    fix = {
                        position: motion.expected,
                        accuracy: LOCATION_FILTER.estimatedAccuracyM,
                    };
                }
                // 튄 위치는 지도와 안내에 쓰지 않고 다음 위치를 기다린다.
                if (!fix) {
                    return;
                }
                // 대략적인 위치로는 판단을 계속 보류해 말없이 멈추므로, 이유를 안내마다 한 번 읽는다.
                // 읽는 중이면 버리고 다음 위치에서 다시 넘긴다.
                const error = fix.approximate ? APPROXIMATE_TEXT : null;
                if (fix.approximate) {
                    report(
                        {
                            key: APPROXIMATE_KEY,
                            level: 'route',
                            text: APPROXIMATE_TEXT,
                            cooldownMs: Infinity,
                        },
                        'drop',
                    );
                }
                if (!current.route) {
                    setGuidance((previous) => ({
                        ...previous,
                        fix,
                        error,
                    }));
                    return;
                }
                const step = guidanceStep(
                    current.route,
                    state,
                    fix.position,
                    fix.accuracy,
                    now,
                );
                state = step.state;
                stepsAtLast = steps;
                const picked = pickAlert(step.alerts, spokenAt.current, now);
                // 읽는 중이라 미룬 알림은 표시하지 않아 다음 위치에서 다시 고른다.
                const alert =
                    picked && !current.busyFor(picked.level) ? picked : null;
                if (alert) {
                    spokenAt.current.set(alert.key, now);
                    state = markAnnounced(state, alert);
                    current.announce(alert.text, alert.level);
                }
                if (step.reroute) {
                    current.onReroute(fix.position);
                }
                setGuidance((previous) => ({
                    fix,
                    step,
                    lastAlert: alert?.text ?? previous.lastAlert,
                    error,
                }));
                if (alert?.key === ARRIVED_KEY) {
                    current.onArrive();
                }
            },
            (error) => {
                report({
                    key: LOCATION_LOST_KEY,
                    level: 'route',
                    text: error.message,
                    cooldownMs: LOCATION_LOST_COOLDOWN_MS,
                });
                setGuidance((previous) => ({
                    ...previous,
                    error: error.message,
                }));
            },
        );

        return () => {
            session.current += 1;
            stop();
            stopSteps();
            void allowScreenOff().catch(() => undefined);
            setGuidance(IDLE);
        };
    }, [active, report]);

    return useMemo(() => ({ ...guidance, report }), [guidance, report]);
}
