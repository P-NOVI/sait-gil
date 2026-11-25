import { describe, expect, it } from 'vitest';

import {
    blockText,
    eventLabel,
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
        { ...event('crosswalk'), distance_m: 520 },
        { ...event('turn', 'left'), distance_m: 300 },
        { ...event('stairs'), distance_m: 600 },
    ];

    it('교차로는 음성과 같게 멀면 직진, 가까우면 블럭, 곧이면 곧으로 읽는다', () => {
        expect(upcomingText(events, 20)).toBe('다음 안내까지 직진입니다.');
        expect(upcomingText(events, 200)).toBe('이번 블럭에서 왼쪽입니다.');
        expect(upcomingText(events, 295)).toBe('곧 왼쪽입니다.');
    });

    it('교차로가 아니면 남은 거리로 읽는다', () => {
        expect(upcomingText(events, 530)).toBe('70미터 앞에 계단이 있습니다.');
    });

    it('남은 이벤트가 없으면 null', () => {
        expect(upcomingText(events, 610)).toBeNull();
    });
});

describe('eventLabel', () => {
    it.each([
        [event('turn', 'right'), '오른쪽'],
        [event('turn'), '방향 전환'],
        [event('crosswalk', 'left'), '왼쪽 횡단보도'],
        [event('stairs'), '계단'],
        [event('crowd'), '붐비는 구간'],
        [event('destination'), '목적지'],
    ])('%j → %s', (routeEvent, expected) => {
        expect(eventLabel(routeEvent)).toBe(expected);
    });
});
