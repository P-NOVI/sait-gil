// 카메라 인식 결과(인파·장애물·보행 신호등)를 알림으로 바꾼다. 읽을지는 알림 중재(위험 > 경로 > 혼잡)가 정한다.
// 한 프레임 튀는 것은 넘기도록 같은 결과가 몇 프레임 이어질 때만 믿는다.

import type {
    ClockDirection,
    CrowdLevel,
    ObstacleKind,
    PedSignal,
    VisionFailure,
    VisionFrame,
    VisionLevel,
    VisionObstacle,
    VisionSideEntry,
} from '../platform';
import {
    CROSSING_FACING,
    type CrossingFacingSettings,
    VISION,
    type VisionSettings,
} from '../settings';
import type { Alert } from './alertArbiter';

export const DANGER_TEXT = '바로 앞에 사람이 있습니다.';
export const MOVE_ASIDE_TEXT = '길 가장자리로 비켜 서세요.';
export const CROWDED_TEXT = '앞이 붐빕니다. 속도를 줄이세요.';
export const BLOCKED_TEXT = '앞이 붐빕니다.';
// 신호를 기다리느라 서 있는데 앞에 사람이 서면 붐빔·위험이 아니라 이것만 알린다.
export const WAITING_FRONT_TEXT = '앞에 사람이 있습니다.';
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
    blocked: VISION_DENIED_TEXT,
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

/** 다가오거나 길로 들어오는 차·이륜차인지. 서 있는 차는 장애물처럼 다룬다 */
function isMovingVehicle({ kind, still }: VisionObstacle): boolean {
    return MOVING_OBSTACLES.has(kind) && !still;
}

/**
 * 가까운 장애물을 알릴 말. 거리는 말하지 않고 방향만 말한다.
 * 움직이는 차·이륜차는 빨리 다가와 다 읽기 전에 지나가지 않도록 짧게 말한다.
 */
export function obstacleText(obstacle: VisionObstacle): string {
    const { kind, direction } = obstacle;
    const [name, particle] = OBSTACLE_NAMES[kind];
    return isMovingVehicle(obstacle)
        ? `${direction}시 ${name} 조심.`
        : `${direction}시 방향에 ${name}${particle} 있습니다.`;
}

/**
 * 가까운 장애물 알림. 움직이는 차·이륜차는 위험 등급, 그 밖(서 있는 차 포함)은 경로 등급이다.
 * 다시 알릴 때는 플러그인이 정하므로 쿨다운을 두지 않는다.
 */
export function obstacleAlert(obstacle: VisionObstacle): Alert {
    return {
        key: `${VISION_KEYS.obstacle}-${obstacle.kind}`,
        level: isMovingVehicle(obstacle) ? 'danger' : 'route',
        text: obstacleText(obstacle),
        cooldownMs: 0,
    };
}

const SIDE_ENTRY_TEXTS: Readonly<Record<VisionSideEntry['side'], string>> = {
    left: '왼쪽에서 사람 진입.',
    right: '오른쪽에서 사람 진입.',
};

/** 옆 진입을 알릴 말. 가로질러 오는지 추월하는지 모르므로 움직임은 말하지 않고, 빨리 끝나도록 짧게 말한다 */
export function sideEntryText(entry: VisionSideEntry): string {
    return SIDE_ENTRY_TEXTS[entry.side];
}

/**
 * 옆에서 가까운 사람이 들어왔다는 알림. 위험 등급이다. 다시 알릴 때는 플러그인이 정하므로 쿨다운을 두지 않는다.
 * 왼쪽과 오른쪽은 키를 따로 둬 서로 막지 않는다.
 */
export function sideEntryAlert(entry: VisionSideEntry): Alert {
    return {
        key: `${VISION_KEYS.sideEntry}-${entry.side}`,
        level: 'danger',
        text: sideEntryText(entry),
        cooldownMs: 0,
    };
}

export const SIGNAL_RED_TEXT = '빨간불입니다.';
export const SIGNAL_SEEN_TEXT = '신호등이 있습니다.';
// 빨간불이 아닌 신호등에는 깜빡임·꺼짐도 섞여 있어 초록불이라고 말하지 않는다.
export const SIGNAL_CHANGED_TEXT = '빨간불이 바뀌었습니다.';

/** 신호등을 읽을 때 같이 보는 것 */
export type SignalView = {
    /** 카메라가 횡단보도를 건너는 방향을 보는지. 모르면 true */
    facing: boolean;
    /** 플러그인이 따라가는 신호등 번호(VisionFrame.signalId) */
    signalId: number;
    nowMs: number;
};

/**
 * 보행 신호등 상태를 받아 알림을 돌려준다. 알릴 것이 없으면 null.
 * view 에서 빠진 값은 건너는 방향을 봄, 번호 0, 0ms 로 본다.
 */
export type SignalReader = (
    signal: PedSignal | null,
    atCrosswalk: boolean,
    view?: Partial<SignalView>,
) => Alert | null;

