// 알림 중재: 여러 알림이 한꺼번에 생기면 무엇을 먼저 읽을지 정한다.
// 우선순위는 위험(비전) > 경로(회전·시설물) > 혼잡이다.

import { ALERT_COOLDOWN_MS } from '../settings';

export type AlertLevel = 'danger' | 'route' | 'crowd';

export type Alert = {
    /** 같은 알림이면 같은 key. 쿨다운과 한 번만 읽기에 쓴다. */
    key: string;
    level: AlertLevel;
    text: string;
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
        if (last !== undefined && nowMs - last < cooldownMs[alert.level]) {
            continue;
        }
        if (!best || PRIORITY[alert.level] > PRIORITY[best.level]) {
            best = alert;
        }
    }
    return best;
}

/** 읽는 중인 알림을 끊고 next 를 바로 읽어야 하는지. 더 높은 단계만 끊는다. */
export function shouldInterrupt(current: Alert | null, next: Alert): boolean {
    return current !== null && PRIORITY[next.level] > PRIORITY[current.level];
}
