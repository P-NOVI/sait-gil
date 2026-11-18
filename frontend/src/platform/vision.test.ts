import { beforeEach, describe, expect, it, vi } from 'vitest';

const native = vi.hoisted(() => ({ value: false }));
const plugin = vi.hoisted(() => ({
    start: vi.fn(),
    stop: vi.fn(),
    addListener: vi.fn(),
}));

vi.mock('@capacitor/core', () => ({
    Capacitor: { isNativePlatform: () => native.value },
    registerPlugin: () => plugin,
}));

import {
    startVision,
    VISION_NOT_READY,
    type VisionFrame,
    visionAvailable,
} from './vision';

const remove = vi.fn();
let emit: (state: unknown) => void = () => undefined;

beforeEach(() => {
    native.value = false;
    vi.clearAllMocks();
    plugin.start.mockResolvedValue(undefined);
    plugin.stop.mockResolvedValue(undefined);
    remove.mockResolvedValue(undefined);
    plugin.addListener.mockImplementation(
        async (_event: string, listener: (state: unknown) => void) => {
            emit = listener;
            return { remove };
        },
    );
});

describe('visionAvailable', () => {
    it('앱에서만 쓸 수 있다', () => {
        expect(visionAvailable()).toBe(false);

        native.value = true;
        expect(visionAvailable()).toBe(true);
    });
});

describe('startVision', () => {
    it('웹에서는 플러그인을 부르지 않고 준비 중으로 실패한다', async () => {
        await expect(startVision(vi.fn())).rejects.toThrow(VISION_NOT_READY);

        expect(plugin.addListener).not.toHaveBeenCalled();
        expect(plugin.start).not.toHaveBeenCalled();
    });

    it('앱에서는 crowdState 를 구독한 뒤 시작한다', async () => {
        native.value = true;

        await startVision(vi.fn());

        expect(plugin.addListener).toHaveBeenCalledWith(
            'crowdState',
            expect.any(Function),
        );
        expect(plugin.start).toHaveBeenCalledTimes(1);
        expect(plugin.addListener.mock.invocationCallOrder[0]).toBeLessThan(
            plugin.start.mock.invocationCallOrder[0],
        );
    });

    it('플러그인이 보낸 crowdState 를 VisionFrame 으로 넘긴다', async () => {
        native.value = true;
        const frames: VisionFrame[] = [];
        await startVision((frame) => frames.push(frame));

        emit({ level: 'crowded', nearestPersonM: 2.1, freeDirections: [11] });

        expect(frames).toEqual([
            { level: 'crowded', nearestPersonM: 2.1, freeDirections: [11] },
        ]);
    });

    it('거리가 null 이고 판단 불가인 값도 받는다', async () => {
        native.value = true;
        const frames: VisionFrame[] = [];
        await startVision((frame) => frames.push(frame));

        emit({ level: 'unknown', nearestPersonM: null, freeDirections: [] });

        expect(frames).toEqual([
            { level: 'unknown', nearestPersonM: null, freeDirections: [] },
        ]);
    });

    it('모르는 단계는 판단 불가로, 잘못된 거리와 방향은 버린다', async () => {
        native.value = true;
        const frames: VisionFrame[] = [];
        await startVision((frame) => frames.push(frame));

        emit({
            level: 'panic',
            nearestPersonM: 'near',
            freeDirections: [3, 12],
        });
        emit('이상한 값');

        expect(frames).toEqual([
            { level: 'unknown', nearestPersonM: null, freeDirections: [12] },
            { level: 'unknown', nearestPersonM: null, freeDirections: [] },
        ]);
    });

    it('돌려준 함수를 부르면 멈추고 구독을 끊는다. 두 번 불러도 한 번만 한다', async () => {
        native.value = true;
        const stop = await startVision(vi.fn());

        stop();
        stop();

        expect(plugin.stop).toHaveBeenCalledTimes(1);
        expect(remove).toHaveBeenCalledTimes(1);
    });

    it('시작에 실패하면 구독을 끊고 오류를 그대로 던진다', async () => {
        native.value = true;
        plugin.start.mockRejectedValue(new Error('시작 실패'));

        await expect(startVision(vi.fn())).rejects.toThrow('시작 실패');

        expect(remove).toHaveBeenCalledTimes(1);
    });
});
