import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const native = vi.hoisted(() => ({ value: false }));
const plugin = vi.hoisted(() => ({
    start: vi.fn(),
    stop: vi.fn(),
    setWalkSpeed: vi.fn(),
    addListener: vi.fn(),
}));

vi.mock('@capacitor/core', () => ({
    Capacitor: { isNativePlatform: () => native.value },
    registerPlugin: () => plugin,
}));
vi.mock('../platform', async () => await import('./vision'));

import { connectVision } from '../hooks/useVision';
import { freeDirectionText, visionReader } from '../lib/visionAlerts';

import {
    setVisionWalkSpeed,
    startVision,
    VISION_NOT_READY,
    type VisionFrame,
    visionAvailable,
    visionFailure,
} from './vision';

const remove = vi.fn();
const listeners = new Map<string, (state: unknown) => void>();
const emit = (state: unknown) => listeners.get('crowdState')?.(state);
const emitAlert = (alert: unknown) => listeners.get('alert')?.(alert);
const flush = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

afterEach(async () => {
    vi.useRealTimers();
    vi.unstubAllEnvs();
    await flush();
});

beforeEach(() => {
    vi.stubEnv('VITE_VISION_MOCK', 'false');
    native.value = false;
    vi.clearAllMocks();
    plugin.start.mockResolvedValue(undefined);
    plugin.stop.mockResolvedValue(undefined);
    remove.mockResolvedValue(undefined);
    listeners.clear();
    plugin.addListener.mockImplementation(
        async (event: string, listener: (state: unknown) => void) => {
            listeners.set(event, listener);
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
    it('웹 mock 을 켜면 네이티브 호출 없이 결과를 보내고 종료 뒤에는 멈춘다', async () => {
        vi.useFakeTimers();
        vi.stubEnv('VITE_VISION_MOCK', 'true');
        const onFrame = vi.fn();

        expect(visionAvailable()).toBe(true);
        const stop = await startVision(onFrame);
        vi.advanceTimersByTime(500);
        expect(onFrame).toHaveBeenCalledWith({
            level: 'clear',
            nearestPersonM: null,
            freeDirections: [11, 12, 1],
            signal: null,
            obstacles: [],
        });
        expect(plugin.addListener).not.toHaveBeenCalled();
        expect(plugin.start).not.toHaveBeenCalled();

        stop();
        vi.advanceTimersByTime(6_000);
        expect(onFrame).toHaveBeenCalledTimes(1);
    });

    it('앱에서는 mock 설정이 켜져 있어도 네이티브 플러그인을 쓴다', async () => {
        native.value = true;
        vi.stubEnv('VITE_VISION_MOCK', 'true');
        const stop = await startVision(vi.fn());

        expect(plugin.start).toHaveBeenCalledTimes(1);
        expect(plugin.addListener).toHaveBeenCalledTimes(2);
        stop();
    });

    it('네이티브 빈 방향의 넓은 순서가 실제 혼잡 알림까지 이어진다', async () => {
        native.value = true;
        const read = visionReader();
        const texts: string[] = [];
        const disconnect = connectVision((frame) => {
            const cue = read(frame, Date.now(), 'crowded');
            if (cue?.kind === 'alert') texts.push(cue.alert.text);
        });
        await flush();
        for (let i = 0; i < 3; i += 1) {
            emit({
                level: 'crowded',
                nearestPersonM: 2,
                freeDirections: [2, 12, 10],
            });
        }

        expect(texts).toEqual([freeDirectionText(2)]);
        disconnect();
    });

    it('웹에서는 플러그인을 부르지 않고 준비 중으로 실패한다', async () => {
        await expect(startVision(vi.fn())).rejects.toThrow(VISION_NOT_READY);

        expect(plugin.addListener).not.toHaveBeenCalled();
        expect(plugin.start).not.toHaveBeenCalled();
    });

    it('앱에서는 crowdState 와 alert 를 구독한 뒤 시작한다', async () => {
        native.value = true;

        await startVision(vi.fn());

        expect(plugin.addListener).toHaveBeenCalledWith(
            'crowdState',
            expect.any(Function),
        );
        expect(plugin.addListener).toHaveBeenCalledWith(
            'alert',
            expect.any(Function),
        );
        expect(plugin.start).toHaveBeenCalledTimes(1);
        expect(
            Math.max(...plugin.addListener.mock.invocationCallOrder),
        ).toBeLessThan(plugin.start.mock.invocationCallOrder[0]);
    });

    it('정면 접근 alert 를 거리·빈 방향과 함께 넘긴다', async () => {
        native.value = true;
        const onApproach = vi.fn();
        await startVision(vi.fn(), onApproach);

        emitAlert({
            kind: 'danger',
            message: '정면 접근',
            distanceM: 2.2,
            freeDirections: [1, '11', 3, 12],
        });

        expect(onApproach).toHaveBeenCalledWith({
            distanceM: 2.2,
            freeDirections: [1, 12],
        });
    });

    it('정면 접근이 아니거나 거리가 잘못된 alert 는 버린다', async () => {
        native.value = true;
        const onApproach = vi.fn();
        const stop = await startVision(vi.fn(), onApproach);

        emitAlert({ kind: 'signal', message: '신호 변경', distanceM: 2 });
        emitAlert({ kind: 'danger', distanceM: null, freeDirections: [] });
        emitAlert('이상한 값');
        stop();
        emitAlert({ kind: 'danger', distanceM: 2, freeDirections: [] });

        expect(onApproach).not.toHaveBeenCalled();
    });

    it('플러그인이 보낸 crowdState 를 VisionFrame 으로 넘긴다', async () => {
        native.value = true;
        const frames: VisionFrame[] = [];
        await startVision((frame) => frames.push(frame));

        emit({ level: 'crowded', nearestPersonM: 2.1, freeDirections: [11] });

        expect(frames).toEqual([
            {
                level: 'crowded',
                nearestPersonM: 2.1,
                freeDirections: [11],
                signal: null,
                obstacles: [],
            },
        ]);
    });

    it('거리가 null 이고 판단 불가인 값도 받는다', async () => {
        native.value = true;
        const frames: VisionFrame[] = [];
        await startVision((frame) => frames.push(frame));

        emit({ level: 'unknown', nearestPersonM: null, freeDirections: [] });

        expect(frames).toEqual([
            {
                level: 'unknown',
                nearestPersonM: null,
                freeDirections: [],
                signal: null,
                obstacles: [],
            },
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
            {
                level: 'unknown',
                nearestPersonM: null,
                freeDirections: [12],
                signal: null,
                obstacles: [],
            },
            {
                level: 'unknown',
                nearestPersonM: null,
                freeDirections: [],
                signal: null,
                obstacles: [],
            },
        ]);
    });

    it('보행 신호등 상태를 받고 모르는 값은 안 보인 것으로 본다', async () => {
        native.value = true;
        const frames: VisionFrame[] = [];
        const stop = await startVision((frame) => frames.push(frame));

        emit({ level: 'clear', freeDirections: [], signal: 'red' });
        emit({ level: 'clear', freeDirections: [], signal: 'other' });
        emit({ level: 'clear', freeDirections: [], signal: 'green' });

        expect(frames.map((frame) => frame.signal)).toEqual([
            'red',
            'other',
            null,
        ]);
        stop();
    });

    it('프레임에 보인 장애물을 넘기고 클래스나 방향이 잘못된 것은 뺀다', async () => {
        native.value = true;
        const frames: VisionFrame[] = [];
        const stop = await startVision((frame) => frames.push(frame));

        emit({
            level: 'clear',
            freeDirections: [],
            obstacles: [
                { kind: 'car', direction: 12 },
                { kind: 'person', direction: 11 },
                { kind: 'pole', direction: 3 },
                '이상한 값',
                { kind: 'pole', direction: 1 },
            ],
        });
        emit({ level: 'clear', freeDirections: [], obstacles: 'car' });

        expect(frames.map((frame) => frame.obstacles)).toEqual([
            [
                { kind: 'car', direction: 12 },
                { kind: 'pole', direction: 1 },
            ],
            [],
        ]);
        stop();
    });

    it('장애물 alert 를 클래스·방향과 함께 넘긴다', async () => {
        native.value = true;
        const onApproach = vi.fn();
        const onObstacle = vi.fn();
        const stop = await startVision(vi.fn(), onApproach, onObstacle);

        emitAlert({
            kind: 'obstacle',
            message: 'pole',
            objectClass: 'pole',
            direction: 11,
        });

        expect(onObstacle).toHaveBeenCalledWith({
            kind: 'pole',
            direction: 11,
        });
        expect(onApproach).not.toHaveBeenCalled();
        stop();
    });

    it('서 있는 차 alert(moving false)는 still 을 붙이고, 움직이는 차는 붙이지 않는다', async () => {
        native.value = true;
        const onObstacle = vi.fn();
        const stop = await startVision(vi.fn(), vi.fn(), onObstacle);

        emitAlert({
            kind: 'obstacle',
            objectClass: 'car',
            direction: 12,
            moving: false,
        });
        emitAlert({
            kind: 'obstacle',
            objectClass: 'car',
            direction: 1,
            moving: true,
        });

        expect(onObstacle).toHaveBeenNthCalledWith(1, {
            kind: 'car',
            direction: 12,
            still: true,
        });
        expect(onObstacle).toHaveBeenNthCalledWith(2, {
            kind: 'car',
            direction: 1,
        });
        stop();
    });

    it('클래스나 방향이 잘못된 장애물 alert 와 멈춘 뒤의 alert 는 버린다', async () => {
        native.value = true;
        const onObstacle = vi.fn();
        const stop = await startVision(vi.fn(), vi.fn(), onObstacle);

        emitAlert({ kind: 'obstacle', objectClass: 'person', direction: 12 });
        emitAlert({ kind: 'obstacle', objectClass: 'car', direction: 3 });
        emitAlert({ kind: 'danger', objectClass: 'car', direction: 12 });
        stop();
        emitAlert({ kind: 'obstacle', objectClass: 'car', direction: 12 });

        expect(onObstacle).not.toHaveBeenCalled();
    });

    it('돌려준 함수를 부르면 멈추고 구독을 끊는다. 두 번 불러도 한 번만 한다', async () => {
        native.value = true;
        const stop = await startVision(vi.fn());

        stop();
        stop();
        await flush();

        expect(plugin.stop).toHaveBeenCalledTimes(1);
        expect(remove).toHaveBeenCalledTimes(2);
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
            signal: null,
            obstacles: [],
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

        expect(remove).toHaveBeenCalledTimes(2);
    });
});

describe('visionFailure', () => {
    it('권한 거부 코드는 denied, 더 묻지 않는 거부는 blocked, 그 밖의 오류는 failed 로 본다', () => {
        expect(
            visionFailure(
                Object.assign(new Error('권한 없음'), {
                    code: 'CAMERA_DENIED',
                }),
            ),
        ).toBe('denied');
        expect(
            visionFailure(
                Object.assign(new Error('더 묻지 않음'), {
                    code: 'CAMERA_BLOCKED',
                }),
            ),
        ).toBe('blocked');
        expect(
            visionFailure(
                Object.assign(new Error('카메라 실패'), {
                    code: 'CAMERA_FAILED',
                }),
            ),
        ).toBe('failed');
        expect(visionFailure(new Error('Plugin not implemented'))).toBe(
            'failed',
        );
        expect(visionFailure('이상한 값')).toBe('failed');
    });

    it('앱에서 권한을 거부하면 connectVision 이 denied 를 알린다', async () => {
        native.value = true;
        plugin.start.mockRejectedValue(
            Object.assign(new Error('권한 없음'), { code: 'CAMERA_DENIED' }),
        );
        const onFailure = vi.fn();

        connectVision(vi.fn(), vi.fn(), onFailure);
        await flush();

        expect(onFailure).toHaveBeenCalledWith('denied');
    });
});

describe('setVisionWalkSpeed', () => {
    beforeEach(() => {
        plugin.setWalkSpeed.mockReset().mockResolvedValue(undefined);
    });

    it('앱에서는 걸음 속도를 플러그인에 보낸다', () => {
        native.value = true;

        setVisionWalkSpeed(1.2);

        expect(plugin.setWalkSpeed).toHaveBeenCalledWith({ speedMps: 1.2 });
    });

    it('모르면 null 로 보낸다', () => {
        native.value = true;

        setVisionWalkSpeed(null);

        expect(plugin.setWalkSpeed).toHaveBeenCalledWith({ speedMps: null });
    });

    it('음수는 0으로, 숫자가 아닌 값은 보내지 않는다', () => {
        native.value = true;

        setVisionWalkSpeed(-1);
        setVisionWalkSpeed(Number.NaN);

        expect(plugin.setWalkSpeed).toHaveBeenCalledTimes(1);
        expect(plugin.setWalkSpeed).toHaveBeenCalledWith({ speedMps: 0 });
    });

    it('웹에서는 보내지 않고, 보내기가 실패해도 오류를 던지지 않는다', async () => {
        native.value = false;
        setVisionWalkSpeed(1.2);
        expect(plugin.setWalkSpeed).not.toHaveBeenCalled();

        native.value = true;
        plugin.setWalkSpeed.mockRejectedValue(new Error('실패'));
        expect(() => setVisionWalkSpeed(1.2)).not.toThrow();
        await flush();
    });
});
