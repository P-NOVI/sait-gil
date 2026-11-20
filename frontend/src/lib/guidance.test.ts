import { describe, expect, it } from 'vitest';

import type { LocationFix } from '../platform';
import { NAVIGATION } from '../settings';
import { distanceM, type LngLat } from './geo';
import {
    ARRIVED_KEY,
    type GuidedRoute,
    guidanceStep,
    markAnnounced,
    NEW_GUIDANCE,
    REROUTE_KEY,
    shownFix,
} from './guidance';
import { dueBlockAlert, eventKey, type RouteEvent } from './routeEvents';

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
        const step = guidanceStep(ROUTE, NEW_GUIDANCE, north(192), 5, 0);

        expect(step.judgement).toBe('on_route');
        expect(step.alerts).toEqual([
            {
                key: eventKey(TURN),
                level: 'route',
                text: '곧 오른쪽입니다.',
            },
            {
                key: eventKey(CROWD),
                level: 'crowd',
                text: '110미터 앞부터 붐비는 구간입니다.',
            },
        ]);
    });

    it('읽은 이벤트는 다시 내지 않는다', () => {
        const first = guidanceStep(ROUTE, NEW_GUIDANCE, north(192), 5, 0);
        const state = markAnnounced(first.state, first.alerts[0]);

        const next = guidanceStep(ROUTE, state, north(195), 5, 1_000);

        expect(next.alerts.map((alert) => alert.key)).toEqual([
            eventKey(CROWD),
        ]);
    });

    it('벗어난 채로 정한 시간이 지나면 다시 찾고, 이벤트는 내지 않는다', () => {
        const away = east(north(185), 60);
        const first = guidanceStep(ROUTE, NEW_GUIDANCE, away, 5, 0);
        const soon = guidanceStep(ROUTE, first.state, away, 5, 1_000);
        const second = guidanceStep(
            ROUTE,
            soon.state,
            away,
            5,
            NAVIGATION.offRouteMs,
        );

        expect(first.reroute).toBe(false);
        expect(first.offRoute).toBe(false);
        expect(first.alerts).toEqual([]);
        expect(soon.reroute).toBe(false);
        expect(soon.offRoute).toBe(false);
        expect(second.reroute).toBe(true);
        expect(second.offRoute).toBe(true);
        expect(second.alerts.map((alert) => alert.key)).toEqual([REROUTE_KEY]);
        expect(markAnnounced(second.state, second.alerts[0])).toBe(
            second.state,
        );
    });

    it('다시 찾은 곳 근처라 또 찾지 않아도 벗어난 채로 정한 시간이 지나면 이탈로 본다', () => {
        const away = east(north(185), 60);
        const state = {
            ...NEW_GUIDANCE,
            tracker: { ...NEW_GUIDANCE.tracker, reroutedAt: away },
        };
        const first = guidanceStep(ROUTE, state, away, 5, 0);
        const later = guidanceStep(
            ROUTE,
            first.state,
            away,
            5,
            NAVIGATION.offRouteMs,
        );

        expect(later.reroute).toBe(false);
        expect(later.offRoute).toBe(true);
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

describe('shownFix', () => {
    const fixAt = (position: LngLat): LocationFix => ({
        position,
        accuracy: 10,
    });

    it('이탈이 확정되기 전에는 옆으로 튄 위치를 경로 선 위에 붙인다', () => {
        const jumped = fixAt(east(north(185), 30));
        const step = guidanceStep(ROUTE, NEW_GUIDANCE, jumped.position, 10, 0);

        const shown = shownFix(jumped, step, false);

        expect(step.judgement).toBe('off_route');
        expect(step.offRoute).toBe(false);
        expect(distanceM(shown.position, north(185))).toBeLessThan(0.5);
        expect(shown.accuracy).toBe(jumped.accuracy);
    });

    it('이탈이 확정됐거나 경로를 다시 찾는 중이면 실제 위치를 쓴다', () => {
        const away = fixAt(east(north(185), 60));
        const first = guidanceStep(ROUTE, NEW_GUIDANCE, away.position, 10, 0);
        const confirmed = guidanceStep(
            ROUTE,
            first.state,
            away.position,
            10,
            NAVIGATION.offRouteMs,
        );

        expect(shownFix(away, confirmed, false)).toBe(away);
        expect(shownFix(away, first, true)).toBe(away);
        expect(shownFix(away, null, false)).toBe(away);
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
        const first = guidanceStep(U_ROUTE, NEW_GUIDANCE, north(88), 5, 0);

        const step = guidanceStep(U_ROUTE, first.state, JUMPED, 5, 1_000);

        expect(first.alerts).toEqual([]);
        expect(step.alerts.map((alert) => alert.key)).toEqual([
            eventKey(CROSSWALK),
        ]);
    });
});

describe('guidanceStep 블럭 안내', () => {
    // 출발 → 100m 오른쪽 → 300m 횡단보도 → 310m 왼쪽(짧은 블럭) → 500m 도착
    const turn = (distance_m: number, direction: 'left' | 'right') =>
        ({
            kind: 'turn',
            distance_m,
            position: north(distance_m),
            direction,
        }) satisfies RouteEvent;
    const FIRST = turn(100, 'right');
    const CROSS: RouteEvent = {
        kind: 'crosswalk',
        distance_m: 300,
        position: north(300),
        direction: null,
    };
    const SHORT = turn(310, 'left');
    const BLOCK_ROUTE: GuidedRoute = {
        ...ROUTE,
        events: [FIRST, CROSS, SHORT],
    };
    const texts = (step: ReturnType<typeof guidanceStep>) =>
        step.alerts.map((alert) => alert.text);

    it('출발하면 첫 블럭을 알리고, 한 번 읽은 뒤에는 다시 알리지 않는다', () => {
        const first = guidanceStep(BLOCK_ROUTE, NEW_GUIDANCE, north(5), 5, 0);
        const state = markAnnounced(first.state, first.alerts[0]);
        const next = guidanceStep(BLOCK_ROUTE, state, north(10), 5, 1_000);

        expect(texts(first)).toEqual(['이번 블럭에서 오른쪽입니다.']);
        expect(next.alerts).toEqual([]);
    });

    it('교차로가 알림 거리 안에 들어오면 곧 알린다', () => {
        const step = guidanceStep(BLOCK_ROUTE, NEW_GUIDANCE, north(95), 5, 0);

        expect(texts(step)).toEqual(['곧 오른쪽입니다.']);
    });

    it('블럭이 길면 먼저 미터로 알리고, 가까워지면 블럭으로 다시 알린다', () => {
        const far = guidanceStep(BLOCK_ROUTE, NEW_GUIDANCE, north(110), 5, 0);
        const state = markAnnounced(far.state, far.alerts[0]);
        const same = guidanceStep(BLOCK_ROUTE, state, north(120), 5, 1_000);
        // 시간이 충분히 지나 걸어서 닿을 수 있는 범위 안
        const near = guidanceStep(BLOCK_ROUTE, state, north(160), 5, 30_000);

        expect(texts(far)).toEqual(['190미터 앞에 횡단보도가 있습니다.']);
        expect(same.alerts).toEqual([]);
        expect(texts(near)).toEqual(['이번 블럭 끝에 횡단보도가 있습니다.']);
    });

    it('블럭 안내 후 곧 안내까지 걸을 거리가 짧으면 곧만 알린다', () => {
        const step = guidanceStep(BLOCK_ROUTE, NEW_GUIDANCE, north(295), 5, 0);

        expect(texts(step)).toEqual(['곧 횡단보도입니다.']);
        // 100m 회전 직후 25m 앞 횡단보도: 걸을 거리 15m 라 블럭 안내를 건너뛴다.
        const crosswalk = { ...CROSS, distance_m: 125, position: north(125) };
        expect(dueBlockAlert([FIRST, crosswalk], 101, new Set())).toBeNull();
    });

    it('이미 가까이 와서 시작한 블럭은 곧만 알린다', () => {
        const step = guidanceStep(BLOCK_ROUTE, NEW_GUIDANCE, north(90), 5, 0);

        expect(texts(step)).toEqual([]);
    });

    it('가까운 지점 알림을 블럭 안내보다 먼저 낸다', () => {
        const stairs: RouteEvent = {
            kind: 'stairs',
            distance_m: 115,
            position: north(115),
            direction: null,
        };
        const route: GuidedRoute = {
            ...ROUTE,
            events: [
                FIRST,
                { ...CROSS, distance_m: 230, position: north(230) },
                stairs,
            ],
        };

        const step = guidanceStep(route, NEW_GUIDANCE, north(101), 5, 0);

        expect(texts(step)).toEqual([
            '10미터 앞에 계단이 있습니다.',
            '이번 블럭 끝에 횡단보도가 있습니다.',
        ]);
    });
});
