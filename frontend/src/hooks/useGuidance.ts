import { useEffect, useRef, useState } from 'react';

import type { AlertLevel } from '../lib/alertArbiter';
import { pickAlert } from '../lib/alertArbiter';
import type { LngLat } from '../lib/geo';
import {
    type GuidanceStep,
    type GuidedRoute,
    guidanceStep,
    markAnnounced,
    NEW_GUIDANCE,
} from '../lib/guidance';
import {
    allowScreenOff,
    keepScreenOn,
    type LocationFix,
    watchLocation,
} from '../platform';

export type Guidance = {
    /** 마지막으로 받은 위치 */
    fix: LocationFix | null;
    /** 마지막 위치로 계산한 진행 정도·판단 */
    step: GuidanceStep | null;
    /** 마지막으로 알린 문장. 화면에도 보이고 다시 듣기에 쓴다. */
    lastAlert: string | null;
    /** 위치를 받지 못할 때의 이유 */
    error: string | null;
};

type Options = {
    active: boolean;
    route: GuidedRoute | null;
    announce: (text: string, level?: AlertLevel) => void;
    /** 경로를 벗어났을 때. 이 위치를 출발지로 경로를 다시 찾는다. */
    onReroute: (position: LngLat) => void;
};

const IDLE: Guidance = { fix: null, step: null, lastAlert: null, error: null };

/**
 * 안내 중 GPS 위치를 받을 때마다 길안내 엔진을 한 걸음 돌린다.
 * 알릴 것이 여럿이면 알림 중재(위험 > 경로 > 혼잡)로 하나만 고르고, 나머지는 다음 위치에서 다시 고른다.
 */
export function useGuidance({
    active,
    route,
    announce,
    onReroute,
}: Options): Guidance {
    const [guidance, setGuidance] = useState<Guidance>(IDLE);
    // 위치 콜백이 최신 값을 쓰도록 ref 에 둔다.
    const latest = useRef({ route, announce, onReroute });
    useEffect(() => {
        latest.current = { route, announce, onReroute };
    });

    useEffect(() => {
        if (!active) {
            return;
        }
        let state = NEW_GUIDANCE;
        const spokenAt = new Map<string, number>();
        void keepScreenOn().catch(() => false);

        const stop = watchLocation(
            (fix) => {
                const current = latest.current;
                if (!current.route) {
                    setGuidance((previous) => ({
                        ...previous,
                        fix,
                        error: null,
                    }));
                    return;
                }
                const step = guidanceStep(
                    current.route,
                    state,
                    fix.position,
                    fix.accuracy,
                );
                state = step.state;
                const now = Date.now();
                const alert = pickAlert(step.alerts, spokenAt, now);
                if (alert) {
                    spokenAt.set(alert.key, now);
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
                    error: null,
                }));
            },
            (error) =>
                setGuidance((previous) => ({
                    ...previous,
                    error: error.message,
                })),
        );

        return () => {
            stop();
            void allowScreenOff().catch(() => undefined);
            setGuidance(IDLE);
        };
    }, [active]);

    return guidance;
}
