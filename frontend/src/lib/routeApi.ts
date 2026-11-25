// 경로 3종(추천, 덜 붐비는 길, 완만한 길) 요청과 화면·음성에 쓸 설명.
// 응답 형식은 backend/app/routers/routes.py 의 RoutesResponse 와 같다.

import type { LngLat } from './geo';
import type { GuidedRoute } from './guidance';
import { postJson } from './http';

/** 경로가 뽑힌 기준. 한 경로가 여러 기준에 뽑히면 함께 온다. */
export type RouteKind = 'recommended' | 'less_crowded' | 'gentle';

export type RouteSlope = {
    /** 1/50 초과 1/12 이하 구간 길이(m) */
    moderate_m: number;
    /** 1/12 초과 구간 길이(m) */
    hard_m: number;
    score: number;
};

export type PlannedRoute = GuidedRoute & {
    kinds: RouteKind[];
    distance_m: number;
    /** 걷는 시간(초). 서버가 거리 ÷ 걸음 속도로 계산한다. */
    time_s: number;
    congestion_score: number;
    slope: RouteSlope;
};

export type RouteRequest = {
    start: LngLat;
    end: LngLat;
    startName?: string;
    endName?: string;
};

export const ROUTE_KIND_LABELS: Record<RouteKind, string> = {
    recommended: '추천 경로',
    less_crowded: '덜 붐비는 길',
    gentle: '완만한 길',
};

// 다른 기준에도 뽑혔을 때 붙이는 말. [이어 쓸 때, 문장을 맺을 때]
const KIND_CLAIMS: Record<
    Exclude<RouteKind, 'recommended'>,
    [string, string]
> = {
    less_crowded: ['가장 덜 붐비고', '가장 덜 붐빕니다'],
    gentle: ['가장 완만하고', '가장 완만합니다'],
};

/** 추천 경로, 덜 붐비는 길, 완만한 길 순서. 같은 경로는 한 번만 들어 있다. */
export async function fetchRoutes(
    { start, end, startName, endName }: RouteRequest,
    signal?: AbortSignal,
    fetcher?: typeof fetch,
): Promise<PlannedRoute[]> {
    const body = {
        start: { lng: start[0], lat: start[1] },
        end: { lng: end[0], lat: end[1] },
        ...(startName ? { start_name: startName } : {}),
        ...(endName ? { end_name: endName } : {}),
    };
    const response = await postJson<{ routes: PlannedRoute[] }>(
        '/api/routes',
        body,
        { signal },
        fetcher,
    );
    return response.routes;
}

/** 경로 이름. 처음 뽑힌 기준을 쓴다. */
export function routeTitle(route: PlannedRoute): string {
    return ROUTE_KIND_LABELS[route.kinds[0] ?? 'recommended'];
}

/** 받침이 있으면 '이', 없으면 '가' */
function subjectParticle(word: string): string {
    const code = word.charCodeAt(word.length - 1) - 0xac00;
    const hangul = code >= 0 && code <= 11171;
    return hangul && code % 28 !== 0 ? '이' : '가';
}

/**
 * 한 경로가 다른 기준에도 뽑혔을 때 덧붙이는 설명. 예: "추천 경로가 가장 덜 붐빕니다."
 * 다른 기준이 없으면 null
 */
export function mergedKindsNote(route: PlannedRoute): string | null {
    const [first, ...others] = route.kinds;
    const claims = others
        .filter((kind): kind is Exclude<RouteKind, 'recommended'> =>
            Object.hasOwn(KIND_CLAIMS, kind),
        )
        .map((kind) => KIND_CLAIMS[kind]);
    if (!first || claims.length === 0) {
        return null;
    }
    const title = ROUTE_KIND_LABELS[first];
    const words = claims.map(([joined, final], index) =>
        index === claims.length - 1 ? final : joined,
    );
    return `${title}${subjectParticle(title)} ${words.join(' ')}.`;
}

// 로그에 남길 점수 소수 자리
const LOG_SCORE_DIGITS = 3;

/**
 * 실기기 로그에 남길 경로 한 줄. 시연 때 경로별 혼잡 점수를 비교하려고 쓴다.
 * 위치가 드러나지 않게 좌표·장소 이름은 넣지 않는다.
 */
