import { describe, expect, it } from 'vitest';

import type { PlannedRoute, RouteKind } from './routeApi';
import { placeAnswer, routeAnswer } from './voiceCommand';

function route(...kinds: RouteKind[]): PlannedRoute {
    return {
        kinds,
        coordinates: [],
        distances_m: [],
        distance_m: 500,
        time_s: 400,
        congestion_score: 0,
        slope: { moderate_m: 0, hard_m: 0, score: 0 },
        events: [],
    };
}

const ROUTES = [route('recommended'), route('less_crowded'), route('gentle')];

describe('placeAnswer', () => {
    it.each([
        '여기로 갈게',
        '여기로 갈게요.',
        '응',
        '네',
        '네네',
        '네 맞아요',
        '그래',
        '거기로 가자',
        '안내해 줘',
    ])('"%s" 는 승낙', (heard) => {
        expect(placeAnswer(heard)).toBe('yes');
    });

    it.each(['다음', '아니', '아니요', '다른 데', '여기 말고', '안 가요'])(
        '"%s" 는 다음 결과',
        (heard) => {
            expect(placeAnswer(heard)).toBe('next');
        },
    );

    it('목록을 말하면 목록으로 돌아간다', () => {
        expect(placeAnswer('목록 보여 줘')).toBe('list');
    });

    it.each(['어디야', '서울역', ''])('"%s" 는 알아듣지 못한다', (heard) => {
        expect(placeAnswer(heard)).toBeNull();
    });
});

describe('routeAnswer', () => {
    it.each(['이 경로로 안내', '안내 시작', '출발', '응', '이 길로 갈게'])(
        '"%s" 는 지금 고른 경로로 시작',
        (heard) => {
            expect(routeAnswer(heard, ROUTES)).toEqual({
                action: 'start',
                index: null,
            });
        },
    );

    it.each([
        ['2번', 1],
        ['3번 경로로 안내해 줘', 2],
        ['첫 번째', 0],
        ['두 번째 경로', 1],
        ['셋째', 2],
        ['덜 붐비는 길로 가자', 1],
        ['완만한 길', 2],
        ['추천 경로로 안내', 0],
    ])('"%s" 는 %i 번째 경로로 시작', (heard, index) => {
        expect(routeAnswer(heard, ROUTES)).toEqual({ action: 'start', index });
    });

    it('여러 기준에 뽑힌 경로도 이름으로 고른다', () => {
        const merged = [route('recommended', 'gentle'), route('less_crowded')];

        expect(routeAnswer('완만한 길', merged)).toEqual({
            action: 'start',
            index: 0,
        });
    });

    it('없는 번호나 없는 경로 이름은 시작하지 않는다', () => {
        expect(routeAnswer('5번으로 안내', ROUTES)).toBeNull();
        expect(
            routeAnswer('완만한 길로 안내', [route('recommended')]),
        ).toBeNull();
    });

    it('거절하면 시작하지 않는다', () => {
        expect(routeAnswer('안 가요', ROUTES)).toBeNull();
        expect(routeAnswer('아니', ROUTES)).toBeNull();
    });

    it('다시 말해 달라고 하면 경로를 다시 읽는다', () => {
        expect(routeAnswer('다시 말해 줘', ROUTES)).toEqual({
            action: 'repeat',
        });
    });

    it('알아듣지 못한 말은 null', () => {
        expect(routeAnswer('배고파', ROUTES)).toBeNull();
    });
});
