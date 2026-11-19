// 경로를 따라 걸을 때 내 위치가 경로 어디쯤인지, 벗어났는지 판단한다.
// 배리어프리 frontend/src/lib/navigation.ts 에서 가져왔다.

import { NAVIGATION, type NavigationSettings } from '../settings';
import { distanceM, type LngLat, toLocal } from './geo';

/** 따라갈 경로 선 */
export type RouteLine = {
    coordinates: LngLat[];
    /** 출발점부터 각 지점까지 누적 거리(m) */
    distances_m: number[];
};

export type RouteProgress = {
    /** 경로 선 위에서 내 위치와 가장 가까운 점 */
    snapped: LngLat;
    /** 출발점부터 snapped 까지 경로를 따라 간 거리(m) */
    travelledM: number;
    /** snapped 부터 경로 끝까지 남은 거리(m) */
    remainingM: number;
    /** 내 위치와 경로 선 사이 거리(m) */
    offRouteM: number;
};

export type Judgement = 'on_route' | 'off_route' | 'arrived' | 'uncertain';

export type RerouteTracker = {
    /** 경로를 벗어나기 시작한 때. 판단하지 못한 동안만큼 늦춰 둔다. 벗어나지 않았으면 null */
    offRouteSince: number | null;
    /** 벗어난 중에 오차가 큰 위치를 받기 시작한 때. 그런 위치가 아니면 null */
    pausedAt: number | null;
    /** 마지막으로 경로를 다시 찾은 곳 */
    reroutedAt: LngLat | null;
};

export const NEW_TRACKER: RerouteTracker = {
    offRouteSince: null,
    pausedAt: null,
    reroutedAt: null,
};

/** 경로에서 내 위치를 찾을 누적 거리 범위(m) */
export type SearchRange = { fromM: number; toM: number };

/**
 * 내 위치를 경로 선 위 가장 가까운 점에 맞춰 진행 정도를 계산한다.
 * range 를 주면 그 누적 거리 범위 안에서만 찾는다. 범위 안에 경로가 없으면 전체에서 찾는다.
 */
export function progressAlong(
    route: RouteLine,
    position: LngLat,
    range?: SearchRange,
): RouteProgress {
    const { coordinates, distances_m: distances } = route;
    const total = distances[distances.length - 1];
    const fromM = range?.fromM ?? -Infinity;
    const toM = range?.toM ?? Infinity;
    let best: Omit<RouteProgress, 'remainingM'> | null =
        fromM <= 0
            ? {
                  snapped: coordinates[0],
                  travelledM: 0,
                  offRouteM: distanceM(position, coordinates[0]),
              }
            : null;
    for (let i = 0; i + 1 < coordinates.length; i += 1) {
        if (distances[i + 1] < fromM || distances[i] > toM) {
            continue;
        }
        // 범위가 구간 일부만 덮으면 그 부분에서만 찾는다.
        const span = distances[i + 1] - distances[i];
        const tMin = span > 0 ? Math.max(0, (fromM - distances[i]) / span) : 0;
        const tMax = span > 0 ? Math.min(1, (toM - distances[i]) / span) : 1;
        // 내 위치를 원점으로 두고 구간 AB 위 가장 가까운 점 A + t(B - A) 를 찾는다.
        const [ax, ay] = toLocal(coordinates[i], position);
        const [bx, by] = toLocal(coordinates[i + 1], position);
        const dx = bx - ax;
        const dy = by - ay;
        const lengthSquared = dx * dx + dy * dy;
        const t =
            lengthSquared === 0
                ? tMin
                : Math.min(
                      tMax,
                      Math.max(tMin, -(ax * dx + ay * dy) / lengthSquared),
                  );
        const offRouteM = Math.hypot(ax + t * dx, ay + t * dy);
        if (!best || offRouteM < best.offRouteM) {
            const [lng1, lat1] = coordinates[i];
            const [lng2, lat2] = coordinates[i + 1];
            best = {
                snapped: [lng1 + t * (lng2 - lng1), lat1 + t * (lat2 - lat1)],
                travelledM:
                    distances[i] + t * (distances[i + 1] - distances[i]),
                offRouteM,
            };
        }
    }
    if (!best) {
        return progressAlong(route, position);
    }
    return { ...best, remainingM: total - best.travelledM };
}

/** 오차 반경이 accuracy 인 위치가 경로를 따라가는 중인지, 벗어났는지, 도착했는지 */
export function judge(
    progress: RouteProgress,
    accuracy: number,
    settings: NavigationSettings = NAVIGATION,
): Judgement {
    if (accuracy > settings.maxAccuracyM) {
        return 'uncertain';
    }
    if (progress.offRouteM > Math.max(settings.offRouteM, accuracy)) {
        return 'off_route';
    }
    return progress.remainingM <= settings.arrivalM ? 'arrived' : 'on_route';
}

/** 벗어난 시간을 잴 시작 시각. 판단하지 못하고 멈춰 있던 동안만큼 늦춘다. */
function offRouteStart(tracker: RerouteTracker, nowMs: number): number {
    if (tracker.offRouteSince === null) {
        return nowMs;
    }
    const pausedMs = tracker.pausedAt === null ? 0 : nowMs - tracker.pausedAt;
    return tracker.offRouteSince + pausedMs;
}

/**
 * 새 위치의 판단을 반영하고, 지금 경로를 다시 찾아야 하는지 알려 준다.
 * 경로로 돌아오면 처음부터 다시 잰다. 오차가 큰 위치(uncertain)를 받는 동안은 시계를 멈춰,
 * 판단하지 못한 시간은 빼고 그 전까지 벗어나 있던 시간은 남긴다.
 */
export function trackOffRoute(
    tracker: RerouteTracker,
    judgement: Judgement,
    position: LngLat,
    nowMs: number,
    settings: NavigationSettings = NAVIGATION,
): { tracker: RerouteTracker; reroute: boolean } {
    if (judgement === 'uncertain') {
        const pausedAt =
            tracker.offRouteSince === null ? null : (tracker.pausedAt ?? nowMs);
        return { tracker: { ...tracker, pausedAt }, reroute: false };
    }
    const offRouteSince =
        judgement === 'off_route' ? offRouteStart(tracker, nowMs) : null;
    const movedAway =
        !tracker.reroutedAt ||
        distanceM(tracker.reroutedAt, position) >= settings.rerouteMinMoveM;
    if (
        offRouteSince !== null &&
        nowMs - offRouteSince >= settings.offRouteMs &&
        movedAway
    ) {
        return {
            tracker: {
                offRouteSince: null,
                pausedAt: null,
                reroutedAt: position,
            },
            reroute: true,
        };
    }
    return {
        tracker: { ...tracker, offRouteSince, pausedAt: null },
        reroute: false,
    };
}
