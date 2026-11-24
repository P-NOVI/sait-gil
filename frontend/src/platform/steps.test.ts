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

import { inPermissionOrder } from './permissionQueue';
import { watchSteps } from './steps';

const remove = vi.fn();
const listeners = new Map<string, (event: { steps: number }) => void>();
const flush = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

beforeEach(() => {
    native.value = true;
    vi.clearAllMocks();
    listeners.clear();
    plugin.start.mockResolvedValue({ available: true });
    plugin.stop.mockResolvedValue(undefined);
    remove.mockResolvedValue(undefined);
    plugin.addListener.mockImplementation(
        async (event: string, listener: (e: { steps: number }) => void) => {
            listeners.set(event, listener);
            return { remove };
        },
    );
});

describe('watchSteps', () => {
    it('웹에서는 플러그인을 부르지 않는다', async () => {
        native.value = false;
        const stop = watchSteps(vi.fn());
        await flush();
        stop();

        expect(plugin.addListener).not.toHaveBeenCalled();
        expect(plugin.start).not.toHaveBeenCalled();
    });

    it('걸음 수를 받아 알리고, 숫자가 아닌 값은 버린다', async () => {
        const onSteps = vi.fn();
        watchSteps(onSteps);
        await flush();
        listeners.get('steps')?.({ steps: 3 });
        listeners.get('steps')?.({ steps: Number.NaN });

        expect(plugin.start).toHaveBeenCalledOnce();
        expect(onSteps).toHaveBeenCalledOnce();
        expect(onSteps).toHaveBeenCalledWith(3);
    });

    it('걸음 센서를 쓸 수 없으면 리스너를 걷어 낸다', async () => {
        plugin.start.mockResolvedValue({ available: false });
        const onSteps = vi.fn();
        watchSteps(onSteps);
        await flush();

        expect(remove).toHaveBeenCalledOnce();
    });

    it('시작이 실패해도 던지지 않는다', async () => {
        plugin.start.mockRejectedValue(new Error('permission'));
        const stop = watchSteps(vi.fn());
        await flush();

        expect(() => stop()).not.toThrow();
    });

    it('멈추면 센서와 리스너를 끄고 이후 걸음 수는 알리지 않는다', async () => {
        const onSteps = vi.fn();
        const stop = watchSteps(onSteps);
        await flush();
        stop();
        listeners.get('steps')?.({ steps: 5 });

        expect(plugin.stop).toHaveBeenCalledOnce();
        expect(remove).toHaveBeenCalledOnce();
        expect(onSteps).not.toHaveBeenCalled();
    });

    it('시작하기 전에 멈추면 리스너만 걷어 내고 센서는 켜지 않는다', async () => {
        const stop = watchSteps(vi.fn());
        stop();
        await flush();

        expect(plugin.start).not.toHaveBeenCalled();
        expect(remove).toHaveBeenCalledOnce();
    });
});

describe('inPermissionOrder', () => {
    it('앞선 요청이 끝난 뒤에 다음 요청을 보낸다', async () => {
        const order: string[] = [];
        let finishFirst: () => void = () => undefined;
        const first = inPermissionOrder(
            () =>
                new Promise<void>((resolve) => {
                    order.push('first start');
                    finishFirst = () => {
                        order.push('first end');
                        resolve();
                    };
                }),
        );
        const second = inPermissionOrder(async () => {
            order.push('second start');
        });
        await flush();

        expect(order).toEqual(['first start']);

        finishFirst();
        await Promise.all([first, second]);

        expect(order).toEqual(['first start', 'first end', 'second start']);
    });

    it('앞선 요청이 실패해도 다음 요청을 보낸다', async () => {
        const failed = inPermissionOrder(() => Promise.reject(new Error('no')));
        const next = inPermissionOrder(async () => 'ok');

        await expect(failed).rejects.toThrow('no');
        await expect(next).resolves.toBe('ok');
    });
});
