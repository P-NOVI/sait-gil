import { describe, expect, it } from 'vitest';

import type { LngLat } from './geo';
import {
    ARRIVED_KEY,
    type GuidedRoute,
    guidanceStep,
    markAnnounced,
    NEW_GUIDANCE,
    REROUTE_KEY,
} from './guidance';
import { eventKey, type RouteEvent } from './routeEvents';

// 북쪽으로 곧장 500m 가는 경로. 200m 에서 오른쪽, 300m 부터 붐빔
const START: LngLat = [127, 37.5];
const north = (meters: number): LngLat => [127, 37.5 + meters / 111_195];
const TURN: RouteEvent = {
    kind: 'turn',
    distance_m: 200,
    position: north(200),
    direction: 'right',
};
const CROWD: RouteEvent = {
    kind: 'crowd',
    distance_m: 300,
    position: north(300),
    direction: null,
};
const ROUTE: GuidedRoute = {
    coordinates: [START, north(500)],
    distances_m: [0, 500],
    events: [TURN, CROWD],
};
const east = ([lng, lat]: LngLat, meters: number): LngLat => [
    lng + meters / 88_200,
    lat,
];

describe('guidanceStep', () => {
    it('알림 거리 안의 이벤트를 단계와 함께 낸다', () => {
        const step = guidanceStep(ROUTE, NEW_GUIDANCE, north(185), 5, 0);

        expect(step.judgement).toBe('on_route');
        expect(step.alerts).toEqual([
            {
                key: eventKey(TURN),
                level: 'route',
                text: '20미터 앞에서 오른쪽입니다.',
            },
            {
                key: eventKey(CROWD),
                level: 'crowd',
                text: '120미터 앞부터 붐비는 구간입니다.',
            },
        ]);
    });

    it('읽은 이벤트는 다시 내지 않는다', () => {
        const first = guidanceStep(ROUTE, NEW_GUIDANCE, north(185), 5, 0);
        const state = markAnnounced(first.state, first.alerts[0]);

        const next = guidanceStep(ROUTE, state, north(190), 5, 1_000);

        expect(next.alerts.map((alert) => alert.key)).toEqual([
            eventKey(CROWD),
        ]);
    });

    it('연달아 벗어나면 다시 찾고, 이벤트는 내지 않는다', () => {
        const away = east(north(185), 60);
        const first = guidanceStep(ROUTE, NEW_GUIDANCE, away, 5, 0);
        const second = guidanceStep(ROUTE, first.state, away, 5, 1_000);

        expect(first.reroute).toBe(false);
        expect(first.alerts).toEqual([]);
        expect(second.reroute).toBe(true);
        expect(second.alerts.map((alert) => alert.key)).toEqual([REROUTE_KEY]);
        expect(markAnnounced(second.state, second.alerts[0])).toBe(
            second.state,
        );
    });

    it('도착은 한 번만 알린다', () => {
        const first = guidanceStep(ROUTE, NEW_GUIDANCE, north(495), 5, 0);
        const state = markAnnounced(first.state, first.alerts[0]);

        expect(first.alerts.map((alert) => alert.key)).toEqual([ARRIVED_KEY]);
        expect(first.alerts[0].text).toBe(
            '목적지에 도착했습니다. 안내를 종료합니다.',
        );
        expect(guidanceStep(ROUTE, state, north(498), 5, 1_000).alerts).toEqual(
            [],
        );
    });

    it('도착하기 전 목적지 알림 거리에서는 목적지를 먼저 알린다', () => {
        const destination: RouteEvent = {
            kind: 'destination',
            distance_m: 500,
            position: north(500),
            direction: null,
        };
        const route: GuidedRoute = { ...ROUTE, events: [destination] };

        const near = guidanceStep(route, NEW_GUIDANCE, north(481), 5, 0);
        const arrived = guidanceStep(route, near.state, north(493), 5, 10_000);

        expect(near.judgement).toBe('on_route');
        expect(near.alerts.map((alert) => alert.key)).toEqual([
            eventKey(destination),
        ]);
        expect(near.alerts[0].text).toContain('목적지');
        expect(arrived.judgement).toBe('arrived');
    });

    it('위치 오차가 크면 아무것도 알리지 않는다', () => {
        const step = guidanceStep(ROUTE, NEW_GUIDANCE, north(185), 80, 0);

        expect(step.judgement).toBe('uncertain');
        expect(step.alerts).toEqual([]);
    });

    it('경로를 다시 찾으면 새 경로 전체에서 찾는다', () => {
        const first = guidanceStep(ROUTE, NEW_GUIDANCE, north(185), 5, 0);
        const rerouted: GuidedRoute = { ...ROUTE };

        const same = guidanceStep(ROUTE, first.state, north(400), 5, 1_000);
        const fresh = guidanceStep(rerouted, first.state, north(400), 5, 1_000);

        expect(same.progress.travelledM).toBeCloseTo(193, 1);
        expect(fresh.progress.travelledM).toBeCloseTo(400, 1);
    });
});

describe('guidanceStep 나란한 구간', () => {
    // 북쪽으로 100m 가서 횡단보도로 동쪽 15m 를 건넌 뒤, 건너편 인도로 100m 되돌아오는 경로
    const CROSS_START = north(100);
    const CROSSWALK: RouteEvent = {
        kind: 'crosswalk',
        distance_m: 100,
        position: CROSS_START,
        direction: null,
    };
    const U_ROUTE: GuidedRoute = {
        coordinates: [
            START,
            CROSS_START,
            east(CROSS_START, 15),
            east(START, 15),
        ],
        distances_m: [0, 100, 115, 215],
        events: [CROSSWALK],
    };
    // 횡단보도 2m 앞에서 동쪽으로 7m 튄 위치. 횡단보도 선이 지금 인도보다 가깝다.
    const JUMPED = east(north(98), 7);

    it('길 건너는 구간이 더 가까워도 걸어온 구간에서 진행 위치를 찾는다', () => {
        const first = guidanceStep(U_ROUTE, NEW_GUIDANCE, north(70), 5, 0);

        const step = guidanceStep(U_ROUTE, first.state, JUMPED, 5, 1_000);

        // 처음 받은 위치였다면 횡단보도를 건너는 중으로 봤을 자리다.
        expect(
            guidanceStep(U_ROUTE, NEW_GUIDANCE, JUMPED, 5, 0).progress
                .travelledM,
        ).toBeGreaterThan(100);
        expect(step.progress.travelledM).toBeCloseTo(78, 1);
        expect(step.judgement).toBe('on_route');
    });

    it('횡단보도 앞에서 튀어도 횡단보도 알림을 놓치지 않는다', () => {
        const first = guidanceStep(U_ROUTE, NEW_GUIDANCE, north(75), 5, 0);

        const step = guidanceStep(U_ROUTE, first.state, JUMPED, 5, 1_000);

        expect(first.alerts).toEqual([]);
        expect(step.alerts.map((alert) => alert.key)).toEqual([
            eventKey(CROSSWALK),
        ]);
    });
});
