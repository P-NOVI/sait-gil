// GPS 속력을 차의 움직임을 잴 때 뺄 걸음 속도로 바꾼다.
// 걸음 속도가 실제보다 크게 들어가면 서 있는 차가 멀어지는 차로 잡혀 알리지 않으므로, 믿기 어려운 값은 0 으로 본다.

import type { LocationFix } from '../platform';
import { VISION, type VisionSettings } from '../settings';

/**
 * 서 있는지. 속력(speedMps)이 waitingSpeedMps 보다 느리면 서 있는 것이다.
 * 멈춰 있으면 속력이 아예 안 올 수도 있어 속력이 없어도 서 있는 것으로 본다. 위치가 없으면 모른다(false).
 * 방향 없이 속력만 와도 속력으로 본다(진행 방향(course)이 없다고 서 있는 것이 아니다).
 */
export function isStandingStill(
    fix: LocationFix | null,
    settings: VisionSettings = VISION,
): boolean {
    if (!fix) {
        return false;
    }
    return (
        fix.speedMps === undefined || fix.speedMps < settings.waitingSpeedMps
    );
}

/**
 * 걸음 속도(m/s). 속력(speedMps)이 오면 그 값이다. 기기가 속력 0 을 주면 멈춤(0)이다.
 * 위치가 없거나 위치 오차가 커 속력을 믿을 수 없거나 속력이 안 오면 null(모름)이다.
 * 0(멈춤)으로 두면 걷는 중에도 걸음을 못 빼기 때문이다. 방향이 없어도 속력은 쓴다.
 * 속력이 걸음으로 볼 수 없을 만큼 크면(차를 탔거나 GPS 가 튐) 상한으로 자른다.
 */
export function walkSpeedOf(
    fix: LocationFix | null,
    settings: VisionSettings = VISION,
): number | null {
    if (!fix || fix.accuracy > settings.walkSpeedMaxAccuracyM) {
        return null;
    }
    if (fix.speedMps === undefined) {
        return null;
    }
    return Math.min(Math.max(fix.speedMps, 0), settings.walkSpeedMaxMps);
}
