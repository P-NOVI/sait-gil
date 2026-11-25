// 알림 중재: 여러 알림이 한꺼번에 생기면 무엇을 먼저 읽을지 정한다.
// 우선순위는 위험(비전) > 경로(회전·시설물) > 혼잡이다.

import { ALERT_COOLDOWN_MS } from '../settings';

export type AlertLevel = 'danger' | 'route' | 'crowd';

export type Alert = {
    /** 같은 알림이면 같은 key. 쿨다운과 한 번만 읽기에 쓴다. */
    key: string;
    level: AlertLevel;
    text: string;
    /** 이 알림만 따로 쓰는 쿨다운(ms). 없으면 단계별 쿨다운 */
    cooldownMs?: number;
    /** false 면 말만 하고 진동하지 않는다. 없으면 단계별 진동 */
    vibrate?: boolean;
};

const PRIORITY: Record<AlertLevel, number> = {
    danger: 3,
    route: 2,
    crowd: 1,
};

/**
 * 지금 읽을 알림 하나. 우선순위가 높은 것, 같으면 먼저 들어온 것을 고른다.
 * 같은 key 를 쿨다운 안에 다시 읽지 않는다. spokenAt 은 key 별 마지막으로 읽은 시각(ms)이다.
 */
export function pickAlert(
    pending: readonly Alert[],
    spokenAt: ReadonlyMap<string, number>,
    nowMs: number,
    cooldownMs: Readonly<Record<AlertLevel, number>> = ALERT_COOLDOWN_MS,
): Alert | null {
    let best: Alert | null = null;
    for (const alert of pending) {
        const last = spokenAt.get(alert.key);
        const wait = alert.cooldownMs ?? cooldownMs[alert.level];
        if (last !== undefined && nowMs - last < wait) {
            continue;
        }
        if (!best || PRIORITY[alert.level] > PRIORITY[best.level]) {
            best = alert;
        }
    }
    return best;
}

/** 읽는 중인 current 단계의 말을 끊고 next 단계 알림을 바로 읽어야 하는지. 더 높은 단계만 끊는다. */
export function shouldInterrupt(
    current: AlertLevel,
    next: AlertLevel,
): boolean {
    return PRIORITY[next] > PRIORITY[current];
}

/**
 * 읽던 말을 끊지 못할 때 할 일. wait 는 끝날 때까지 기다리고, drop 은 버린다(곧 다시 알릴 때).
 * maxWaitMs 를 주면 그만큼만 기다리고 더 늦어지면 버린다(늦게 읽으면 소용없는 알림).
 */
export type WhenBusy = 'wait' | 'drop' | { maxWaitMs: number };

/** 알린 지 waitedMs 가 지난 지금도 읽을 만한지. 기다림에 한도가 있는 알림만 한도를 넘으면 버린다. */
export function stillTimely(whenBusy: WhenBusy, waitedMs: number): boolean {
    return typeof whenBusy !== 'object' || waitedMs <= whenBusy.maxWaitMs;
}