/**
 * 안내를 시작할 때마다 새로 만든다. 횡단보도 근처에서 건너는 방향을 볼 때만 신호등 상태가 바뀔 때 알린다.
 * 처음 보이면 빨간불인지 알리고, 빨간불에서 바뀌면 바뀌었다고 알린다.
 * 잠깐 안 보였다 같은 상태로 다시 보이면 또 읽지 않는다. 횡단보도를 벗어나면 기록을 지운다.
 * - 플러그인이 다른 신호등을 고르면(번호가 바뀌면) 기록을 지운다. 옆 신호등의 초록불을 "빨간불이 바뀌었습니다"로 읽지 않는다.
 * - 옆 방향을 보면 읽지 않지만 기록은 둔다. 나침반이 잠깐 튀어도 기다리던 "빨간불이 바뀌었습니다"를 놓치거나
 *   "빨간불입니다"를 되풀이하지 않는다.
 * - 옆을 보다 돌아선 뒤 settleMs 동안은 읽지 않는다. 플러그인은 놓친 신호등의 상태를 잠깐 남겨 두므로,
 *   옆 신호등 상태를 첫 말로 읽지 않게 한다.
 */
export function signalReader(
    settings: CrossingFacingSettings = CROSSING_FACING,
): SignalReader {
    let told: PedSignal | null = null;
    let toldId: number | null = null;
    // 횡단보도 근처에서 마지막으로 옆 방향을 본 시각. 건너는 방향만 봤으면 null
    let awayAtMs: number | null = null;
    return (signal, atCrosswalk, view = {}) => {
        const { facing = true, signalId = 0, nowMs = 0 } = view;
        if (signalId !== toldId) {
            told = null;
            toldId = signalId;
        }
        if (!atCrosswalk) {
            told = null;
            awayAtMs = null;
            return null;
        }
        if (!facing) {
            awayAtMs = nowMs;
            return null;
        }
        if (awayAtMs !== null && nowMs - awayAtMs < settings.settleMs) {
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
    moveAside: 'vision-move-aside',
    crowded: 'vision-crowded',
    // 모두 막혔다는 말은 혼잡 알림을 읽은 직후라도 읽도록 따로 둔다.
    blocked: 'vision-blocked',
    waitingFront: 'vision-waiting-front',
    unknown: 'vision-unknown',
    failure: 'vision-failure',
    // 장애물은 클래스마다 따로 둔다(vision-obstacle-pole 등).
    obstacle: 'vision-obstacle',
    // 옆 진입은 왼쪽·오른쪽마다 따로 둔다(vision-side-entry-left 등).
    sideEntry: 'vision-side-entry',
    signal: 'vision-signal',
} as const;

/** 프레임을 보고 할 일. alert 는 알림 중재로 읽고, buzz 는 말 없이 짧게 진동한다. */
export type VisionCue = { kind: 'alert'; alert: Alert } | { kind: 'buzz' };

/**
 * 프레임 하나를 받아 할 일을 돌려준다. minLevel 보다 낮은 단계는 알리지 않는다.
 * waiting 은 신호를 기다리느라 서 있는지다. 서 있을 때 앞에 사람이 서면 붐빔·위험 대신 한 번만 알린다.
 */
export type VisionReader = (
    frame: VisionFrame,
    nowMs: number,
    minLevel: CrowdLevel,
    waiting?: boolean,
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
    // 서 있는 동안 앞에 사람이 있다고 이미 알렸는지. 사람이 사라지거나 다시 걸으면 지운다.
    let toldWaiting = false;
    // 판단 불가에서 벗어난 횟수. 알림 key 에 붙여, 벗어났다가 다시 판단 불가가 되면 새로 읽게 한다.
    let unknownEpisode = 0;

    // 서 있는 동안에는 앞에 사람이 서도 한 번만 알린다. 이어진 프레임이 모두 사람이 있는 단계여야 믿는다.
    const waitingCue = (
        frames: readonly VisionFrame[],
        minLevel: CrowdLevel,
    ): VisionCue | null => {
        if (frames.length < settings.confirmFrames) {
            return null;
        }
        if (frames.every((each) => each.level === 'clear')) {
            toldWaiting = false;
            return null;
        }
        const present = frames.every(
            (each) => each.level !== 'unknown' && atLeast(each.level, minLevel),
        );
        if (!present || toldWaiting) {
            return null;
        }
        toldWaiting = true;
        return alertCue({
            key: VISION_KEYS.waitingFront,
            level: 'crowd',
            text: WAITING_FRONT_TEXT,
            cooldownMs: 0,
        });
    };

    return (frame, nowMs, minLevel, waiting = false) => {
        recent = [...recent, frame].slice(-settings.confirmFrames);

        if (waiting) {
            dangerSince = null;
            return waitingCue(recent, minLevel);
        }
        toldWaiting = false;

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
        if (
            previous === 'unknown' &&
            steady !== undefined &&
            steady !== 'unknown'
        ) {
            unknownEpisode += 1;
        }

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
        // 판단 불가는 이어지는 동안 한 번만 읽고, 인식이 돌아왔다가 다시 판단 불가가 되면 또 읽는다.
        if (steady === 'unknown') {
            return alertCue({
                key: `${VISION_KEYS.unknown}-${unknownEpisode}`,
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
