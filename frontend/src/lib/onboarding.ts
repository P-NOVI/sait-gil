// 앱을 처음 열 때 읽는 안내와 권한 묻기. 권한마다 왜 쓰는지 읽은 뒤 시스템 권한 창을 띄운다.

import type { AppPermission } from '../platform';

/** 첫 실행 안내를 마쳤는지 기기에 남기는 키 */
export const ONBOARDED_KEY = 'saitgil.onboarded';

export const WELCOME_TEXT =
    '사잇길입니다. 사람이 많은 길에서도 소리와 진동으로 길을 안내합니다. 안내에 필요한 권한 네 가지를 차례로 묻겠습니다. 창이 뜨면 허용을 눌러 주세요.';

/** 앱을 열고 준비가 끝나면 묻는 말. 대답은 목적지 검색으로 넘긴다. */
export const DESTINATION_PROMPT = '어디로 갈까요?';

type PermissionStep = {
    kind: AppPermission;
    /** 꺼진 권한을 알릴 때 쓰는 이름. Android 권한 창의 이름과 맞춘다. */
    name: string;
    /** 권한 창을 띄우기 전에 읽는 말 */
    reason: string;
};

/** 묻는 차례. 길안내에 꼭 필요한 위치를 먼저 묻는다. */
export const PERMISSION_STEPS: readonly PermissionStep[] = [
    {
        kind: 'location',
        name: '위치',
        reason: '첫째, 위치입니다. 내 위치에서 길을 찾고 안내하는 데 씁니다.',
    },
    {
        kind: 'microphone',
        name: '마이크',
        reason: '둘째, 마이크입니다. 목적지와 명령을 말로 하는 데 씁니다.',
    },
    {
        kind: 'camera',
        name: '카메라',
        reason: '셋째, 카메라입니다. 앞의 사람과 장애물, 신호등을 알려 드리는 데 씁니다. 영상은 휴대폰 밖으로 보내지 않습니다.',
    },
    {
        kind: 'steps',
        name: '신체 활동',
        reason: '넷째, 신체 활동입니다. 걸음 수로 튀는 위치를 바로잡는 데 씁니다.',
    },
];

/** 시작 안내 화면에 보이고 읽는 한 문장. step 은 묻는 권한의 차례(1부터), 권한을 묻지 않는 문장이면 null */
export type OnboardingLine = { text: string; step: number | null };

/** 권한을 다 물은 뒤 읽는 말. 꺼진 권한이 있으면 이름과 켜는 곳을 알려 준다. */
export function onboardingDoneText(denied: readonly AppPermission[]): string {
    const names = PERMISSION_STEPS.filter((step) =>
        denied.includes(step.kind),
    ).map((step) => step.name);
    if (names.length === 0) {
        return '준비가 끝났습니다.';
    }
    return `${names.join(', ')} 권한은 꺼져 있습니다. 필요하면 휴대폰 설정의 애플리케이션에서 켤 수 있습니다. 준비가 끝났습니다.`;
}

/**
 * 첫 실행 안내. say 는 화면에 보이고 읽기를 마칠 때까지 기다리고, request 는 권한 창의 결과를 돌려준다.
 * 거절하거나 쓸 수 없는 권한을 돌려준다.
 */
export async function runOnboarding(
    say: (line: OnboardingLine) => Promise<void>,
    request: (kind: AppPermission) => Promise<boolean>,
): Promise<AppPermission[]> {
    await say({ text: WELCOME_TEXT, step: null });
    const denied: AppPermission[] = [];
    for (const [index, step] of PERMISSION_STEPS.entries()) {
        await say({ text: step.reason, step: index + 1 });
        if (!(await request(step.kind))) {
            denied.push(step.kind);
        }
    }
    await say({ text: onboardingDoneText(denied), step: null });
    return denied;
}
