// 카메라 인파 인식. 앱에서는 Kotlin 플러그인 SaitgilVision(CameraX + LiteRT)이 카메라를 돌리고,
// 사람 거리·밀집도·빈 방향 같은 추론 결과만 이 어댑터로 넘긴다(영상은 기기 밖으로 보내지 않는다).
// 웹에서는 개발용 mock 을 켰을 때만 결과를 보낸다. 화면은 VisionPanel 이 쓴다.

import { type PluginListenerHandle, registerPlugin } from '@capacitor/core';

import { isNativeApp } from './runtime';
import { startMockVision } from './visionMock';

/** 밀집도 4단계. 민감도는 이 단계끼리만 비교한다. */
const CROWD_LEVELS = ['clear', 'caution', 'crowded', 'danger'] as const;
export type CrowdLevel = (typeof CROWD_LEVELS)[number];

/** 카메라 가림·신뢰도 부족은 밀집도와 별개인 판단 불가 상태다. */
export type VisionLevel = CrowdLevel | 'unknown';

/** 빈 공간을 알리는 시계 방향 (10시~2시 5방향) */
const CLOCK_DIRECTIONS = [10, 11, 12, 1, 2] as const;
export type ClockDirection = (typeof CLOCK_DIRECTIONS)[number];

/** 보행 신호등 상태. other 는 빨간불이 아닌 신호등(초록·깜빡임·꺼짐)이다 */
const PED_SIGNALS = ['red', 'other'] as const;
export type PedSignal = (typeof PED_SIGNALS)[number];

/** 한 번 추론한 결과 */
export type VisionFrame = {
    level: VisionLevel;
    /** 앞쪽에서 가장 가까운 사람까지 거리(m). 사람이 없으면 null */
    nearestPersonM: number | null;
    /** 지나갈 만한 빈 방향. 넓은 순 */
    freeDirections: ClockDirection[];
    /** 몇 프레임 연달아 같았던 보행 신호등 상태. 안 보이면 null */
    signal: PedSignal | null;
    /** 플러그인이 따라가는 보행 신호등 번호. 새 신호등을 고를 때마다 바뀐다. 모르면 0 */
    signalId: number;
    /** 이 프레임에 앞쪽 가까이 보인 장애물. 여러 프레임 확인을 거치지 않아 화면에만 쓴다 */
    obstacles: VisionObstacle[];
};

/** 걷는 길 앞에 있으면 알리는 장애물. 플러그인(DetectedClass)의 wire 값과 같아야 한다 */
const OBSTACLE_KINDS = [
    'two_wheeler',
    'car',
    'obstacle',
    'pole',
    'stairs',
] as const;
export type ObstacleKind = (typeof OBSTACLE_KINDS)[number];

/** 가까운 장애물. 거리는 재지 않고 방향만 안다 */
export type VisionObstacle = {
    kind: ObstacleKind;
    direction: ClockDirection;
    /** 서 있는 차·이륜차. 움직이는 차처럼 조심하라고 하지 않고 장애물처럼 알린다 */
    still?: true;
};

/** 정면 사람이 빠르게 가까워짐(앞사람 멈춤, 마주 오는 사람) */
export type VisionApproach = {
    /** 그 사람까지 거리(m) */
    distanceM: number;
    /** 지나갈 만한 빈 방향. 넓은 순 */
    freeDirections: ClockDirection[];
};

export const VISION_NOT_READY = '인파 인식은 준비 중입니다.';

/**
 * 카메라를 켜지 못한 이유. denied: 카메라 권한 거부(다시 켜면 시스템 창이 다시 뜬다),
 * blocked: 카메라 권한 거부 + 더 묻지 않음(설정 화면에서 켜야 한다), failed: 그 밖의 실패
 */
export type VisionFailure = 'denied' | 'blocked' | 'failed';

// 플러그인(SaitgilVisionPlugin.kt)이 실패와 함께 보내는 코드. 플러그인 쪽 값과 같아야 한다.
const CAMERA_DENIED_CODE = 'CAMERA_DENIED';
const CAMERA_BLOCKED_CODE = 'CAMERA_BLOCKED';

/** startVision 이 던진 오류가 어떤 실패인지. 모르는 오류는 그 밖의 실패로 본다. */
export function visionFailure(error: unknown): VisionFailure {
    const code = error instanceof Object ? Reflect.get(error, 'code') : null;
    if (code === CAMERA_DENIED_CODE) {
        return 'denied';
    }
    return code === CAMERA_BLOCKED_CODE ? 'blocked' : 'failed';
}

