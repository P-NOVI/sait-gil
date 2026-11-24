import { describe, expect, it } from 'vitest';

import { NAVIGATION } from '../settings';
import { distanceM, type LngLat } from './geo';
import {
    judge,
    NEW_TRACKER,
    pointAt,
    progressAlong,
    type RouteLine,
    type RouteProgress,
    trackOffRoute,
} from './navigation';

// ㄱ자 경로: A 에서 동쪽으로 B, B 에서 북쪽으로 C.
// 누적 거리는 경로 응답처럼 실제 길 길이라 좌표 사이 직선거리와 다를 수 있다.
const A: LngLat = [126.97, 37.56];
const B: LngLat = [126.971, 37.56];
const C: LngLat = [126.971, 37.561];
const ROUTE: RouteLine = { coordinates: [A, B, C], distances_m: [0, 100, 300] };

// 위도 37.56 에서 경도 0.0001° ≈ 8.8m, 위도 0.0001° ≈ 11.1m
const north = ([lng, lat]: LngLat, meters: number): LngLat => [
    lng,
    lat + meters / 111_195,
];

function progress(offRouteM: number, remainingM: number): RouteProgress {
    return { snapped: A, travelledM: 0, offRouteM, remainingM };
}

describe('distanceM', () => {
    it('남북 1° 는 약 111km', () => {
        expect(distanceM([127, 37], [127, 38])).toBeCloseTo(111_195, -1);
    });
});

describe('progressAlong', () => {
    it('경로 위 위치는 그 자리의 누적 거리를 비율로 나눠 쓴다', () => {
        const result = progressAlong(ROUTE, [126.9705, 37.56]);

        expect(result.offRouteM).toBeCloseTo(0, 6);
        expect(result.travelledM).toBeCloseTo(50, 6);
        expect(result.remainingM).toBeCloseTo(250, 6);
        expect(result.snapped[0]).toBeCloseTo(126.9705, 9);
    });

    it('경로 옆 위치는 가장 가까운 구간에 맞추고 떨어진 거리를 잰다', () => {
        const result = progressAlong(ROUTE, north([126.9705, 37.56], 10));

        expect(result.offRouteM).toBeCloseTo(10, 3);
        expect(result.travelledM).toBeCloseTo(50, 3);
        expect(result.snapped[1]).toBeCloseTo(37.56, 9);
    });

    it('두 번째 구간 옆이면 두 번째 구간에서 잰다', () => {
        const result = progressAlong(ROUTE, [126.97105, 37.5605]);

        expect(result.travelledM).toBeCloseTo(200, 3);
        expect(result.offRouteM).toBeCloseTo(4.4, 1);
    });

    it('출발점 앞이면 출발점, 끝을 지나면 끝점에 맞춘다', () => {
        const before = progressAlong(ROUTE, [126.9695, 37.56]);
        const after = progressAlong(ROUTE, north(C, 30));

        expect(before.snapped).toEqual(A);
        expect(before.travelledM).toBe(0);
        expect(after.snapped[1]).toBeCloseTo(C[1], 9);
        expect(after.remainingM).toBeCloseTo(0, 6);
        expect(after.offRouteM).toBeCloseTo(30, 3);
    });

    it('지점이 하나뿐인 경로(출발 = 도착)', () => {
        const result = progressAlong(
            { coordinates: [A], distances_m: [0] },
            north(A, 5),
        );

        expect(result.remainingM).toBe(0);
        expect(result.offRouteM).toBeCloseTo(5, 3);
    });

    it('범위를 주면 더 가까운 구간이 있어도 범위 안에서 찾는다', () => {
        // 두 번째 구간(200m) 옆이지만 0~60m 만 찾으면 첫 구간 60m 지점에 맞춘다.
        const result = progressAlong(ROUTE, [126.97105, 37.5605], {
            fromM: 0,
            toM: 60,
        });

        expect(result.travelledM).toBeCloseTo(60, 6);
        expect(result.offRouteM).toBeGreaterThan(50);
    });

    it('범위가 출발점 뒤에서 시작하면 출발점이 아니라 범위 시작에 맞춘다', () => {
        const result = progressAlong(ROUTE, [126.9695, 37.56], {
            fromM: 10,
            toM: 50,
        });

        expect(result.travelledM).toBeCloseTo(10, 6);
    });

    it('범위 안에 경로가 없으면 전체에서 찾는다', () => {
        const result = progressAlong(ROUTE, [126.97105, 37.5605], {
            fromM: 400,
            toM: 500,
        });

        expect(result.travelledM).toBeCloseTo(200, 3);
    });
});

describe('judge', () => {
    it.each([
        ['오차가 크면 판단하지 않는다', progress(100, 200), 80, 'uncertain'],
        ['경로에서 멀면 이탈', progress(30, 200), 10, 'off_route'],
        ['오차 안이면 이탈로 보지 않는다', progress(30, 200), 40, 'on_route'],
        ['끝이 가까우면 도착', progress(5, 7), 3, 'arrived'],
        ['도착 거리보다 멀면 계속 안내', progress(5, 9), 3, 'on_route'],
        ['오차가 크면 오차만큼 넓혀 도착', progress(5, 12), 12, 'arrived'],
        ['넓히는 데는 상한이 있다', progress(5, 20), 30, 'on_route'],
        ['끝이 가까워도 경로에서 멀면 이탈', progress(40, 15), 10, 'off_route'],
    ] as const)('%s', (_, given, accuracy, expected) => {
        expect(judge(given, accuracy)).toBe(expected);
    });
});

