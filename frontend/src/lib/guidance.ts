// 길안내 엔진의 한 걸음: 새 위치가 들어올 때마다 진행 정도, 이탈, 미리 알림을 정한다.
// 무엇을 먼저 읽을지는 알림 중재(alertArbiter)가 정한다.

import type { Alert } from './alertArbiter';
import type { LngLat } from './geo';
import { ARRIVED_TEXT, eventText, REROUTE_TEXT } from './guidanceText';
import {
    judge,
    type Judgement,
    NEW_TRACKER,
    progressAlong,
    type RerouteTracker,
    type RouteLine,
    type RouteProgress,
    trackOffRoute,
} from './navigation';
import { dueEvents, eventKey, type RouteEvent } from './routeEvents';

export const ARRIVED_KEY = 'goal:arrived';
export const REROUTE_KEY = 'route:reroute';

/** 사용자가 고른 경로. 이벤트 목록은 백엔드가 경로마다 만들어 준다. */
export type GuidedRoute = RouteLine & { events: RouteEvent[] };

export type GuidanceState = {
    tracker: RerouteTracker;
    /** 이미 읽은 알림 key. 경로를 다시 찾아도 유지한다. */
    announced: ReadonlySet<string>;
};

export const NEW_GUIDANCE: GuidanceState = {
    tracker: NEW_TRACKER,
    announced: new Set(),
};

export type GuidanceStep = {
    /** 이 위치를 반영한 상태. 다음 위치에 넘긴다. */
    state: GuidanceState;
    progress: RouteProgress;
    judgement: Judgement;
    /** 지금 경로를 다시 찾아야 하는지 */
    reroute: boolean;
    /** 알림 중재로 보낼 알림. 읽은 뒤 markAnnounced 로 표시한다. */
    alerts: Alert[];
};

export function guidanceStep(
    route: GuidedRoute,
    state: GuidanceState,
    position: LngLat,
    accuracy: number,
): GuidanceStep {
    const progress = progressAlong(route, position);
    const judgement = judge(progress, accuracy);
    const { tracker, reroute } = trackOffRoute(
        state.tracker,
        judgement,
        position,
    );
    const alerts: Alert[] = [];
    if (judgement === 'arrived' && !state.announced.has(ARRIVED_KEY)) {
        alerts.push({ key: ARRIVED_KEY, level: 'route', text: ARRIVED_TEXT });
    }
    if (reroute) {
        alerts.push({ key: REROUTE_KEY, level: 'route', text: REROUTE_TEXT });
    }
    if (judgement === 'on_route') {
        for (const event of dueEvents(
            route.events,
            progress.travelledM,
            state.announced,
        )) {
            alerts.push({
                key: eventKey(event),
                level: event.kind === 'crowd' ? 'crowd' : 'route',
                text: eventText(event, event.distance_m - progress.travelledM),
            });
        }
    }
    return {
        state: { ...state, tracker },
        progress,
        judgement,
        reroute,
        alerts,
    };
}

/** 읽은 알림을 표시한다. 이벤트·도착 알림은 다시 읽지 않는다. */
export function markAnnounced(
    state: GuidanceState,
    alert: Alert,
): GuidanceState {
    if (alert.key === REROUTE_KEY) {
        return state;
    }
    return { ...state, announced: new Set([...state.announced, alert.key]) };
}
