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
/** 경로를 읽은 뒤 묻는 말. "1번", "2번 경로로 가 줘", "완만한 길" 처럼 대답한다. */
export const ROUTE_QUESTION = '원하시는 경로를 말씀하세요.';
export const ROUTE_ANSWER_HINT =
    '경로 번호를 말하거나, 안내 시작이라고 말하세요.';
/**
 * 경로가 하나일 때 묻는 말. 고를 것이 없으므로 시작하는 말만 알려 준다.
 * "안내를 시작할까요?" 처럼 물으면 "아니요"도 받아야 해서 시작하는 방법만 말한다.
 */
export const START_HINT = '안내를 시작하려면 안내 시작이라고 말하세요.';

/** 경로를 읽은 뒤 묻는 말 */
export function routeQuestion(count: number): string {
    return count === 1 ? START_HINT : ROUTE_QUESTION;
}

/** 대답을 못 알아들었을 때 한 번 더 묻는 말 */
export function routeAnswerHint(count: number): string {
    return count === 1 ? START_HINT : ROUTE_ANSWER_HINT;
}

/** 한 번 더 물어도 대답을 못 알아들었을 때 */
export const NOT_HEARD_TEXT =
    '대답을 알아듣지 못했습니다. 화면의 버튼을 눌러 고르세요.';

/** 안내를 시작할 때 카메라 인식을 켤지 묻는 말 */
export const VISION_QUESTION = '카메라를 켤까요?';
/** 대답이 없거나 못 알아들었을 때. 안전을 위해 켜고 끄는 방법을 알려 준다. */
export const VISION_DEFAULT_ON_TEXT =
    '카메라를 켭니다. 끄려면 두 번 누르고 카메라 꺼라고 하세요.';
/** 안내 중 말하기 버튼을 누르거나 화면을 두 번 눌렀을 때 묻는 말 */
export const SPEAK_PROMPT = '말씀하세요.';
/** 안내 중 명령을 못 알아들었을 때 */
export const NAVIGATION_COMMAND_HINT = '카메라 꺼, 또는 카메라 켜라고 하세요.';

/** 위치 권한이 꺼져 있을 때 켤지 묻는 말 */
export const LOCATION_PERMISSION_QUESTION =
    '위치 권한이 꺼져 있어 내 위치를 찾을 수 없습니다. 위치 권한을 켤까요? 켜 줘, 또는 응이라고 말하세요.';
/** 위치 권한을 켜지 않았을 때. 나중에 켜는 방법을 알려 준다. */
export const LOCATION_PERMISSION_LATER_TEXT =
    '위치 권한을 켜지 않았습니다. 켜려면 화면 오른쪽 위의 내 위치 찾기 버튼을 누르세요.';
/** Android 가 권한을 더 묻지 않아 설정 화면을 열기 전에 읽는 말 */
export const OPEN_SETTINGS_TEXT =
    '설정 화면을 엽니다. 권한에서 위치를 허용으로 바꾼 뒤 뒤로 가기로 돌아오세요.';
/** 권한을 켜고 위치를 찾았을 때 */
export const LOCATION_FOUND_TEXT = '내 위치를 찾았습니다.';

/** 카메라 인식을 켤지에 대한 대답. on: 켬, off: 끔 */
export type CameraAnswer = 'on' | 'off';

/** 안내 중 말하기 버튼으로 받은 명령 */
export type NavigationCommand = { action: 'camera'; answer: CameraAnswer };

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
// 카메라를 끄라는 말. "켜지 마", "안 켜" 처럼 켜는 말이 섞여 있어도 먼저 본다.
const CAMERA_OFF_WORDS = /꺼|끄|끌|끈|그만|지마|안켜|안킬|필요없/;
const CAMERA_ON_WORDS = /켜|켤|킬|키자|틀어/;
const CAMERA_WORDS = /카메라|인식/;
const ALLOW_WORDS = /허용/;
const DONT_ALLOW_WORDS = /안해|안할|안함|허용안/;
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

/** "카메라 인식을 켤까요?"에 대한 대답. "네", "켜 줘" 는 켬, "아니요", "꺼 줘" 는 끔 */
export function cameraAnswer(heard: string): CameraAnswer | null {
    const said = compact(heard);
    if (REFUSE_WORDS.test(said) || CAMERA_OFF_WORDS.test(said)) {
        return 'off';
    }
    if (SHORT_YES.test(said) || CAMERA_ON_WORDS.test(said)) {
        return 'on';
    }
    return null;
}

/**
 * "위치 권한을 켤까요?"에 대한 대답. 카메라와 같은 말("응", "켜 줘", "아니")에 "허용"을 더 받는다.
 * "허용 안 해" 처럼 허용하지 않는 말을 먼저 본다.
 */
export function permissionAnswer(heard: string): CameraAnswer | null {
    const said = compact(heard);
    if (DONT_ALLOW_WORDS.test(said)) {
        return 'off';
    }
    return cameraAnswer(heard) ?? (ALLOW_WORDS.test(said) ? 'on' : null);
}

/**
 * 안내 중 말하기 버튼으로 들은 명령. 다른 명령과 헷갈리지 않게 "카메라"나 "인식"이 있어야 한다.
 * "네" 같은 짧은 대답은 명령이 아니므로 받지 않는다.
 */
export function navigationCommand(heard: string): NavigationCommand | null {
    const said = compact(heard);
    if (!CAMERA_WORDS.test(said)) {
        return null;
    }
    if (CAMERA_OFF_WORDS.test(said)) {
        return { action: 'camera', answer: 'off' };
    }
    if (CAMERA_ON_WORDS.test(said)) {
        return { action: 'camera', answer: 'on' };
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
