import { describe, expect, it } from 'vitest';

import { speakingTracker } from './speaking';

describe('speakingTracker', () => {
    it('읽는 말이 없으면 기다리지 않는다', async () => {
        const speaking = speakingTracker();

        expect(speaking.busyFor('crowd')).toBe(false);
        await expect(speaking.whenIdle()).resolves.toBeUndefined();
    });

    it('읽는 중에는 같거나 낮은 단계를 미루고 더 높은 단계만 끊게 한다', () => {
        const speaking = speakingTracker();
        speaking.start('route');

        expect(speaking.busyFor('crowd')).toBe(true);
        expect(speaking.busyFor('route')).toBe(true);
        expect(speaking.busyFor('danger')).toBe(false);
    });

    it('다 읽으면 기다리던 알림을 깨운다', async () => {
        const speaking = speakingTracker();
        const done = speaking.start('route');
        const woken: string[] = [];
        const waiting = speaking.whenIdle().then(() => woken.push('turn'));

        await Promise.resolve();
        expect(woken).toEqual([]);
        done();
        await waiting;

        expect(woken).toEqual(['turn']);
        expect(speaking.busyFor('route')).toBe(false);
    });

    it('말을 모두 멈추면 기다리던 알림은 깨우지 않는다', async () => {
        const speaking = speakingTracker();
        speaking.start('route');
        let woken = false;
        void speaking.whenIdle().then(() => {
            woken = true;
        });

        speaking.stop();
        speaking.clear();
        await new Promise((resolve) => setTimeout(resolve, 0));

        expect(woken).toBe(false);
        expect(speaking.busyFor('crowd')).toBe(false);
    });

    it('끊긴 말이 늦게 끝나도 새로 읽는 말은 계속 읽는 중이다', () => {
        const speaking = speakingTracker();
        const first = speaking.start('crowd');
        speaking.clear();
        speaking.start('route');

        first();

        expect(speaking.busyFor('route')).toBe(true);
    });
});
