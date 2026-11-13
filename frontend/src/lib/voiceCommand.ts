// 물어본 뒤 사용자가 말로 한 대답을 명령으로 바꾼다.
// 말로 찾은 곳 확인("여기로 갈게", "다음", "목록")과 경로 고르기("2번", "이 경로로 안내")에 쓴다.

import type { PlannedRoute, RouteKind } from './routeApi';

/** 말로 찾은 곳을 확인할 때의 대답 */
export type PlaceAnswer = 'yes' | 'next' | 'list';

/** 경로를 고를 때의 대답. index 가 null 이면 지금 고른 경로로 안내한다. */
export type RouteAnswer =
    { action: 'start'; index: number | null } | { action: 'repeat' };

export const PLACE_ANSWER_HINT =
    '여기로 갈게, 다음, 목록 중에 하나를 말하세요.';
export const ROUTE_ANSWER_HINT =
    '경로 번호를 말하거나, 안내 시작이라고 말하세요.';

// "네", "응" 처럼 대답만 한 말. 다른 말 속의 "어", "네" 와 헷갈리지 않게 말 전체와 맞춘다.
const SHORT_YES = /^(?:네|예|응|어|웅|그래|좋아|맞아|오케이|확인)+요?$/;
// "말고", "안 가" 처럼 거절하는 말. 승낙하는 말("가요")이 섞여 있어도 먼저 본다.
const REFUSE_WORDS = /아니|아뇨|말고|안가|안좋|싫어/;
const NEXT_WORDS = /^노|다음|다른|딴/;
const LIST_WORDS = /목록|리스트/;
const YES_WORDS =
    /갈게|가자|갈래|가요|여기로|거기로|이곳으로|그곳으로|이리로|맞아|좋아|그래/;
const START_WORDS = /안내|시작|출발|이경로|그경로|이길|그길|갈게|가자|가요/;
const REPEAT_WORDS = /다시|한번더|뭐라고/;
// "2번", "두 번째", "둘째"
const NUMBERED = /(\d+)번/;
const ORDINAL = /(첫|두|둘|세|셋)(?:번)?째/;
const ORDINAL_NUMBERS: Readonly<Record<string, number>> = {
    첫: 1,
    두: 2,
    둘: 2,
    세: 3,
    셋: 3,
};
// 경로 이름으로 고르는 말
const KIND_WORDS: readonly [RouteKind, RegExp][] = [
    ['less_crowded', /덜붐비|안붐비|한산|사람이?적/],
    ['gentle', /완만|경사|평평/],
    ['recommended', /추천/],
];

/** 띄어쓰기·문장부호를 빼서 "여기로 갈게요." 와 "여기로갈게요" 를 같게 본다. */
function compact(heard: string): string {
    return heard.replace(/[\s.,!?~'"]/g, '');
}

export function placeAnswer(heard: string): PlaceAnswer | null {
    const said = compact(heard);
    if (LIST_WORDS.test(said)) {
        return 'list';
    }
    if (REFUSE_WORDS.test(said) || NEXT_WORDS.test(said)) {
        return 'next';
    }
    if (
        SHORT_YES.test(said) ||
        YES_WORDS.test(said) ||
        START_WORDS.test(said)
    ) {
        return 'yes';
    }
    return null;
}

/** 말한 경로 순서(1부터). 순서를 말하지 않았으면 null */
function spokenOrder(said: string): number | null {
    const number = NUMBERED.exec(said);
    if (number) {
        return Number(number[1]);
    }
    const ordinal = ORDINAL.exec(said);
    return ordinal ? ORDINAL_NUMBERS[ordinal[1]] : null;
}

/** 말한 경로 이름에 맞는 경로. 이름을 말하지 않았으면 null, 그런 경로가 없으면 -1 */
function spokenKind(
    said: string,
    routes: readonly PlannedRoute[],
): number | null {
    const kind = KIND_WORDS.find(([, words]) => words.test(said))?.[0];
    return kind
        ? routes.findIndex((route) => route.kinds.includes(kind))
        : null;
}

export function routeAnswer(
    heard: string,
    routes: readonly PlannedRoute[],
): RouteAnswer | null {
    const said = compact(heard);
    if (REFUSE_WORDS.test(said)) {
        return null;
    }
    const order = spokenOrder(said);
    if (order !== null) {
        // 없는 번호를 말하면 지금 경로로 시작하지 않고 다시 묻는다.
        return order >= 1 && order <= routes.length
            ? { action: 'start', index: order - 1 }
            : null;
    }
    const kind = spokenKind(said, routes);
    if (kind !== null) {
        return kind >= 0 ? { action: 'start', index: kind } : null;
    }
    if (REPEAT_WORDS.test(said)) {
        return { action: 'repeat' };
    }
    if (SHORT_YES.test(said) || START_WORDS.test(said)) {
        return { action: 'start', index: null };
    }
    return null;
}
