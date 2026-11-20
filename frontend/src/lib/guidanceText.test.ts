import { describe, expect, it } from 'vitest';

import {
    blockText,
    eventText,
    spokenDistance,
    upcomingText,
} from './guidanceText';
import type { RouteEvent } from './routeEvents';

function event(
    kind: RouteEvent['kind'],
    direction: RouteEvent['direction'] = null,
): RouteEvent {
    return { kind, distance_m: 0, position: [127, 37.5], direction };
}

describe('spokenDistance', () => {
    it.each([
        [3, '10미터'],
        [24, '20미터'],
        [25, '30미터'],
        [1234, '1.2킬로미터'],
    ])('%d m → %s', (meters, expected) => {
        expect(spokenDistance(meters)).toBe(expected);
    });
});

describe('eventText', () => {
    it.each([
        [event('turn', 'right'), 20, '곧 오른쪽입니다.'],
        [event('turn', 'slight_left'), 20, '곧 10시 방향입니다.'],
        [event('turn', 'left'), 5, '곧 왼쪽입니다.'],
        [event('crosswalk'), 20, '곧 횡단보도입니다.'],
        [event('crosswalk', 'left'), 5, '곧 왼쪽 횡단보도입니다.'],
        [event('stairs'), 20, '20미터 앞에 계단이 있습니다.'],
        [event('crowd'), 300, '300미터 앞부터 붐비는 구간입니다.'],
        [event('crowd'), 0, '지금부터 붐비는 구간입니다.'],
        [event('destination'), 20, '20미터 앞에 목적지가 있습니다.'],
    ] as const)('%o, %d m', (given, remainingM, expected) => {
        expect(eventText(given, remainingM)).toBe(expected);
    });
});

describe('blockText', () => {
    it.each([
        [event('turn', 'right'), '이번 블럭에서 오른쪽입니다.'],
        [event('turn', 'slight_left'), '이번 블럭에서 10시 방향입니다.'],
        [event('crosswalk'), '이번 블럭 끝에 횡단보도가 있습니다.'],
    ] as const)('%o', (given, expected) => {
        expect(blockText(given)).toBe(expected);
    });
});

describe('upcomingText', () => {
    const events: RouteEvent[] = [
        { ...event('crosswalk'), distance_m: 120 },
        { ...event('turn', 'left'), distance_m: 50 },
        { ...event('stairs'), distance_m: 200 },
    ];

    it('지나지 않은 가장 가까운 교차로는 블럭 문장, 나머지는 남은 거리로 읽는다', () => {
        expect(upcomingText(events, 20)).toBe('이번 블럭에서 왼쪽입니다.');
        expect(upcomingText(events, 60)).toBe(
            '이번 블럭 끝에 횡단보도가 있습니다.',
        );
        expect(upcomingText(events, 130)).toBe('70미터 앞에 계단이 있습니다.');
    });

    it('남은 이벤트가 없으면 null', () => {
        expect(upcomingText(events, 210)).toBeNull();
    });
});
