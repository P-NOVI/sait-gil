import { describe, expect, it } from 'vitest';

import { dueEvents, eventKey, type RouteEvent } from './routeEvents';

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
        expect(dueEvents(EVENTS, 95, new Set())).toEqual([TURN, CROSSWALK]);
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
