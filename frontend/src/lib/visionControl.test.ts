import { describe, expect, it } from 'vitest';

import {
    INITIAL_VISION_CONTROL,
    type VisionControl,
    visionControl,
} from './visionControl';

const failed: VisionControl = {
    enabled: true,
    failure: 'denied',
    attempt: 0,
};

describe('visionControl', () => {
    it('처음에는 켠 상태이고 실패가 없다', () => {
        expect(INITIAL_VISION_CONTROL).toEqual({
            enabled: true,
            failure: null,
            attempt: 0,
        });
    });

    it('켜지 못한 뒤 다시 켜면 카메라를 다시 켜 본다', () => {
        const next = visionControl(failed, { type: 'set', enabled: true });

        expect(next).toEqual({ enabled: true, failure: null, attempt: 1 });
    });

    it('끈 뒤 실패 없이 다시 켜면 다시 켜 보는 횟수를 늘리지 않는다', () => {
        const off = visionControl(INITIAL_VISION_CONTROL, {
            type: 'set',
            enabled: false,
        });
        const on = visionControl(off, { type: 'set', enabled: true });

        expect(off).toEqual({ enabled: false, failure: null, attempt: 0 });
        expect(on).toEqual({ enabled: true, failure: null, attempt: 0 });
    });

    it('이미 켜져 있고 실패가 없으면 그대로 둔다', () => {
        const next = visionControl(INITIAL_VISION_CONTROL, {
            type: 'set',
            enabled: true,
        });

        expect(next).toBe(INITIAL_VISION_CONTROL);
    });

    it('끄면 실패를 지운다', () => {
        const next = visionControl(failed, { type: 'set', enabled: false });

        expect(next).toEqual({ enabled: false, failure: null, attempt: 0 });
    });

    it('실패를 기억하고, 연결을 끊으면 지운다', () => {
        const withFailure = visionControl(INITIAL_VISION_CONTROL, {
            type: 'failed',
            failure: 'failed',
        });
        const stopped = visionControl(withFailure, { type: 'stopped' });

        expect(withFailure.failure).toBe('failed');
        expect(stopped.failure).toBeNull();
    });

    it('blocked 로 실패하고 다시 켜도 다음 blocked 가 새 실패로 바뀐다', () => {
        let state = INITIAL_VISION_CONTROL;
        const seen: (string | null)[] = [];
        for (let i = 0; i < 2; i += 1) {
            state = visionControl(state, {
                type: 'failed',
                failure: 'blocked',
            });
            seen.push(state.failure);
            state = visionControl(state, { type: 'set', enabled: true });
            seen.push(state.failure);
        }

        // 다시 켤 때마다 null 을 거쳐야 화면의 effect 가 다음 실패에서 다시 돈다.
        expect(seen).toEqual(['blocked', null, 'blocked', null]);
    });

    it('실패하고 다시 켤 때마다 횟수가 는다', () => {
        let state = INITIAL_VISION_CONTROL;
        for (let i = 0; i < 2; i += 1) {
            state = visionControl(state, { type: 'failed', failure: 'denied' });
            state = visionControl(state, { type: 'set', enabled: true });
        }

        expect(state.attempt).toBe(2);
    });
});
