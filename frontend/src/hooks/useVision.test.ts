import { beforeEach, describe, expect, it, vi } from 'vitest';

const platform = vi.hoisted(() => ({
    startVision: vi.fn(),
    visionAvailable: vi.fn(),
    visionFailure: vi.fn(),
}));

vi.mock('../platform', () => platform);

import type { VisionApproach, VisionFrame, VisionObstacle } from '../platform';
import { connectVision } from './useVision';

const FRAME: VisionFrame = {
    level: 'crowded',
    nearestPersonM: 2.1,
    freeDirections: [11],
    signal: null,
    obstacles: [],
};

// then/catch 로 이어진 약속이 모두 끝나도록 기다린다.
const flush = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

/** 시작이 언제 끝날지 테스트가 정하는 startVision */
function pendingStart() {
    const stopVision = vi.fn();
    let finish: (stop: () => void) => void = () => undefined;
    let fail: (error: Error) => void = () => undefined;
    let onFrame: (frame: VisionFrame) => void = () => undefined;
    let onApproach: (approach: VisionApproach) => void = () => undefined;
    let onObstacle: (obstacle: VisionObstacle) => void = () => undefined;
    platform.startVision.mockImplementation(
        (
            listener: (frame: VisionFrame) => void,
            approachListener: (approach: VisionApproach) => void,
            obstacleListener: (obstacle: VisionObstacle) => void,
        ) => {
            onFrame = listener;
            onApproach = approachListener;
            onObstacle = obstacleListener;
            return new Promise<() => void>((resolve, reject) => {
                finish = resolve;
                fail = reject;
            });
        },
    );
    return {
        stopVision,
        finish: () => finish(stopVision),
        fail: (error: Error) => fail(error),
        /** 플러그인이 결과를 보낸 것처럼 onFrame 을 부른다. */
        emit: (frame: VisionFrame) => onFrame(frame),
        /** 플러그인이 정면 접근을 보낸 것처럼 onApproach 를 부른다. */
        approach: (approach: VisionApproach) => onApproach(approach),
        /** 플러그인이 장애물을 보낸 것처럼 onObstacle 을 부른다. */
        obstacle: (obstacle: VisionObstacle) => onObstacle(obstacle),
    };
}

const APPROACH: VisionApproach = { distanceM: 2.4, freeDirections: [1] };

beforeEach(() => {
    vi.clearAllMocks();
});

describe('connectVision', () => {
    it('인식 결과를 onFrame 으로 넘긴다', async () => {
        const start = pendingStart();
        const frames: VisionFrame[] = [];

        connectVision((frame) => frames.push(frame));
        start.finish();
        await flush();
        start.emit(FRAME);

        expect(frames).toEqual([FRAME]);
    });

    it('정면 접근을 onApproach 로 넘기고 멈춘 뒤에는 버린다', async () => {
        const start = pendingStart();
        const onApproach = vi.fn();

        const disconnect = connectVision(vi.fn(), onApproach);
        start.finish();
        await flush();
        start.approach(APPROACH);
        disconnect();
        start.approach(APPROACH);

        expect(onApproach).toHaveBeenCalledTimes(1);
        expect(onApproach).toHaveBeenCalledWith(APPROACH);
    });

    it('장애물을 onObstacle 로 넘기고 멈춘 뒤에는 버린다', async () => {
        const start = pendingStart();
        const onObstacle = vi.fn();
        const obstacle: VisionObstacle = { kind: 'pole', direction: 12 };

        const disconnect = connectVision(vi.fn(), vi.fn(), vi.fn(), onObstacle);
        start.finish();
        await flush();
        start.obstacle(obstacle);
        disconnect();
        start.obstacle(obstacle);

        expect(onObstacle).toHaveBeenCalledTimes(1);
        expect(onObstacle).toHaveBeenCalledWith(obstacle);
    });

    it('시작이 끝난 뒤 멈추면 인식을 멈춘다', async () => {
        const start = pendingStart();

        const disconnect = connectVision(vi.fn());
        start.finish();
        await flush();
        disconnect();

        expect(start.stopVision).toHaveBeenCalledTimes(1);
    });

    it('시작이 끝나기 전에 멈추면 시작이 끝나는 대로 바로 멈춘다', async () => {
        const start = pendingStart();

        const disconnect = connectVision(vi.fn());
        disconnect();
        expect(start.stopVision).not.toHaveBeenCalled();

        start.finish();
        await flush();

        expect(start.stopVision).toHaveBeenCalledTimes(1);
    });

    it('멈춘 뒤에 온 결과는 버린다', async () => {
        const start = pendingStart();
        const onFrame = vi.fn();

        const disconnect = connectVision(onFrame);
        start.finish();
        await flush();
        disconnect();
        start.emit(FRAME);

        expect(onFrame).not.toHaveBeenCalled();
    });

    it('시작에 실패해도 오류를 던지지 않고 멈춰도 문제없다', async () => {
        const start = pendingStart();

        const disconnect = connectVision(vi.fn());
        start.fail(new Error('시작 실패'));
        await flush();

        expect(() => disconnect()).not.toThrow();
        expect(start.stopVision).not.toHaveBeenCalled();
    });

    it('시작에 실패하면 실패 종류를 onFailure 로 넘긴다', async () => {
        const start = pendingStart();
        const error = new Error('권한 거부');
        platform.visionFailure.mockReturnValue('denied');
        const onFailure = vi.fn();

        connectVision(vi.fn(), vi.fn(), onFailure);
        start.fail(error);
        await flush();

        expect(platform.visionFailure).toHaveBeenCalledWith(error);
        expect(onFailure).toHaveBeenCalledWith('denied');
    });

    it('멈춘 뒤에 실패하면 알리지 않는다', async () => {
        const start = pendingStart();
        const onFailure = vi.fn();

        const disconnect = connectVision(vi.fn(), vi.fn(), onFailure);
        disconnect();
        start.fail(new Error('시작 실패'));
        await flush();

        expect(onFailure).not.toHaveBeenCalled();
    });
});
