// 걸음 수. 안내 중 튄 GPS 위치를 거르는 데 쓴다.
// 앱에서는 Kotlin 플러그인 SaitgilSteps(걸음 센서)를 쓰고, 웹(브라우저)에서는 쓸 수 없다.
// 쓸 수 없으면(웹·권한 거부·센서 없는 기기) onSteps 를 한 번도 부르지 않는다.

import { type PluginListenerHandle, registerPlugin } from '@capacitor/core';

import { inPermissionOrder } from './permissionQueue';
import { isNativeApp } from './runtime';

type SaitgilStepsPlugin = {
    /** 걸음 센서를 켠다. 권한이 없으면 묻고, 쓸 수 없으면 available 이 false 다. */
    start(): Promise<{ available: boolean }>;
    stop(): Promise<void>;
    addListener(
        eventName: 'steps',
        listener: (event: { steps: number }) => void,
    ): Promise<PluginListenerHandle>;
};

let plugin: SaitgilStepsPlugin | null = null;

// 웹에서는 부르지 않으므로 처음 쓸 때 등록한다.
const stepsPlugin = () =>
    (plugin ??= registerPlugin<SaitgilStepsPlugin>('SaitgilSteps'));

/**
 * 걸음 수가 바뀔 때마다 onSteps 로 알린다. 값은 구독을 시작한 뒤 걸은 누적 걸음 수다.
 * 돌려준 함수를 부르면 멈춘다.
 */
export function watchSteps(onSteps: (steps: number) => void): () => void {
    if (!isNativeApp()) {
        return () => undefined;
    }
    let stopped = false;
    let handle: PluginListenerHandle | null = null;
    const native = stepsPlugin();
    void (async () => {
        try {
            const listener = await native.addListener('steps', (event) => {
                if (!stopped && Number.isFinite(event.steps)) {
                    onSteps(event.steps);
                }
            });
            if (stopped) {
                await listener.remove();
                return;
            }
            handle = listener;
            const { available } = await inPermissionOrder(() => native.start());
            if (!available) {
                await listener.remove();
                handle = null;
            }
        } catch {
            // 걸음 센서를 못 쓰면 기존 방식(시간 기준)으로 안내한다.
        }
    })();
    return () => {
        stopped = true;
        void handle?.remove();
        void native.stop().catch(() => undefined);
    };
}