describe('trackOffRoute', () => {
    const here: LngLat = [126.97, 37.56];
    const { offRouteMs } = NAVIGATION;

    it('벗어난 채로 정한 시간이 지나야 다시 찾는다', () => {
        const first = trackOffRoute(NEW_TRACKER, 'off_route', here, 0);
        const soon = trackOffRoute(
            first.tracker,
            'off_route',
            here,
            offRouteMs - 1,
        );
        const later = trackOffRoute(
            soon.tracker,
            'off_route',
            here,
            offRouteMs,
        );

        expect(first.reroute).toBe(false);
        expect(first.offRoute).toBe(false);
        expect(soon.reroute).toBe(false);
        expect(soon.offRoute).toBe(false);
        expect(later.reroute).toBe(true);
        expect(later.offRoute).toBe(true);
        expect(later.tracker).toEqual({
            offRouteSince: null,
            pausedAt: null,
            reroutedAt: here,
        });
    });

    it('위치를 자주 받아도 횟수만으로는 다시 찾지 않는다', () => {
        let tracker = NEW_TRACKER;
        const reroutes = [0, 1_000, 2_000, 3_000].map((nowMs) => {
            const result = trackOffRoute(tracker, 'off_route', here, nowMs);
            tracker = result.tracker;
            return result.reroute;
        });

        expect(reroutes).toEqual([false, false, false, false]);
    });

    it('사이에 경로로 돌아오면 처음부터 다시 잰다', () => {
        let tracker = trackOffRoute(NEW_TRACKER, 'off_route', here, 0).tracker;
        tracker = trackOffRoute(tracker, 'on_route', here, 1_000).tracker;
        const result = trackOffRoute(tracker, 'off_route', here, offRouteMs);

        expect(result.reroute).toBe(false);
        expect(result.tracker.offRouteSince).toBe(offRouteMs);
    });

    it('오차가 큰 위치를 받은 동안은 빼고, 그 전에 벗어나 있던 시간은 남긴다', () => {
        let tracker = trackOffRoute(NEW_TRACKER, 'off_route', here, 0).tracker;
        tracker = trackOffRoute(tracker, 'uncertain', here, 5_000).tracker;
        tracker = trackOffRoute(tracker, 'uncertain', here, 20_000).tracker;
        // 5초 벗어나 있다가 실내 등에서 30초 동안 판단하지 못했다.
        const back = trackOffRoute(tracker, 'off_route', here, 35_000);
        const soon = trackOffRoute(
            back.tracker,
            'off_route',
            here,
            30_000 + offRouteMs - 1,
        );
        const later = trackOffRoute(
            soon.tracker,
            'off_route',
            here,
            30_000 + offRouteMs,
        );

        expect(tracker.offRouteSince).toBe(0);
        expect(tracker.pausedAt).toBe(5_000);
        expect(back.reroute).toBe(false);
        expect(back.tracker.offRouteSince).toBe(30_000);
        expect(soon.reroute).toBe(false);
        expect(later.reroute).toBe(true);
    });

    it('벗어나지 않은 중에 받은 오차가 큰 위치는 시계를 멈추지 않는다', () => {
        let tracker = trackOffRoute(NEW_TRACKER, 'on_route', here, 0).tracker;
        tracker = trackOffRoute(tracker, 'uncertain', here, 1_000).tracker;
        const result = trackOffRoute(tracker, 'off_route', here, 5_000);

        expect(tracker.pausedAt).toBeNull();
        expect(result.tracker.offRouteSince).toBe(5_000);
    });

    it('다시 찾은 곳에서 충분히 움직이기 전에는 또 찾지 않지만 이탈은 확정한다', () => {
        const tracker = { offRouteSince: 0, pausedAt: null, reroutedAt: here };
        const near = trackOffRoute(
            tracker,
            'off_route',
            north(here, 10),
            offRouteMs,
        );

        expect(near.reroute).toBe(false);
        expect(near.offRoute).toBe(true);
        expect(
            trackOffRoute(tracker, 'off_route', north(here, 40), offRouteMs)
                .reroute,
        ).toBe(true);
    });

    it('판단하지 못하는 동안에는 멈춘 때의 이탈 확정 여부를 그대로 둔다', () => {
        const confirmed = {
            offRouteSince: 0,
            pausedAt: null,
            reroutedAt: here,
        };
        // 1초 벗어나 있다가 판단하지 못하기 시작했다.
        const early = { ...confirmed, pausedAt: 1_000 };
        const later = offRouteMs + 60_000;

        expect(
            trackOffRoute(confirmed, 'uncertain', here, offRouteMs).offRoute,
        ).toBe(true);
        expect(trackOffRoute(early, 'uncertain', here, later).offRoute).toBe(
            false,
        );
        expect(
            trackOffRoute(NEW_TRACKER, 'uncertain', here, later).offRoute,
        ).toBe(false);
    });
});

describe('pointAt', () => {
    it('출발점 이전이면 출발점이다', () => {
        expect(pointAt(ROUTE, -5)).toEqual(A);
        expect(pointAt(ROUTE, 0)).toEqual(A);
    });

    it('경로 끝을 넘으면 끝점이다', () => {
        expect(pointAt(ROUTE, 300)).toEqual(C);
        expect(pointAt(ROUTE, 999)).toEqual(C);
    });

    it('누적 거리로 구간 안을 보간한다', () => {
        expect(pointAt(ROUTE, 50)).toEqual([
            (A[0] + B[0]) / 2,
            (A[1] + B[1]) / 2,
        ]);
        expect(pointAt(ROUTE, 200)).toEqual([B[0], (B[1] + C[1]) / 2]);
    });
});
