import { describe, expect, it } from 'vitest';

import { CROSSING_FACING } from '../settings';
import type { LngLat } from './geo';
import type { RouteLine } from './navigation';
import {
    crossingBearing,
    dueEvents,
    eventKey,
    facingCrossing,
    nearCrosswalk,
    nearestCrosswalk,
    type RouteEvent,
    upcomingEvents,
} from './routeEvents';

function event(
    kind: RouteEvent['kind'],
    distance_m: number,
    direction: RouteEvent['direction'] = null,
): RouteEvent {
    return {
        kind,
        distance_m,
        position: [127, 37.5 + distance_m / 111_195],
        direction,
    };
}

const TURN = event('turn', 100, 'right');
const CROSSWALK = event('crosswalk', 110);
const CROWD = event('crowd', 400);
const EVENTS = [CROWD, TURN, CROSSWALK];

describe('dueEvents', () => {
    it('알림 거리 안에 들어온 이벤트만 가까운 것부터', () => {
        expect(dueEvents(EVENTS, 100, new Set())).toEqual([
            TURN,
            CROSSWALK,
            CROWD,
        ]);
    });

    it('혼잡 구간은 더 멀리서 알린다', () => {
        expect(dueEvents(EVENTS, 150, new Set())).toEqual([CROWD]);
    });

    it('지나간 이벤트와 이미 알린 이벤트는 뺀다', () => {
        const announced = new Set([eventKey(CROSSWALK)]);

        expect(dueEvents(EVENTS, 101, announced)).toEqual([CROWD]);
    });

    it('설정한 알림 거리를 따른다', () => {
        const near = {
            turn: 5,
            crosswalk: 5,
            stairs: 5,
            ramp: 5,
            overpass: 5,
            underpass: 5,
            elevator: 5,
            crowd: 5,
            destination: 5,
        };

        expect(dueEvents(EVENTS, 90, new Set(), near)).toEqual([]);
        expect(dueEvents(EVENTS, 96, new Set(), near)).toEqual([TURN]);
    });
});

describe('eventKey', () => {
    it('경로를 다시 받아 거리가 바뀌어도 같은 지점이면 같다', () => {
        expect(eventKey({ ...TURN, distance_m: 30 })).toBe(eventKey(TURN));
        expect(eventKey({ ...TURN, direction: 'left' })).not.toBe(
            eventKey(TURN),
        );
    });
});

describe('nearCrosswalk', () => {
    it('횡단보도 앞 aheadM 안부터 지나고 pastM 까지 근처로 본다', () => {
        const settings = { aheadM: 30, pastM: 10 };

        expect(nearCrosswalk(EVENTS, 79, settings)).toBe(false);
        expect(nearCrosswalk(EVENTS, 80, settings)).toBe(true);
        expect(nearCrosswalk(EVENTS, 120, settings)).toBe(true);
        expect(nearCrosswalk(EVENTS, 121, settings)).toBe(false);
    });

    it('횡단보도가 아닌 이벤트는 보지 않는다', () => {
        expect(nearCrosswalk([TURN, CROWD], 100)).toBe(false);
    });
});

describe('nearestCrosswalk', () => {
    it('근처 횡단보도 중 지금 위치에서 가장 가까운 것', () => {
        const far = event('crosswalk', 130);

        expect(nearestCrosswalk([far, CROSSWALK], 105)).toBe(CROSSWALK);
        expect(nearestCrosswalk([far, CROSSWALK], 125)).toBe(far);
        expect(nearestCrosswalk([TURN, CROWD], 100)).toBeNull();
    });
});

