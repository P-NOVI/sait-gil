import { describe, expect, it, vi } from 'vitest';

import type { RouteEvent } from './routeEvents';
import {
    distanceLabel,
    fetchRoutes,
    mergedKindsNote,
    minutes,
    type PlannedRoute,
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

    it('시간이 없으면 빼고, 붐비는 구간이 없으면 없음이라 쓴다', () => {
        expect(routeSummary(route({ distance_m: 420, time_s: null }))).toBe(
            '420m, 붐비는 구간 없음',
        );
    });
});

describe('routesAnnouncement', () => {
    it('경로가 없으면 못 찾았다고 알린다', () => {
        expect(routesAnnouncement([])).toBe('경로를 찾지 못했습니다.');
    });

    it('단위를 읽는 말로 바꿔 번호 순서로 알린다', () => {
        const text = routesAnnouncement([
            route(),
            route({ kinds: ['less_crowded'], distance_m: 980 }),
        ]);

        expect(text).toContain('경로를 2개 찾았습니다.');
        expect(text).toContain('1번 추천 경로, 1.2킬로미터, 약 15분');
        expect(text).toContain('2번 덜 붐비는 길, 980미터');
        expect(text).not.toMatch(/\d(km|m)\b/);
        expect(text.endsWith('안내 시작을 누르세요.')).toBe(true);
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
