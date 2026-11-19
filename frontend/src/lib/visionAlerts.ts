// 카메라 인식 결과(인파·장애물·보행 신호등)를 알림으로 바꾼다. 읽을지는 알림 중재(위험 > 경로 > 혼잡)가 정한다.
// 한 프레임 튀는 것은 넘기도록 같은 결과가 몇 프레임 이어질 때만 믿는다.

import type {
    ClockDirection,
    CrowdLevel,
    ObstacleKind,
    PedSignal,
    VisionApproach,
    VisionFailure,
    VisionFrame,
    VisionLevel,
    VisionObstacle,
} from '../platform';
import { VISION, type VisionSettings } from '../settings';
import type { Alert } from './alertArbiter';

export const DANGER_TEXT = '멈추세요. 바로 앞에 사람이 있습니다.';
export const MOVE_ASIDE_TEXT = '멈추고 길 가장자리로 비켜 서세요.';
export const CROWDED_TEXT = '앞이 붐빕니다. 속도를 줄이세요.';
export const BLOCKED_TEXT = '앞이 붐빕니다. 잠시 멈춰 기다리세요.';
export const UNKNOWN_TEXT = '주변을 인식할 수 없습니다.';
export const VISION_ON_TEXT = '카메라를 켰습니다.';
export const VISION_OFF_TEXT = '카메라를 껐습니다.';
export const VISION_OFF_STATUS = '카메라가 꺼져 있습니다.';
export const VISION_DENIED_TEXT =
    '카메라 권한이 없어 인파를 알릴 수 없습니다. 설정에서 허용하세요.';
export const VISION_FAILED_TEXT =
    '카메라가 켜지지 않아 인파를 알릴 수 없습니다.';

const FAILURE_TEXTS: Readonly<Record<VisionFailure, string>> = {
    denied: VISION_DENIED_TEXT,
    failed: VISION_FAILED_TEXT,
};

/** 카메라를 켜지 못했을 때 화면에 보이고 읽을 말 */
export function visionFailureText(failure: VisionFailure): string {
    return FAILURE_TEXTS[failure];
}

/**
 * 카메라를 켜지 못했다는 알림. 사용자가 인파 인식이 되는 줄 알고 걷지 않게 꼭 알린다.
 * 경로 등급이라 읽던 길안내가 끝난 뒤 읽는다. 다시 켜다 또 실패하면 쿨다운 없이 다시 알린다.
 */
export function visionFailureAlert(failure: VisionFailure): Alert {
    return {
        key: VISION_KEYS.failure,
        level: 'route',
        text: visionFailureText(failure),
        cooldownMs: 0,
    };
}

export function freeDirectionText(direction: ClockDirection): string {
    return `앞이 붐빕니다. ${direction}시 방향이 비어 있습니다.`;
}

/**
 * 정면 사람이 빠르게 가까워질 때 읽을 말. 앞사람이 멈췄는지 마주 오는지는 카메라로 가릴 수 없어 거리로 말한다.
 * 가까운 거리라 길안내처럼 10미터 단위로 반올림하지 않고 1미터 단위로 읽는다.
 */
export function approachText(approach: VisionApproach): string {
    const meters = Math.max(1, Math.round(approach.distanceM));
    const next = approach.freeDirections[0];
    const advice =
        next === undefined ? '잠시 멈추세요.' : `${next}시 방향이 비었습니다.`;
    return `${meters}미터 앞 사람과 가까워집니다. ${advice}`;
}

/** 정면 접근 알림. 위험 등급이라 읽던 길안내를 끊고 읽는다. */
export function approachAlert(approach: VisionApproach): Alert {
    return {
        key: VISION_KEYS.approach,
        level: 'danger',
        text: approachText(approach),
    };
}

