// 길안내 엔진의 한 걸음: 새 위치가 들어올 때마다 진행 정도, 이탈, 미리 알림을 정한다.
// 무엇을 먼저 읽을지는 알림 중재(alertArbiter)가 정한다.

import type { LocationFix } from '../platform';
import { NAVIGATION } from '../settings';
import type { Alert } from './alertArbiter';
import type { LngLat } from './geo';
import {
    ARRIVED_END_TEXT,
    blockText,
    eventText,
    REROUTE_TEXT,
    STRAIGHT_TEXT,
} from './guidanceText';
import {
    judge,
    type Judgement,
    NEW_TRACKER,
    pointAt,
    progressAlong,
    type RerouteTracker,
    type RouteLine,
    type RouteProgress,
    type SearchRange,
    trackOffRoute,
} from './navigation';
import {
    blockKey,
    dueBlockAlert,
    dueEvents,
    eventKey,
    type RouteEvent,
} from './routeEvents';

export const ARRIVED_KEY = 'goal:arrived';
export const REROUTE_KEY = 'route:reroute';

/**
 * 걸음 수로 추정한 위치(estimated)로는 도착을 알리지 않는다.
 * 추정 위치는 걸음 수 오차가 쌓여 실제보다 앞서 목적지에 닿을 수 있어, 도착은 믿는 GPS 위치로만 판정한다.
 */
export function withoutArrival(
    alerts: readonly Alert[],
    estimated: boolean,
): Alert[] {
    return estimated
        ? alerts.filter((alert) => alert.key !== ARRIVED_KEY)
        : [...alerts];
}
export const REROUTE_FAILED_KEY = 'route:reroute-failed';
export const LOCATION_LOST_KEY = 'location:lost';
export const APPROXIMATE_KEY = 'location:approximate';

/** 사용자가 고른 경로. 이벤트 목록은 백엔드가 경로마다 만들어 준다. */
export type GuidedRoute = RouteLine & { events: RouteEvent[] };

export type GuidanceState = {
    tracker: RerouteTracker;
    /** 이미 읽은 알림 key. 경로를 다시 찾아도 유지한다. */
    announced: ReadonlySet<string>;
    /** 직전 위치의 진행 정도. 다음 위치는 이 근처 경로에서 찾는다. */
    last: { route: GuidedRoute; travelledM: number; atMs: number } | null;
};

export const NEW_GUIDANCE: GuidanceState = {
    tracker: NEW_TRACKER,
    announced: new Set(),
    last: null,
};

/**
 * 직전 진행 위치에서 그동안 걸어서 갈 수 있는 앞뒤 범위.
 * 처음이거나 경로를 다시 찾았으면 범위 없이 경로 전체에서 찾는다.
 */
function reachable(
    route: GuidedRoute,
    last: GuidanceState['last'],
    accuracy: number,
    nowMs: number,
): SearchRange | undefined {
    if (!last || last.route !== route) {
        return undefined;
    }
    const elapsedS = Math.max(0, nowMs - last.atMs) / 1000;
    const reachM = NAVIGATION.maxWalkSpeedMps * elapsedS + accuracy;
    return { fromM: last.travelledM - reachM, toM: last.travelledM + reachM };
}

/**
 * 직전 진행 위치에서 walkedM 만큼 경로를 따라 더 간 경로 위 점. 걸음 수로 추정한 내 위치다.
 * 직전 진행이 없거나 경로를 다시 찾았으면 추정할 수 없어 null 이다.
 */
export function deadReckon(
    route: GuidedRoute,
    last: GuidanceState['last'],
    walkedM: number,
): LngLat | null {
    if (!last || last.route !== route) {
        return null;
    }
    return pointAt(route, last.travelledM + Math.max(0, walkedM));
}

export type GuidanceStep = {
    /** 이 위치를 반영한 상태. 다음 위치에 넘긴다. */
    state: GuidanceState;
    progress: RouteProgress;
    /** 이 위치 하나로 본 판단. 한 번 튄 위치로도 off_route 가 나온다. */
    judgement: Judgement;
    /**
     * 경로 이탈이 확정됐는지(trackOffRoute). 그 전에는 위치가 잠깐 튄 것으로 보고
     * 경로를 따라가는 것으로 보여 준다.
     */
    offRoute: boolean;
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
    nowMs: number,
): GuidanceStep {
    const progress = progressAlong(
        route,
        position,
        reachable(route, state.last, accuracy, nowMs),
    );
    const judgement = judge(progress, accuracy);
    const { tracker, reroute, offRoute } = trackOffRoute(
        state.tracker,
        judgement,
        position,
        nowMs,
    );
    const alerts: Alert[] = [];
    if (judgement === 'arrived' && !state.announced.has(ARRIVED_KEY)) {
        alerts.push({
            key: ARRIVED_KEY,
            level: 'route',
            text: ARRIVED_END_TEXT,
        });
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
        // 한 위치에 하나만 읽으므로 가까운 지점 알림이 먼저 나가도록 뒤에 둔다.
        const block = dueBlockAlert(
            route.events,
            progress.travelledM,
            state.announced,
        );
        if (block) {
            alerts.push({
                key: blockKey(block.event, block.far),
                level: 'route',
                text: block.far ? STRAIGHT_TEXT : blockText(block.event),
            });
        }
    }
    return {
        state: {
            ...state,
            tracker,
            last: { route, travelledM: progress.travelledM, atMs: nowMs },
        },
        progress,
        judgement,
        offRoute,
        reroute,
        alerts,
    };
}

/**
 * 화면에 그릴 내 위치. 이탈이 확정되기 전에는 경로 선 위(progress.snapped)에 붙여
 * GPS 가 옆으로 튀어도 흔들리지 않게 한다. 이탈이 확정됐거나 경로를 다시 찾는 중이면 실제 위치를 쓴다.
 */
export function shownFix(
    fix: LocationFix,
    step: GuidanceStep | null,
    rerouting: boolean,
): LocationFix {
    if (!step || step.offRoute || rerouting) {
        return fix;
    }
    return { ...fix, position: step.progress.snapped };
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
