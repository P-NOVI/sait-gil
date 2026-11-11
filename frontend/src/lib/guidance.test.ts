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
        const step = guidanceStep(ROUTE, NEW_GUIDANCE, north(185), 5);

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
        const first = guidanceStep(ROUTE, NEW_GUIDANCE, north(185), 5);
        const state = markAnnounced(first.state, first.alerts[0]);

        const next = guidanceStep(ROUTE, state, north(190), 5);

        expect(next.alerts.map((alert) => alert.key)).toEqual([
            eventKey(CROWD),
        ]);
    });

    it('연달아 벗어나면 다시 찾고, 이벤트는 내지 않는다', () => {
        const away = east(north(185), 60);
        const first = guidanceStep(ROUTE, NEW_GUIDANCE, away, 5);
        const second = guidanceStep(ROUTE, first.state, away, 5);

        expect(first.reroute).toBe(false);
        expect(first.alerts).toEqual([]);
        expect(second.reroute).toBe(true);
        expect(second.alerts.map((alert) => alert.key)).toEqual([REROUTE_KEY]);
        expect(markAnnounced(second.state, second.alerts[0])).toBe(
            second.state,
        );
    });

    it('도착은 한 번만 알린다', () => {
        const first = guidanceStep(ROUTE, NEW_GUIDANCE, north(495), 5);
        const state = markAnnounced(first.state, first.alerts[0]);

        expect(first.alerts.map((alert) => alert.key)).toEqual([ARRIVED_KEY]);
        expect(guidanceStep(ROUTE, state, north(498), 5).alerts).toEqual([]);
    });

    it('위치 오차가 크면 아무것도 알리지 않는다', () => {
        const step = guidanceStep(ROUTE, NEW_GUIDANCE, north(185), 80);

        expect(step.judgement).toBe('uncertain');
        expect(step.alerts).toEqual([]);
    });
});
