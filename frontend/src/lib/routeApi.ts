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
    /** Tmap 예상 시간(초). 없을 수 있다. */
    time_s: number | null;
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

/** 경로 한 줄 요약. 화면과 음성에 같이 쓴다. */
export function routeSummary(route: PlannedRoute): string {
    const parts = [distanceLabel(route.distance_m)];
    if (route.time_s !== null) {
        parts.push(`약 ${minutes(route.time_s)}분`);
    }
    const crowded = crowdedSpots(route);
    parts.push(crowded > 0 ? `붐비는 구간 ${crowded}곳` : '붐비는 구간 없음');
    if (route.slope.hard_m > 0) {
        parts.push(`가파른 구간 ${Math.round(route.slope.hard_m)}m`);
    }
    return parts.join(', ');
}

const CHOOSE_BY_TAP = '원하는 경로를 고르고 안내 시작을 누르세요.';

/**
 * 경로를 찾았을 때 읽어 줄 문장. 추천 경로부터 순서대로 알리고,
 * 끝에 고르는 방법(closing)을 덧붙인다. 말로 고를 때는 말하는 방법을 넘긴다.
 */
export function routesAnnouncement(
    routes: readonly PlannedRoute[],
    closing = CHOOSE_BY_TAP,
): string {
    if (routes.length === 0) {
        return '경로를 찾지 못했습니다.';
    }
    const items = routes.map((route, index) => {
        const note = mergedKindsNote(route);
        const summary = routeSummary(route)
            .replace(/(\d+(?:\.\d+)?)km/g, '$1킬로미터')
            .replace(/(\d+)m/g, '$1미터');
        return `${index + 1}번 ${routeTitle(route)}, ${summary}.${note ? ` ${note}` : ''}`;
    });
    const intro =
        routes.length === 1
            ? '경로를 하나 찾았습니다.'
            : `경로를 ${routes.length}개 찾았습니다.`;
    return [intro, ...items, closing].join(' ');
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
