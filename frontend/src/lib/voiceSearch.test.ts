import { describe, expect, it, vi } from 'vitest';

import type { Place } from './placeApi';
import {
    koreanNumber,
    placeQuestion,
    searchSpoken,
    spokenNumbers,
    spokenQueries,
} from './voiceSearch';

const station: Place = {
    name: '서울역',
    address: '서울 용산구 한강대로 405',
    position: [126.97, 37.55],
    distance_m: 320,
};

const named = (name: string): Place => ({ ...station, name });

describe('spokenQueries', () => {
    it.each([
        ['서울역으로 가 줘', ['서울역']],
        ['명동역까지 안내해 줘', ['명동역']],
        ['명동에 가고 싶어요', ['명동']],
        ['시청 가고 싶어요', ['시청']],
        ['광화문 길 찾아 줘', ['광화문']],
        ['남산타워 어디야?', ['남산타워']],
        ['을지로4가 가줘', ['을지로4가']],
    ])('"%s"는 %j로 검색한다', (heard, queries) => {
        expect(spokenQueries(heard)).toEqual(queries);
    });

    it.each([
        ['종로 가 줘', ['종로']],
        ['대학로 어디야', ['대학로']],
        ['종로로 가 줘', ['종로']],
    ])('받침 뒤의 "로"는 이름이라 남긴다: "%s"', (heard, queries) => {
        expect(spokenQueries(heard)).toEqual(queries);
    });

    it.each([
        ['을지로 가줘', ['을지로', '을지']],
        ['강남대로 안내해 줘', ['강남대로', '강남대']],
        ['코엑스로 가줘.', ['코엑스로', '코엑스']],
        ['서울로 가 줘', ['서울로', '서울']],
    ])(
        '"로"가 조사인지 이름인지 모르면 둘 다 후보로 둔다: "%s"',
        (heard, queries) => {
            expect(spokenQueries(heard)).toEqual(queries);
        },
    );

    it('부탁하는 말이 없으면 조사도 지우지 않는다', () => {
        expect(spokenQueries(' 강남역 ')).toEqual(['강남역']);
        expect(spokenQueries('을지로')).toEqual(['을지로']);
    });

    it('말끝을 지우면 남는 게 없을 때는 원래 말을 쓴다', () => {
        expect(spokenQueries('찾아 줘')).toEqual(['찾아 줘']);
    });
});

describe('koreanNumber', () => {
    it.each([
        ['칠', '7'],
        ['십', '10'],
        ['이십구', '29'],
        ['백십', '110'],
        ['삼백오', '305'],
        ['천이백', '1200'],
        ['만오천', '15000'],
        ['일이삼', '123'],
        ['공일', '01'],
    ])('"%s"는 %s', (word, number) => {
        expect(koreanNumber(word)).toBe(number);
    });

    it.each(['구로', '이마트', '7', '이삼십'])(
        '숫자가 아니면 null: "%s"',
        (word) => {
            expect(koreanNumber(word)).toBeNull();
        },
    );
});

describe('spokenNumbers', () => {
    it.each([
        ['양재대로 29번길 칠', '양재대로 29번길 7'],
        ['이십구번길 칠', '29번길 7'],
        ['세종대로 백십', '세종대로 110'],
        ['세종대로 백십 다시 삼', '세종대로 110-3'],
        ['세종대로 110 다시 3', '세종대로 110-3'],
        ['세종대로 110다시3', '세종대로 110-3'],
        ['강남역 오 번 출구', '강남역 5 번 출구'],
        ['신림동 산 백일', '신림동 산 101'],
    ])('"%s" → "%s"', (heard, text) => {
        expect(spokenNumbers(heard)).toBe(text);
    });

    it.each(['구로', '오목교역', '이마트 칠곡점', '다시 찾아 줘', '일산'])(
        '숫자 글자로 시작하는 이름은 그대로 둔다: "%s"',
        (heard) => {
            expect(spokenNumbers(heard)).toBe(heard);
        },
    );
});

describe('spokenQueries 주소', () => {
    it.each([
        ['양재대로 29번길 칠로 가 줘', ['양재대로 29번길 7']],
        ['양재대로 29번길 칠에 가 줘', ['양재대로 29번길 7']],
        ['세종대로 백십 다시 삼으로 안내해 줘', ['세종대로 110-3']],
        ['양재대로 29번길 칠', ['양재대로 29번길 7']],
    ])('"%s"는 %j로 검색한다', (heard, queries) => {
        expect(spokenQueries(heard)).toEqual(queries);
    });
});

describe('searchSpoken', () => {
    it('첫 결과 이름에 검색어가 들어 있는 후보를 고른다', async () => {
        const search = vi.fn(async (query: string) =>
            query === '을지로' ? [named('을지로입구역')] : [named('을지면')],
        );

        const found = await searchSpoken(['을지로', '을지'], search);

        expect(found).toEqual({
            query: '을지로',
            places: [named('을지로입구역')],
        });
        expect(search).toHaveBeenCalledTimes(1);
    });

    it('앞 후보가 맞지 않으면 다음 후보를 검색한다', async () => {
        const search = vi.fn(async (query: string) =>
            query === '코엑스로' ? [named('봉은사')] : [named('코엑스')],
        );

        const found = await searchSpoken(['코엑스로', '코엑스'], search);

        expect(found?.query).toBe('코엑스');
        expect(search).toHaveBeenCalledTimes(2);
    });

    it('맞는 후보가 없으면 결과가 있는 첫 후보를 고른다', async () => {
        const search = vi.fn(async (query: string) =>
            query === '가' ? [named('다')] : [],
        );

        expect((await searchSpoken(['가', '나'], search))?.query).toBe('가');
    });

    it('모두 비었으면 마지막 후보를 빈 결과로 돌려준다', async () => {
        const found = await searchSpoken(['가', '나'], async () => []);

        expect(found).toEqual({ query: '나', places: [] });
    });

    it('검색이 실패하면 null', async () => {
        expect(await searchSpoken(['가'], async () => null)).toBeNull();
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

    it('이름이 주소와 같으면 한 번만 읽는다', () => {
        const address = {
            ...station,
            name: '서울 중구 세종대로 110',
            address: '서울 중구 세종대로 110',
            distance_m: null,
        };
        expect(placeQuestion(address, 0, 1)).toBe(
            '서울 중구 세종대로 110. 이곳으로 갈까요?',
        );
    });

    it('이름의 대괄호는 빼고 읽는다', () => {
        const ktx = { ...station, name: '서울역[KTX정차역]', distance_m: null };
        expect(placeQuestion(ktx, 0, 1)).toBe(
            '서울역 KTX정차역. 서울 용산구 한강대로 405. 이곳으로 갈까요?',
        );
    });
});
