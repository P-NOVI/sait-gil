import { describe, expect, it, vi } from 'vitest';

import type { RouteEvent } from './routeEvents';
import {
    distanceLabel,
    fetchRoutes,
    mergedKindsNote,
    minutes,
    type PlannedRoute,
    remainingMinutes,
    routesAnnouncement,
    routeSummary,
    sameKindRoute,
} from './routeApi';

function route(overrides: Partial<PlannedRoute> = {}): PlannedRoute {
    return {
        kinds: ['recommended'],
        coordinates: [
            [127, 37.5],
            [127.001, 37.5],
        ],
        distances_m: [0, 88],
        distance_m: 1234,
        time_s: 900,
        congestion_score: 0.2,
        slope: { moderate_m: 0, hard_m: 0, score: 0 },
        events: [],
        ...overrides,
    };
}

const crowd: RouteEvent = {
    kind: 'crowd',
    distance_m: 100,
    position: [127, 37.5],
    direction: null,
};

describe('fetchRoutes', () => {
    it('출발·도착을 lng/lat 로 보내고, 없는 이름은 빼고 보낸다', async () => {
        const fetcher = vi
            .fn<typeof fetch>()
            .mockResolvedValue(
                new Response(JSON.stringify({ routes: [route()] })),
            );

        const routes = await fetchRoutes(
            { start: [127, 37.5], end: [127.01, 37.51], endName: '시청' },
            undefined,
            fetcher,
        );

        expect(routes).toHaveLength(1);
        expect(JSON.parse(String(fetcher.mock.calls[0][1]?.body))).toEqual({
            start: { lng: 127, lat: 37.5 },
            end: { lng: 127.01, lat: 37.51 },
            end_name: '시청',
        });
    });
});

describe('mergedKindsNote', () => {
    it('다른 기준이 없으면 null', () => {
        expect(mergedKindsNote(route())).toBeNull();
    });

    it('기준 하나에 더 뽑히면 한 문장으로 맺는다', () => {
        expect(
            mergedKindsNote(route({ kinds: ['recommended', 'gentle'] })),
        ).toBe('추천 경로가 가장 완만합니다.');
    });

    it('두 기준을 이어 쓰고 받침에 맞는 조사를 붙인다', () => {
        expect(
            mergedKindsNote(
                route({ kinds: ['recommended', 'less_crowded', 'gentle'] }),
            ),
        ).toBe('추천 경로가 가장 덜 붐비고 가장 완만합니다.');
        expect(
            mergedKindsNote(route({ kinds: ['less_crowded', 'gentle'] })),
        ).toBe('덜 붐비는 길이 가장 완만합니다.');
    });
});

describe('routeSummary', () => {
    it('거리, 시간, 붐비는 구간, 가파른 구간을 잇는다', () => {
        expect(
            routeSummary(
                route({
                    events: [crowd, { ...crowd, distance_m: 300 }],
                    slope: { moderate_m: 10, hard_m: 23.6, score: 1 },
                }),
            ),
        ).toBe('1.2km, 약 15분, 붐비는 구간 2곳, 가파른 구간 24m');
    });

    it('반올림해 0m 인 가파른 구간은 쓰지 않는다', () => {
        expect(
            routeSummary(
                route({ slope: { moderate_m: 0, hard_m: 0.4, score: 0 } }),
            ),
        ).toBe('1.2km, 약 15분, 붐비는 구간 없음');
    });

    it('붐비는 구간이 없으면 없음이라 쓴다', () => {
        expect(routeSummary(route({ distance_m: 420, time_s: 467 }))).toBe(
            '420m, 약 8분, 붐비는 구간 없음',
        );
    });
});

describe('routesAnnouncement', () => {
    it('경로가 없으면 못 찾았다고 알린다', () => {
        expect(routesAnnouncement([])).toBe('경로를 찾지 못했습니다.');
    });

    it('번호 순서로 시간과 붐비는 곳·가파른 곳만 짧게 알린다', () => {
        const text = routesAnnouncement([
            route(),
            route({ kinds: ['less_crowded'], time_s: 1089, distance_m: 980 }),
            route({
                kinds: ['gentle'],
                time_s: 1020,
                events: [crowd],
                slope: { moderate_m: 0, hard_m: 40.4, score: 0.1 },
            }),
        ]);

        expect(text).toBe(
            '경로 3개. 1번 추천 경로, 15분. 2번 덜 붐비는 길, 18분. ' +
                '3번 완만한 길, 17분, 붐비는 곳 1곳, 가파른 곳 40미터. ' +
                '원하는 경로를 고르고 안내 시작을 누르세요.',
        );
    });

    it('경로가 하나면 번호 없이 알리고 시작하는 방법만 말한다', () => {
        expect(routesAnnouncement([route()])).toBe(
            '경로 1개. 추천 경로, 15분. 안내 시작을 누르세요.',
        );
    });

    it('반올림해 0미터인 가파른 구간은 읽지 않는다', () => {
        const short = route({
            slope: { moderate_m: 0, hard_m: 0.4, score: 0 },
        });

        expect(routesAnnouncement([short])).not.toContain('가파른');
    });

    it('말로 고를 때는 말하는 방법으로 끝맺는다', () => {
        const text = routesAnnouncement([route()], '번호를 말하세요.');

        expect(text.endsWith('. 번호를 말하세요.')).toBe(true);
        expect(text).not.toContain('누르세요');
    });
});

describe('sameKindRoute', () => {
    it('같은 기준의 경로를 고르고, 없으면 첫 경로', () => {
        const recommended = route();
        const gentle = route({ kinds: ['gentle'] });

        expect(sameKindRoute([recommended, gentle], 'gentle')).toBe(gentle);
        expect(sameKindRoute([recommended], 'less_crowded')).toBe(recommended);
        expect(sameKindRoute([], 'gentle')).toBeNull();
    });
});

describe('distanceLabel, minutes', () => {
    it('1km 부터 킬로미터, 1분보다 짧아도 1분', () => {
        expect(distanceLabel(999.4)).toBe('999m');
        expect(distanceLabel(1000)).toBe('1.0km');
        expect(minutes(20)).toBe(1);
        expect(minutes(150)).toBe(3);
    });
});

describe('remainingMinutes', () => {
    it('경로 전체 시간을 남은 거리 비율만큼 쓴다', () => {
        // 1234m 를 900초에 걷는 경로의 절반쯤 남았다.
        expect(remainingMinutes(route(), 617)).toBe(8);
    });

    it('남은 거리가 경로보다 길어도 전체 시간을 넘지 않는다', () => {
        expect(remainingMinutes(route(), 5000)).toBe(15);
    });

    it('거리가 0 인 경로는 1분으로 본다', () => {
        expect(remainingMinutes(route({ distance_m: 0 }), 0)).toBe(1);
    });
});
