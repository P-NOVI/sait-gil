import { describe, expect, it, vi } from 'vitest';

import type { AppPermission } from '../platform';
import {
    type OnboardingLine,
    onboardingDoneText,
    PERMISSION_STEPS,
    runOnboarding,
    WELCOME_TEXT,
} from './onboarding';

describe('runOnboarding', () => {
    it('권한마다 차례와 이유를 읽은 뒤 묻고, 거절한 권한을 돌려준다', async () => {
        const log: string[] = [];
        const say = vi.fn(async ({ text, step }: OnboardingLine) => {
            log.push(`say:${step ?? '-'}:${text}`);
        });
        const request = vi.fn(async (kind: AppPermission) => {
            log.push(`ask:${kind}`);
            return kind !== 'camera';
        });

        const denied = await runOnboarding(say, request);

        expect(denied).toEqual(['camera']);
        expect(log).toEqual([
            `say:-:${WELCOME_TEXT}`,
            ...PERMISSION_STEPS.flatMap((step, index) => [
                `say:${index + 1}:${step.reason}`,
                `ask:${step.kind}`,
            ]),
            `say:-:${onboardingDoneText(['camera'])}`,
        ]);
    });

    it('위치를 가장 먼저 묻는다', () => {
        expect(PERMISSION_STEPS.map((step) => step.kind)).toEqual([
            'location',
            'microphone',
            'camera',
            'steps',
        ]);
    });
});

describe('onboardingDoneText', () => {
    it('모두 허용하면 준비가 끝났다고만 한다', () => {
        expect(onboardingDoneText([])).toBe('준비가 끝났습니다.');
    });

    it('꺼진 권한은 묻는 차례대로 이름을 읽는다', () => {
        expect(onboardingDoneText(['steps', 'location'])).toBe(
            '위치, 신체 활동 권한은 꺼져 있습니다. 필요하면 휴대폰 설정의 애플리케이션에서 켤 수 있습니다. 준비가 끝났습니다.',
        );
    });
});
