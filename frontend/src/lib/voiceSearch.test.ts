import { describe, expect, it } from 'vitest';

import type { Place } from './placeApi';
import { cleanSpokenQuery, placeQuestion } from './voiceSearch';

const station: Place = {
    name: '서울역',
    address: '서울 용산구 한강대로 405',
    position: [126.97, 37.55],
    distance_m: 320,
};

describe('cleanSpokenQuery', () => {
    it.each([
        ['서울역으로 가 줘', '서울역'],
        ['코엑스로 가줘.', '코엑스'],
        ['명동역까지 안내해 줘', '명동역'],
        ['시청 가고 싶어요', '시청'],
        ['광화문 길 찾아 줘', '광화문'],
        ['남산타워 어디야?', '남산타워'],
        ['을지로4가 가줘', '을지로4가'],
    ])('"%s"는 "%s"로 검색한다', (heard, query) => {
        expect(cleanSpokenQuery(heard)).toBe(query);
    });

    it('장소 이름만 말하면 그대로 둔다', () => {
        expect(cleanSpokenQuery(' 강남역 ')).toBe('강남역');
        expect(cleanSpokenQuery('을지로4가')).toBe('을지로4가');
    });

    it('말끝을 지우면 남는 게 없을 때는 원래 말을 쓴다', () => {
        expect(cleanSpokenQuery('찾아 줘')).toBe('찾아 줘');
    });
});

describe('placeQuestion', () => {
    it('결과가 여럿이면 몇 번째인지와 거리, 주소를 읽고 묻는다', () => {
        expect(placeQuestion(station, 0, 3)).toBe(
            '검색 결과 3개 중 1번째. 서울역, 320미터 거리. 서울 용산구 한강대로 405. 이곳으로 갈까요?',
        );
    });

    it('결과가 하나이고 거리를 모르면 이름과 주소만 읽는다', () => {
        expect(placeQuestion({ ...station, distance_m: null }, 0, 1)).toBe(
            '서울역. 서울 용산구 한강대로 405. 이곳으로 갈까요?',
        );
    });

    it('이름의 대괄호는 빼고 읽는다', () => {
        const ktx = { ...station, name: '서울역[KTX정차역]', distance_m: null };
        expect(placeQuestion(ktx, 0, 1)).toBe(
            '서울역 KTX정차역. 서울 용산구 한강대로 405. 이곳으로 갈까요?',
        );
    });
});
