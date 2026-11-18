// 카메라 인파 인식 결과를 알림으로 바꾼다. 읽을지는 알림 중재(위험 > 경로 > 혼잡)가 정한다.
// 한 프레임 튀는 것은 넘기도록 같은 결과가 몇 프레임 이어질 때만 믿는다.

import type {
    ClockDirection,
    CrowdLevel,
    VisionFrame,
    VisionLevel,
} from '../platform';
import { VISION, type VisionSettings } from '../settings';
import type { Alert } from './alertArbiter';

export const DANGER_TEXT = '멈추세요. 바로 앞에 사람이 있습니다.';
export const MOVE_ASIDE_TEXT = '멈추고 길 가장자리로 비켜 서세요.';
export const CROWDED_TEXT = '앞이 붐빕니다. 속도를 줄이세요.';
export const BLOCKED_TEXT = '앞이 붐빕니다. 잠시 멈춰 기다리세요.';
export const UNKNOWN_TEXT = '주변을 인식할 수 없습니다.';

export function freeDirectionText(direction: ClockDirection): string {
    return `앞이 붐빕니다. ${direction}시 방향이 비어 있습니다.`;
}

export const VISION_KEYS = {
    danger: 'vision-danger',
    moveAside: 'vision-move-aside',
    crowded: 'vision-crowded',
    // 모두 막혀 멈추라는 말은 혼잡 알림을 읽은 직후라도 읽도록 따로 둔다.
    blocked: 'vision-blocked',
    unknown: 'vision-unknown',
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
