import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

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
vi.mock('../platform', async () => await import('./vision'));

import { connectVision } from '../hooks/useVision';

import {
    startVision,
    VISION_NOT_READY,
    type VisionFrame,
    visionAvailable,
} from './vision';

const remove = vi.fn();
let emit: (state: unknown) => void = () => undefined;
const flush = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

afterEach(flush);

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
        await flush();

        expect(plugin.stop).toHaveBeenCalledTimes(1);
        expect(remove).toHaveBeenCalledTimes(1);
    });

    it('빈 방향은 넓은 순서를 유지하며 잘못된 값만 뺀다', async () => {
        native.value = true;
        const frames: VisionFrame[] = [];
        const stop = await startVision((frame) => frames.push(frame));

        emit({
            level: 'crowded',
            nearestPersonM: -1,
            freeDirections: [2, 3, 12, '11', 10],
        });

        expect(frames[0]).toEqual({
            level: 'crowded',
            nearestPersonM: null,
            freeDirections: [2, 12, 10],
        });
        stop();
    });

    it('종료한 연결이 늦게 시작되어도 새 연결의 인식을 끄지 않는다', async () => {
        native.value = true;
        let running = false;
        plugin.start.mockImplementation(async () => {
            running = true;
        });
        plugin.stop.mockImplementation(async () => {
            running = false;
        });

        const disconnectFirst = connectVision(vi.fn());
        disconnectFirst();
        const disconnectSecond = connectVision(vi.fn());
        await flush();

        expect(plugin.start).toHaveBeenCalledTimes(2);
        expect(plugin.stop).not.toHaveBeenCalled();
        expect(running).toBe(true);

        disconnectSecond();
        await flush();
        expect(plugin.stop).toHaveBeenCalledTimes(1);
        expect(running).toBe(false);
    });

    it('이전 종료가 끝날 때까지 새 시작을 기다린다', async () => {
        native.value = true;
        let finishStop: () => void = () => undefined;
        plugin.stop.mockImplementationOnce(
            () =>
                new Promise<void>((resolve) => {
                    finishStop = resolve;
                }),
        );
        const stopFirst = await startVision(vi.fn());
        stopFirst();
        const second = startVision(vi.fn());
        await flush();

        expect(plugin.start).toHaveBeenCalledTimes(1);
        finishStop();
        const stopSecond = await second;
        expect(plugin.start).toHaveBeenCalledTimes(2);
        stopSecond();
    });

    it('종료에 실패해도 다음 연결을 시작할 수 있다', async () => {
        native.value = true;
        plugin.stop.mockRejectedValueOnce(new Error('종료 실패'));
        const stopFirst = await startVision(vi.fn());
        stopFirst();
        const stopSecond = await startVision(vi.fn());

        expect(plugin.start).toHaveBeenCalledTimes(2);
        stopSecond();
    });

    it('시작에 실패하면 구독을 끊고 오류를 그대로 던진다', async () => {
        native.value = true;
        plugin.start.mockRejectedValue(new Error('시작 실패'));

        await expect(startVision(vi.fn())).rejects.toThrow('시작 실패');

        expect(remove).toHaveBeenCalledTimes(1);
    });
});
