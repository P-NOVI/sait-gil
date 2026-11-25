import { describe, expect, it } from 'vitest';

import type { PlannedRoute, RouteKind } from './routeApi';
import {
    cameraAnswer,
    hereOnlyAnswer,
    homeClearCommand,
    homeCommand,
    homeSetupCommand,
    navigationCommand,
    permissionAnswer,
    placeAnswer,
    ROUTE_ANSWER_HINT,
    ROUTE_QUESTION,
    routeAnswer,
    routeAnswerHint,
    routeQuestion,
    START_HINT,
} from './voiceCommand';

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
        ['1번', 0],
        ['2번', 1],
        ['2번 경로로 가줘', 1],
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

describe('routeQuestion', () => {
    it('경로가 하나면 고르라고 묻지 않고 시작하는 말만 알려 준다', () => {
        expect(routeQuestion(1)).toBe(START_HINT);
        expect(routeAnswerHint(1)).toBe(START_HINT);
        expect(routeAnswer('안내 시작', [route('recommended')])).toEqual({
            action: 'start',
            index: null,
        });
    });

    it('경로가 여럿이면 원하는 경로를 묻는다', () => {
        expect(routeQuestion(3)).toBe(ROUTE_QUESTION);
        expect(routeAnswerHint(3)).toBe(ROUTE_ANSWER_HINT);
    });
});

describe('cameraAnswer', () => {
    it.each(['네', '응', '켜 줘', '켜요', '카메라 켜', '킬게', '좋아요'])(
        '"%s" 는 켠다',
        (heard) => {
            expect(cameraAnswer(heard)).toBe('on');
        },
    );

    it.each(['아니요', '꺼 줘', '끄자', '켜지 마', '안 켜도 돼', '필요 없어'])(
        '"%s" 는 끈다',
        (heard) => {
            expect(cameraAnswer(heard)).toBe('off');
        },
    );

    it('상관없는 말은 알아듣지 못한 것으로 본다', () => {
        expect(cameraAnswer('오늘 날씨 어때')).toBeNull();
    });
});

describe('permissionAnswer', () => {
    it.each(['응', '네', '켜 줘', '켜요', '허용', '허용해 줘', '좋아'])(
        '"%s" 는 권한을 켠다',
        (heard) => {
            expect(permissionAnswer(heard)).toBe('on');
        },
    );

    it.each(['아니요', '싫어', '허용 안 해', '허용하지 마', '안 할래'])(
        '"%s" 는 켜지 않는다',
        (heard) => {
            expect(permissionAnswer(heard)).toBe('off');
        },
    );

    it('상관없는 말은 알아듣지 못한 것으로 본다', () => {
        expect(permissionAnswer('지금 몇 시야')).toBeNull();
    });
});

describe('navigationCommand', () => {
    it('카메라를 끄고 켜는 명령을 알아듣는다', () => {
        expect(navigationCommand('카메라 꺼 줘')).toEqual({
            action: 'camera',
            answer: 'off',
        });
        expect(navigationCommand('카메라 인식 켜')).toEqual({
            action: 'camera',
            answer: 'on',
        });
        expect(navigationCommand('인식 끄기')).toEqual({
            action: 'camera',
            answer: 'off',
        });
    });

    it('카메라를 말하지 않은 짧은 대답은 명령으로 보지 않는다', () => {
        expect(navigationCommand('네')).toBeNull();
        expect(navigationCommand('꺼')).toBeNull();
        expect(navigationCommand('카메라')).toBeNull();
    });
});

describe('placeAnswer 짧은 대답', () => {
    it('"으" 한 글자는 머뭇거리는 소리라 예로 받지 않는다', () => {
        expect(placeAnswer('으')).toBeNull();
    });

    it.each(['어', '엉', '으응', '어엉', '응', '네'])('"%s" 는 예', (heard) => {
        expect(placeAnswer(heard)).toBe('yes');
    });
});

describe('homeCommand', () => {
    it.each([
        '집으로 갈게',
        '집으로 갈게요.',
        '집으로가자',
        '우리집으로 갈래',
        '집까지 안내해 줘',
        '집에 가자',
        '집 갈게',
        '네 집으로 가자',
        '저장된 집으로 가자',
    ])('"%s" 는 집으로 가는 말', (heard) => {
        expect(homeCommand(heard)).toBe(true);
    });

    it.each([
        '집 앞 편의점',
        '집으로 안 갈게',
        '집으로 말고 회사로 갈게',
        '여기로 갈게',
        '',
    ])('"%s" 는 집으로 가는 말이 아님', (heard) => {
        expect(homeCommand(heard)).toBe(false);
    });
});

describe('hereOnlyAnswer', () => {
    it.each([
        '지금 위치',
        '현재 위치',
        '지금 위치요',
        '지금 있는 곳',
        '여기',
        '이곳',
        '내 위치',
        '지금 위치로',
    ])('"%s" 는 지금 있는 곳', (heard) => {
        expect(hereOnlyAnswer(heard)).toBe(true);
    });

    it.each(['서울역', '여기서 먼 곳', '지금 위치 말고', '집 등록할게', ''])(
        '"%s" 는 지금 있는 곳이 아님',
        (heard) => {
            expect(hereOnlyAnswer(heard)).toBe(false);
        },
    );
});

describe('homeClearCommand', () => {
    it.each([
        '집 지워 줘',
        '집 삭제해',
        '집 해제할게',
        '집을 지울래',
        '등록한 집 지워',
    ])('"%s" 는 집을 지우라는 말', (heard) => {
        expect(homeClearCommand(heard)).toBe(true);
    });

    it.each([
        '집 지우지 마',
        '집 지우는 거 취소',
        '집으로 갈게',
        '집 등록할게',
        '',
    ])('"%s" 는 집을 지우라는 말이 아님', (heard) => {
        expect(homeClearCommand(heard)).toBe(false);
    });
});

describe('homeSetupCommand', () => {
    it.each([
        '지금 위치를 집으로 설정할게',
        '현재 위치를 집으로 등록해 줘',
        '여기를 집으로 저장할게',
        '이곳을 집으로 설정',
        '지금 위치를 집으로 해줘',
        '지금 위치로 집 바꿔줘',
        '지금 위치를 집으로 해 줘',
        '여기를 집으로 할게',
    ])('"%s" 는 지금 위치를 집으로', (heard) => {
        expect(homeSetupCommand(heard)).toBe('here');
    });

    it.each([
        '집 등록할게',
        '집으로 설정할게요.',
        '집등록',
        '집으로 해줘',
        '집 바꿔줘',
        '집 변경할게',
        '집 다시 등록할게',
    ])('"%s" 는 집으로 등록할 곳을 찾기', (heard) => {
        expect(homeSetupCommand(heard)).toBe('register');
    });

    it.each([
        '집으로 갈게',
        '집 등록 안 할래',
        '집 등록 취소',
        '집 지워 줘',
        '집으로 안 해줘',
        '이 집 해물탕',
        '우리집 삼겹살',
        '저장된 집으로 가자',
        '집 갈게',
        '여기로 갈게',
        '',
    ])('"%s" 는 집 등록이 아님', (heard) => {
        expect(homeSetupCommand(heard)).toBeNull();
    });
});
