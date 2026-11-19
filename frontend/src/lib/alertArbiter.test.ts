import { describe, expect, it } from 'vitest';

import {
    type Alert,
    pickAlert,
    shouldInterrupt,
    stillTimely,
} from './alertArbiter';

const DANGER: Alert = { key: 'person', level: 'danger', text: '앞에 사람' };
const TURN: Alert = { key: 'turn', level: 'route', text: '오른쪽' };
const CROSSWALK: Alert = { key: 'crosswalk', level: 'route', text: '횡단보도' };
const CROWD: Alert = { key: 'crowd', level: 'crowd', text: '붐빔' };
const COOLDOWN = { danger: 3_000, route: 10_000, crowd: 30_000 };

describe('pickAlert', () => {
    it('위험 > 경로 > 혼잡 순으로 고른다', () => {
        const none = new Map<string, number>();

        expect(pickAlert([CROWD, TURN, DANGER], none, 0, COOLDOWN)).toBe(
            DANGER,
        );
        expect(pickAlert([CROWD, TURN], none, 0, COOLDOWN)).toBe(TURN);
    });

    it('같은 단계면 먼저 들어온 것', () => {
        expect(pickAlert([TURN, CROSSWALK], new Map(), 0, COOLDOWN)).toBe(TURN);
    });

    it('같은 알림은 쿨다운이 지나야 다시 고른다', () => {
        const spokenAt = new Map([['person', 1_000]]);

        expect(pickAlert([DANGER, TURN], spokenAt, 2_000, COOLDOWN)).toBe(TURN);
        expect(pickAlert([DANGER, TURN], spokenAt, 4_000, COOLDOWN)).toBe(
            DANGER,
        );
    });

    it('알림에 쿨다운이 따로 있으면 그것을 쓴다', () => {
        const lost: Alert = { ...TURN, key: 'lost', cooldownMs: 30_000 };
        const spokenAt = new Map([['lost', 0]]);

        expect(pickAlert([lost], spokenAt, 20_000, COOLDOWN)).toBeNull();
        expect(pickAlert([lost], spokenAt, 30_000, COOLDOWN)).toBe(lost);
    });

    it('읽을 것이 없으면 null', () => {
        expect(pickAlert([], new Map(), 0, COOLDOWN)).toBeNull();
    });
});

describe('shouldInterrupt', () => {
    it('더 높은 단계만 읽던 알림을 끊는다', () => {
        expect(shouldInterrupt('crowd', 'danger')).toBe(true);
        expect(shouldInterrupt('crowd', 'route')).toBe(true);
        expect(shouldInterrupt('route', 'danger')).toBe(true);
        expect(shouldInterrupt('route', 'route')).toBe(false);
        expect(shouldInterrupt('danger', 'route')).toBe(false);
    });
});

describe('stillTimely', () => {
    it('기다림에 한도가 있으면 한도 안에서만 읽는다', () => {
        const brief = { maxWaitMs: 1_500 };

        expect(stillTimely(brief, 0)).toBe(true);
        expect(stillTimely(brief, 1_500)).toBe(true);
        expect(stillTimely(brief, 1_501)).toBe(false);
    });

    it('wait 와 drop 은 기다린 시간과 상관없이 읽는다', () => {
        expect(stillTimely('wait', 60_000)).toBe(true);
        expect(stillTimely('drop', 0)).toBe(true);
    });
});
