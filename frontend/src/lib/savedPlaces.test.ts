import { describe, expect, it } from 'vitest';

import type { Place } from './placeApi';
import {
    samePlace,
    storedPlace,
    storedPlaces,
    withRecent,
} from './savedPlaces';

function place(
    name: string,
    lng = 127,
    distance_m: number | null = null,
): Place {
    return { name, address: `${name} 주소`, position: [lng, 37.5], distance_m };
}

describe('storedPlace', () => {
    it('장소 모양이면 거리를 빼고 돌려준다', () => {
        expect(storedPlace(place('서울역', 127, 320))).toEqual(place('서울역'));
    });

    it.each([
        null,
        'x',
        { name: '서울역', address: '주소' },
        { name: '서울역', address: '주소', position: [127] },
        { name: '서울역', address: '주소', position: [127, 'a'] },
        { name: 1, address: '주소', position: [127, 37.5] },
    ])('장소 모양이 아니면 null: %j', (value) => {
        expect(storedPlace(value)).toBeNull();
    });
});

describe('storedPlaces', () => {
    it('장소 모양이 아닌 것은 빼고 max 개까지', () => {
        const value = [place('가'), 'x', place('나'), place('다')];
        expect(storedPlaces(value, 2)).toEqual([place('가'), place('나')]);
    });

    it('배열이 아니면 빈 목록', () => {
        expect(storedPlaces(null)).toEqual([]);
    });
});

describe('withRecent', () => {
    it('방금 간 곳을 맨 앞에 두고 max 개까지 남긴다', () => {
        const list = [place('가'), place('나'), place('다')];
        expect(withRecent(list, place('라'), 3)).toEqual([
            place('라'),
            place('가'),
            place('나'),
        ]);
    });

    it('같은 곳은 한 번만 두고 앞으로 옮긴다', () => {
        const list = [place('가'), place('나')];
        expect(withRecent(list, place('나', 127, 50))).toEqual([
            place('나'),
            place('가'),
        ]);
    });

    it('이름이 같아도 위치가 다르면 다른 곳이다', () => {
        expect(samePlace(place('가', 127), place('가', 128))).toBe(false);
    });
});
