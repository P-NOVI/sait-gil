// 카메라 인파 인식. 앱에서는 Kotlin 플러그인 SaitgilVision(CameraX + LiteRT)이 카메라를 돌리고,
// 사람 거리·밀집도·빈 방향 같은 추론 결과만 이 어댑터로 넘긴다(영상은 기기 밖으로 보내지 않는다).
// 웹(PWA)에는 플러그인이 없어 인식을 쓸 수 없다. 화면은 VisionPanel 이 쓴다.

import { type PluginListenerHandle, registerPlugin } from '@capacitor/core';

import { isNativeApp } from './runtime';

/** 밀집도 4단계. 민감도는 이 단계끼리만 비교한다. */
const CROWD_LEVELS = ['clear', 'caution', 'crowded', 'danger'] as const;
export type CrowdLevel = (typeof CROWD_LEVELS)[number];

/** 카메라 가림·신뢰도 부족은 밀집도와 별개인 판단 불가 상태다. */
export type VisionLevel = CrowdLevel | 'unknown';

/** 빈 공간을 알리는 시계 방향 (10시~2시 5방향) */
const CLOCK_DIRECTIONS = [10, 11, 12, 1, 2] as const;
export type ClockDirection = (typeof CLOCK_DIRECTIONS)[number];

/** 한 번 추론한 결과 */
export type VisionFrame = {
    level: VisionLevel;
    /** 앞쪽에서 가장 가까운 사람까지 거리(m). 사람이 없으면 null */
    nearestPersonM: number | null;
    /** 지나갈 만한 빈 방향. 넓은 순 */
    freeDirections: ClockDirection[];
};

export const VISION_NOT_READY = '인파 인식은 준비 중입니다.';

/** Kotlin 플러그인 SaitgilVision 의 화면 쪽 모양. alert 이벤트는 아직 받지 않는다. */
type SaitgilVisionPlugin = {
    start(): Promise<void>;
    stop(): Promise<void>;
    addListener(
        eventName: 'crowdState',
        listener: (state: unknown) => void,
    ): Promise<PluginListenerHandle>;
};

let plugin: SaitgilVisionPlugin | null = null;
// 플러그인은 하나를 공유한다. 이전 연결의 늦은 종료가 새 연결을 끄지 않게 한다.
let owner: symbol | null = null;
let lifecycle: Promise<void> = Promise.resolve();

/** 시작·종료가 끝난 뒤 다음 명령을 보낸다. 실패해도 다음 연결은 시도할 수 있다. */
function inOrder(operation: () => Promise<void>): Promise<void> {
    const pending = lifecycle.then(operation);
    lifecycle = pending.catch(() => undefined);
    return pending;
}

// 웹에서는 부르지 않으므로 처음 쓸 때 등록한다.
function visionPlugin(): SaitgilVisionPlugin {
    plugin ??= registerPlugin<SaitgilVisionPlugin>('SaitgilVision');
    return plugin;
}

/**
 * 플러그인이 보낸 값을 VisionFrame 으로 바꾼다.
 * 모르는 단계는 인식 실패를 성공으로 오인하지 않도록 판단 불가로 보고, 잘못된 값은 버린다.
 */
function toFrame(state: unknown): VisionFrame {
    const raw =
        state instanceof Object ? (state as Record<string, unknown>) : {};
    const level =
        CROWD_LEVELS.find((known) => known === raw.level) ?? 'unknown';
    const distance = raw.nearestPersonM;
    const directions = Array.isArray(raw.freeDirections)
        ? raw.freeDirections
        : [];
    return {
        level,
        nearestPersonM:
            typeof distance === 'number' &&
            Number.isFinite(distance) &&
            distance >= 0
                ? distance
                : null,
        // 플러그인이 보낸 넓은 순서를 유지한다. 고정된 시계 순서로 다시 정렬하지 않는다.
        freeDirections: directions.filter(
            (direction): direction is ClockDirection =>
                CLOCK_DIRECTIONS.some((known) => known === direction),
        ),
    };
}

/** 이 기기에서 인파 인식을 쓸 수 있는지. 앱에서만 true */
export function visionAvailable(): boolean {
    return isNativeApp();
}

/**
 * 인파 인식을 시작하고 결과가 나올 때마다 onFrame 으로 알린다. 돌려준 함수를 부르면 멈춘다.
 * 웹에서는 플러그인이 없어 실패한다.
 */
export async function startVision(
    onFrame: (frame: VisionFrame) => void,
): Promise<() => void> {
    if (!isNativeApp()) {
        throw new Error(VISION_NOT_READY);
    }
    const vision = visionPlugin();
    const session = Symbol('vision');
    let stopped = false;
    // 첫 결과를 놓치지 않도록 구독한 뒤에 시작한다.
    const listener = await vision.addListener('crowdState', (state) => {
        if (!stopped) {
            onFrame(toFrame(state));
        }
    });
    try {
        await inOrder(async () => {
            await vision.start();
            owner = session;
        });
    } catch (error) {
        await listener.remove();
        throw error;
    }
    return () => {
        if (stopped) {
            return;
        }
        stopped = true;
        void listener.remove().catch(() => undefined);
        void inOrder(async () => {
            if (owner !== session) {
                return;
            }
            owner = null;
            await vision.stop();
        }).catch(() => undefined);
    };
}