// 북쪽으로 100m 걷다 횡단보도에서 동쪽으로 20m 건너는 경로
const METERS_PER_DEGREE = 111_195;
const CORNER: LngLat = [127, 37.5 + 100 / METERS_PER_DEGREE];
const EAST_END: LngLat = [
    127 + 20 / (METERS_PER_DEGREE * Math.cos((CORNER[1] * Math.PI) / 180)),
    CORNER[1],
];
const ROUTE: RouteLine = {
    coordinates: [[127, 37.5], CORNER, EAST_END],
    distances_m: [0, 100, 120],
};
const CORNER_CROSSWALK: RouteEvent = {
    kind: 'crosswalk',
    distance_m: 100,
    position: CORNER,
    direction: 'right',
};
const LNG_METERS = METERS_PER_DEGREE * Math.cos((CORNER[1] * Math.PI) / 180);
const moved = ([lng, lat]: LngLat, eastM: number, northM: number): LngLat => [
    lng + eastM / LNG_METERS,
    lat + northM / METERS_PER_DEGREE,
];

describe('crossingBearing', () => {
    it('횡단보도 지점에서 경로를 따라 간 방향이다', () => {
        expect(crossingBearing(ROUTE, [CORNER_CROSSWALK], 90)).toBeCloseTo(
            90,
            0,
        );
    });

    it('근처에 횡단보도가 없으면 모른다', () => {
        expect(crossingBearing(ROUTE, [CORNER_CROSSWALK], 10)).toBeNull();
    });

    it('짧은 횡단보도를 건너 바로 꺾어도 횡단보도 끝까지의 방향이다', () => {
        // 동쪽으로 6m 건넌 뒤 바로 북쪽으로 꺾는다. 10m 앞을 보면 꺾은 길이 섞여 약 56도가 된다.
        const crossed = moved(CORNER, 6, 0);
        const route: RouteLine = {
            coordinates: [[127, 37.5], CORNER, crossed, moved(crossed, 0, 20)],
            distances_m: [0, 100, 106, 126],
        };

        expect(crossingBearing(route, [CORNER_CROSSWALK], 90)).toBeCloseTo(
            90,
            0,
        );
    });

    it('다음 꼭짓점이 minSpanM 보다 가까우면 그다음 꼭짓점까지 본다', () => {
        // 횡단보도 들머리에서 북쪽으로 1m 꺾였다 동쪽으로 8m 건넌다.
        const jog = moved(CORNER, 0, 1);
        const route: RouteLine = {
            coordinates: [[127, 37.5], CORNER, jog, moved(jog, 8, 0)],
            distances_m: [0, 100, 101, 109],
        };
        const bearing = crossingBearing(route, [CORNER_CROSSWALK], 90);

        expect(Math.abs((bearing ?? 0) - 90)).toBeLessThan(10);
    });

    it('경로가 횡단보도에서 끝나면 모른다', () => {
        const ending: RouteLine = {
            coordinates: [[127, 37.5], CORNER],
            distances_m: [0, 100],
        };

        expect(crossingBearing(ending, [CORNER_CROSSWALK], 90)).toBeNull();
    });
});

describe('facingCrossing', () => {
    const settings = { ...CROSSING_FACING, maxDeg: 45 };

    it('카메라가 건너는 방향에서 maxDeg 안이면 본다', () => {
        expect(facingCrossing(120, 90, settings)).toBe(true);
        expect(facingCrossing(45, 90, settings)).toBe(true);
        expect(facingCrossing(350, 10, settings)).toBe(true);
    });

    it('옆 방향을 보면 보지 않는다', () => {
        expect(facingCrossing(0, 90, settings)).toBe(false);
        expect(facingCrossing(180, 90, settings)).toBe(false);
    });

    it('카메라 방향이나 건너는 방향을 모르면 막지 않는다', () => {
        expect(facingCrossing(null, 90, settings)).toBe(true);
        expect(facingCrossing(0, null, settings)).toBe(true);
    });
});

describe('upcomingEvents', () => {
    const events = [
        event('crosswalk', 110),
        event('turn', 100, 'right'),
        event('stairs', 300),
    ];

    it('지나지 않은 이벤트를 가까운 차례로 count 개까지', () => {
        expect(upcomingEvents(events, 0, 2)).toEqual([events[1], events[0]]);
    });

    it('이미 지난 이벤트는 뺀다', () => {
        expect(upcomingEvents(events, 105, 3)).toEqual([events[0], events[2]]);
    });
});