// 장애물 이름과 조사
const OBSTACLE_NAMES: Readonly<Record<ObstacleKind, [string, string]>> = {
    two_wheeler: ['이륜차', '가'],
    car: ['차', '가'],
    obstacle: ['장애물', '이'],
    pole: ['기둥', '이'],
    stairs: ['계단', '이'],
};

// 움직여 부딪히면 크게 다치는 장애물. 읽던 말을 끊고 알린다.
const MOVING_OBSTACLES: ReadonlySet<ObstacleKind> = new Set([
    'two_wheeler',
    'car',
]);

/** 장애물 이름(차, 기둥 등) */
export function obstacleName(kind: ObstacleKind): string {
    return OBSTACLE_NAMES[kind][0];
}

/** 가까운 장애물을 알릴 말. 거리는 재지 않아 방향만 말한다. */
export function obstacleText({ kind, direction }: VisionObstacle): string {
    const [name, particle] = OBSTACLE_NAMES[kind];
    const found = `${direction}시 방향에 ${name}${particle} 있습니다.`;
    return MOVING_OBSTACLES.has(kind) ? `${found} 조심하세요.` : found;
}

/**
 * 가까운 장애물 알림. 차·이륜차는 위험 등급, 그 밖은 경로 등급이다.
 * 다시 알릴 때는 플러그인이 정하므로 쿨다운을 두지 않는다.
 */
export function obstacleAlert(obstacle: VisionObstacle): Alert {
    return {
        key: `${VISION_KEYS.obstacle}-${obstacle.kind}`,
        level: MOVING_OBSTACLES.has(obstacle.kind) ? 'danger' : 'route',
        text: obstacleText(obstacle),
        cooldownMs: 0,
    };
}

export const SIGNAL_RED_TEXT = '빨간불입니다.';
export const SIGNAL_SEEN_TEXT = '신호등이 있습니다.';
// 빨간불이 아닌 신호등에는 깜빡임·꺼짐도 섞여 있어 초록불이라고 말하지 않는다.
export const SIGNAL_CHANGED_TEXT = '빨간불이 바뀌었습니다.';

/** 보행 신호등 상태를 받아 알림을 돌려준다. 알릴 것이 없으면 null */
export type SignalReader = (
    signal: PedSignal | null,
    atCrosswalk: boolean,
) => Alert | null;

/**
 * 안내를 시작할 때마다 새로 만든다. 횡단보도 근처에서만 신호등 상태가 바뀔 때 알린다.
 * 처음 보이면 빨간불인지 알리고, 빨간불에서 바뀌면 바뀌었다고 알린다.
 * 잠깐 안 보였다 같은 상태로 다시 보이면 또 읽지 않는다. 횡단보도를 벗어나면 기록을 지운다.
 */
export function signalReader(): SignalReader {
    let told: PedSignal | null = null;
    return (signal, atCrosswalk) => {
        if (!atCrosswalk) {
            told = null;
            return null;
        }
        if (signal === null || signal === told) {
            return null;
        }
        const text =
            signal === 'red'
                ? SIGNAL_RED_TEXT
                : told === 'red'
                  ? SIGNAL_CHANGED_TEXT
                  : SIGNAL_SEEN_TEXT;
        told = signal;
        return { key: VISION_KEYS.signal, level: 'route', text, cooldownMs: 0 };
    };
}

export const VISION_KEYS = {
    danger: 'vision-danger',
    approach: 'vision-approach',
    moveAside: 'vision-move-aside',
    crowded: 'vision-crowded',
    // 모두 막혀 멈추라는 말은 혼잡 알림을 읽은 직후라도 읽도록 따로 둔다.
    blocked: 'vision-blocked',
    unknown: 'vision-unknown',
    failure: 'vision-failure',
    // 장애물은 클래스마다 따로 둔다(vision-obstacle-pole 등).
    obstacle: 'vision-obstacle',
    signal: 'vision-signal',
} as const;