export function routeLogText(route: PlannedRoute): string {
    return [
        route.kinds.join('+'),
        `거리 ${Math.round(route.distance_m)}m`,
        `시간 ${Math.round(route.time_s)}s`,
        `혼잡 ${route.congestion_score.toFixed(LOG_SCORE_DIGITS)}`,
        `붐비는 구간 ${crowdedSpots(route)}`,
        `경사 ${route.slope.score.toFixed(LOG_SCORE_DIGITS)}`,
    ].join(' ');
}

/** 경로 위 붐비는 구간 수 */
export function crowdedSpots(route: PlannedRoute): number {
    return route.events.filter((event) => event.kind === 'crowd').length;
}

/** 화면에 보일 거리. 1km 부터는 킬로미터 */
export function distanceLabel(meters: number): string {
    if (meters >= 1000) {
        return `${(meters / 1000).toFixed(1)}km`;
    }
    return `${Math.round(meters)}m`;
}

/** 걷는 시간(분). 1분보다 짧아도 1분으로 본다. */
export function minutes(seconds: number): number {
    return Math.max(1, Math.round(seconds / 60));
}

/** 남은 거리를 걷는 시간(분). 경로 전체 시간을 남은 거리 비율만큼 쓴다. */
export function remainingMinutes(
    route: PlannedRoute,
    remainingM: number,
): number {
    const share =
        route.distance_m > 0 ? Math.min(1, remainingM / route.distance_m) : 0;
    return minutes(route.time_s * share);
}

/** 보이고 읽을 가파른 구간 길이(m). 반올림해 0 이면 알리지 않는다. */
function hardSlopeM(route: PlannedRoute): number {
    return Math.round(route.slope.hard_m);
}

/** 화면에 보일 경로 한 줄 요약 */
export function routeSummary(route: PlannedRoute): string {
    const parts = [
        distanceLabel(route.distance_m),
        `약 ${minutes(route.time_s)}분`,
    ];
    const crowded = crowdedSpots(route);
    parts.push(crowded > 0 ? `붐비는 구간 ${crowded}곳` : '붐비는 구간 없음');
    const hard = hardSlopeM(route);
    if (hard > 0) {
        parts.push(`가파른 구간 ${hard}m`);
    }
    return parts.join(', ');
}

/**
 * 음성으로 읽을 경로 한 줄. 짧게 듣도록 거리 대신 시간을 읽고,
 * 붐비는 곳·가파른 곳은 있을 때만 읽는다.
 */
function spokenSummary(route: PlannedRoute): string {
    const parts = [`${minutes(route.time_s)}분`];
    const crowded = crowdedSpots(route);
    if (crowded > 0) {
        parts.push(`붐비는 곳 ${crowded}곳`);
    }
    const hard = hardSlopeM(route);
    if (hard > 0) {
        parts.push(`가파른 곳 ${hard}미터`);
    }
    return parts.join(', ');
}

const CHOOSE_BY_TAP = '원하는 경로를 고르고 안내 시작을 누르세요.';
// 경로가 하나면 고를 것이 없으므로 시작하는 방법만 알린다.
const START_BY_TAP = '안내 시작을 누르세요.';

/**
 * 경로를 찾았을 때 읽어 줄 문장. 추천 경로부터 순서대로 알리고,
 * 끝에 고르는 방법(closing)을 덧붙인다. 말로 고를 때는 묻는 말을 넘긴다.
 * 경로가 하나면 번호를 붙이지 않는다.
 */
export function routesAnnouncement(
    routes: readonly PlannedRoute[],
    closing = routes.length === 1 ? START_BY_TAP : CHOOSE_BY_TAP,
): string {
    if (routes.length === 0) {
        return '경로를 찾지 못했습니다.';
    }
    const items = routes.map((route, index) => {
        const order = routes.length === 1 ? '' : `${index + 1}번 `;
        const note = mergedKindsNote(route);
        return `${order}${routeTitle(route)}, ${spokenSummary(route)}.${note ? ` ${note}` : ''}`;
    });
    return [`경로 ${routes.length}개.`, ...items, closing].join(' ');
}

/** 다시 찾은 경로 중 전에 고른 기준과 같은 경로. 없으면 추천 경로 */
export function sameKindRoute(
    routes: readonly PlannedRoute[],
    kind: RouteKind,
): PlannedRoute | null {
    return (
        routes.find((route) => route.kinds.includes(kind)) ?? routes[0] ?? null
    );
}
