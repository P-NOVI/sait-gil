import { describe, expect, it } from 'vitest';

import { type Alert, pickAlert, shouldInterrupt } from './alertArbiter';

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

    it('읽을 것이 없으면 null', () => {
        expect(pickAlert([], new Map(), 0, COOLDOWN)).toBeNull();
    });
});

describe('shouldInterrupt', () => {
    it('더 높은 단계만 읽던 알림을 끊는다', () => {
        expect(shouldInterrupt(CROWD, DANGER)).toBe(true);
        expect(shouldInterrupt(TURN, DANGER)).toBe(true);
        expect(shouldInterrupt(TURN, CROSSWALK)).toBe(false);
        expect(shouldInterrupt(DANGER, TURN)).toBe(false);
        expect(shouldInterrupt(null, DANGER)).toBe(false);
    });
});