/** 프레임을 보고 할 일. alert 는 알림 중재로 읽고, buzz 는 말 없이 짧게 진동한다. */
export type VisionCue = { kind: 'alert'; alert: Alert } | { kind: 'buzz' };

/** 프레임 하나를 받아 할 일을 돌려준다. minLevel 보다 낮은 단계는 알리지 않는다. */
export type VisionReader = (
    frame: VisionFrame,
    nowMs: number,
    minLevel: CrowdLevel,
) => VisionCue | null;

const ORDER: readonly CrowdLevel[] = ['clear', 'caution', 'crowded', 'danger'];

function atLeast(level: CrowdLevel, min: CrowdLevel): boolean {
    return ORDER.indexOf(level) >= ORDER.indexOf(min);
}

/** 모든 값이 같으면 그 값, 아니면 undefined */
function same<T>(values: readonly T[]): T | undefined {
    return values.every((value) => value === values[0]) ? values[0] : undefined;
}

/** 혼잡할 때 알림. 빈 방향이 이어지면 그 방향을, 모두 막혔으면 기다리라고 한다. */
function crowdedAlert(frames: readonly VisionFrame[]): Alert {
    if (frames.every((frame) => frame.freeDirections.length === 0)) {
        return { key: VISION_KEYS.blocked, level: 'crowd', text: BLOCKED_TEXT };
    }
    const direction = same(frames.map((frame) => frame.freeDirections[0]));
    return {
        key: VISION_KEYS.crowded,
        level: 'crowd',
        text:
            direction === undefined
                ? CROWDED_TEXT
                : freeDirectionText(direction),
    };
}

const alertCue = (alert: Alert): VisionCue => ({ kind: 'alert', alert });

/** 안내를 시작할 때마다 새로 만든다. 지난 프레임을 기억해 여러 프레임을 확인한다. */
export function visionReader(settings: VisionSettings = VISION): VisionReader {
    let recent: VisionFrame[] = [];
    // 마지막으로 이어진 단계. 프레임이 섞여도 지우지 않아 한 번 튄 뒤 다시 진동하지 않는다.
    let lastSteady: VisionLevel | null = null;
    let dangerSince: number | null = null;

    return (frame, nowMs, minLevel) => {
        recent = [...recent, frame].slice(-settings.confirmFrames);

        const dangerFrames = recent.slice(-settings.dangerFrames);
        const danger =
            dangerFrames.length === settings.dangerFrames &&
            dangerFrames.every((each) => each.level === 'danger');
        dangerSince = danger ? (dangerSince ?? nowMs) : null;

        const steady =
            recent.length === settings.confirmFrames
                ? same(recent.map((each) => each.level))
                : undefined;
        const previous = lastSteady;
        lastSteady = steady ?? lastSteady;

        // 위험은 민감도와 상관없이 알린다.
        if (dangerSince !== null) {
            return nowMs - dangerSince >= settings.sustainedDangerMs
                ? alertCue({
                      key: VISION_KEYS.moveAside,
                      level: 'danger',
                      text: MOVE_ASIDE_TEXT,
                      cooldownMs: settings.moveAsideCooldownMs,
                  })
                : alertCue({
                      key: VISION_KEYS.danger,
                      level: 'danger',
                      text: DANGER_TEXT,
                  });
        }
        if (steady === undefined) {
            return null;
        }
        // 판단 불가는 안내마다 한 번만 읽는다.
        if (steady === 'unknown') {
            return alertCue({
                key: VISION_KEYS.unknown,
                level: 'crowd',
                text: UNKNOWN_TEXT,
                cooldownMs: Infinity,
            });
        }
        if (!atLeast(steady, minLevel)) {
            return null;
        }
        if (steady === 'crowded') {
            return alertCue(crowdedAlert(recent));
        }
        // 주의는 단계가 바뀔 때 한 번만 짧게 진동한다.
        if (steady === 'caution' && previous !== 'caution') {
            return { kind: 'buzz' };
        }
        return null;
    };
}