/** Kotlin 플러그인 SaitgilVision 의 화면 쪽 모양. alert 는 정면 접근(danger)과 장애물(obstacle)만 받는다. */
type SaitgilVisionPlugin = {
    start(): Promise<void>;
    stop(): Promise<void>;
    setWalkSpeed(options: { speedMps: number | null }): Promise<void>;
    setNearCrosswalk(options: { near: boolean }): Promise<void>;
    addListener(
        eventName: 'crowdState' | 'alert',
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
    const raw = asRecord(state);
    const level =
        CROWD_LEVELS.find((known) => known === raw.level) ?? 'unknown';
    return {
        level,
        nearestPersonM: toDistance(raw.nearestPersonM),
        freeDirections: toDirections(raw.freeDirections),
        signal: PED_SIGNALS.find((known) => known === raw.signal) ?? null,
        signalId: toSignalId(raw.signalId),
        obstacles: (Array.isArray(raw.obstacles) ? raw.obstacles : [])
            .map((seen) => {
                const { kind, direction } = asRecord(seen);
                return toSighting(kind, direction);
            })
            .filter((seen) => seen !== null),
    };
}

/** 플러그인 alert 를 정면 접근으로 바꾼다. 정면 접근이 아니거나 거리가 잘못됐으면 null */
export function toApproach(alert: unknown): VisionApproach | null {
    const raw = asRecord(alert);
    const distanceM = toDistance(raw.distanceM);
    if (raw.kind !== 'danger' || distanceM === null) {
        return null;
    }
    return { distanceM, freeDirections: toDirections(raw.freeDirections) };
}

/** 플러그인 alert 를 장애물로 바꾼다. 장애물이 아니거나 클래스·방향이 잘못됐으면 null */
export function toObstacle(alert: unknown): VisionObstacle | null {
    const raw = asRecord(alert);
    if (raw.kind !== 'obstacle') return null;
    const sighting = toSighting(raw.objectClass, raw.direction);
    return sighting && raw.moving === false
        ? { ...sighting, still: true }
        : sighting;
}

/** 장애물 클래스·방향을 VisionObstacle 로 바꾼다. 하나라도 잘못됐으면 null */
function toSighting(
    objectClass: unknown,
    clock: unknown,
): VisionObstacle | null {
    const kind = OBSTACLE_KINDS.find((known) => known === objectClass);
    const [direction] = toDirections([clock]);
    return kind && direction !== undefined ? { kind, direction } : null;
}

function asRecord(value: unknown): Record<string, unknown> {
    return value instanceof Object ? (value as Record<string, unknown>) : {};
}

function toDistance(value: unknown): number | null {
    return typeof value === 'number' && Number.isFinite(value) && value >= 0
        ? value
        : null;
}

function toSignalId(value: unknown): number {
    return typeof value === 'number' && Number.isInteger(value) ? value : 0;
}

// 플러그인이 보낸 넓은 순서를 유지한다. 고정된 시계 순서로 다시 정렬하지 않는다.
function toDirections(value: unknown): ClockDirection[] {
    return (Array.isArray(value) ? value : []).filter(
        (direction): direction is ClockDirection =>
            CLOCK_DIRECTIONS.some((known) => known === direction),
    );
}

/** 웹에서 플러그인 없이 알림을 확인할 때만 mock 을 켠다. 앱에서는 네이티브를 우선한다. */
function mockEnabled(): boolean {
    return import.meta.env.VITE_VISION_MOCK === 'true';
}

/** 네이티브 앱 또는 mock 을 켠 웹에서 인식 결과를 받을 수 있다. */
export function visionAvailable(): boolean {
    return isNativeApp() || mockEnabled();
}

/**
 * 사용자가 걷는 속도(m/s)를 플러그인에 알린다. 플러그인은 차의 움직임을 잴 때 내 걸음을 뺀다.
 * 멈춰 있으면 0, 모르면 null 이다. 모를 때 플러그인은 걸음을 빼지 않고 예전 기준으로 판단한다.
 * 앱에서만 보내고, 보내지 못해도 인식은 계속되므로 실패는 무시한다.
 */
export function setVisionWalkSpeed(speedMps: number | null): void {
    if (!isNativeApp() || (speedMps !== null && !Number.isFinite(speedMps))) {
        return;
    }
    void visionPlugin()
        .setWalkSpeed({
            speedMps: speedMps === null ? null : Math.max(0, speedMps),
        })
        .catch(() => undefined);
}

/**
 * 길안내 경로의 횡단보도 근처인지 플러그인에 알린다. 플러그인은 근처에서 분석 해상도를 올리고
 * 영상 위쪽 가운데를 잘라 길 건너 먼 신호등을 한 번 더 찾는다(#134).
 * 앱에서만 보내고, 보내지 못해도 인식은 계속되므로 실패는 무시한다.
 */
export function setVisionNearCrosswalk(near: boolean): void {
    if (!isNativeApp()) {
        return;
    }
    void visionPlugin()
        .setNearCrosswalk({ near })
        .catch(() => undefined);
}

/**
 * 인파 인식을 시작하고 결과가 나올 때마다 onFrame 으로, 정면 접근은 onApproach 로,
 * 가까운 장애물은 onObstacle 로 알린다.
 * 돌려준 함수를 부르면 멈춘다. 앱은 네이티브 플러그인, 웹은 명시적으로 켠 mock 을 사용한다.
 */
export async function startVision(
    onFrame: (frame: VisionFrame) => void,
    onApproach: (approach: VisionApproach) => void = () => undefined,
    onObstacle: (obstacle: VisionObstacle) => void = () => undefined,
): Promise<() => void> {
    if (!isNativeApp()) {
        if (mockEnabled()) {
            return startMockVision(onFrame, onApproach, onObstacle);
        }
        throw new Error(VISION_NOT_READY);
    }
    const vision = visionPlugin();
    const session = Symbol('vision');
    let stopped = false;
    // 첫 결과를 놓치지 않도록 구독한 뒤에 시작한다.
    const listeners = await Promise.all([
        vision.addListener('crowdState', (state) => {
            if (!stopped) {
                onFrame(toFrame(state));
            }
        }),
        vision.addListener('alert', (alert) => {
            if (stopped) {
                return;
            }
            const approach = toApproach(alert);
            if (approach !== null) {
                onApproach(approach);
                return;
            }
            const obstacle = toObstacle(alert);
            if (obstacle !== null) {
                onObstacle(obstacle);
            }
        }),
    ]);
    const removeListeners = () =>
        Promise.all(listeners.map((listener) => listener.remove()));
    try {
        await inOrder(async () => {
            await vision.start();
            owner = session;
        });
    } catch (error) {
        await removeListeners();
        throw error;
    }
    return () => {
        if (stopped) {
            return;
        }
        stopped = true;
        void removeListeners().catch(() => undefined);
        void inOrder(async () => {
            if (owner !== session) {
                return;
            }
            owner = null;
            await vision.stop();
        }).catch(() => undefined);
    };
}
