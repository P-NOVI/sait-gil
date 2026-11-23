// GPS 속력을 차의 움직임을 잴 때 뺄 걸음 속도로 바꾼다.
// 걸음 속도가 실제보다 크게 들어가면 서 있는 차가 멀어지는 차로 잡혀 알리지 않으므로, 믿기 어려운 값은 0 으로 본다.

import type { LocationFix } from '../platform';
import { VISION, type VisionSettings } from '../settings';

/**
 * 걸음 속도(m/s). 멈춰 있어 속력이 안 오면 0 이다.
 * 위치가 없거나 위치 오차가 커 속력을 믿을 수 없으면 null(모름)이다. 0(멈춤)으로 두면 걸어가는 중에도 걸음을 못 빼기 때문이다.
 * 속력이 걸음으로 볼 수 없을 만큼 크면(차를 탔거나 GPS 가 튐) 상한으로 자른다.
 */
export function walkSpeedOf(
    fix: LocationFix | null,
    settings: VisionSettings = VISION,
): number | null {
    if (!fix || fix.accuracy > settings.walkSpeedMaxAccuracyM) {
        return null;
    }
    if (!fix.course) {
        return 0;
    }
    return Math.min(Math.max(fix.course.speed, 0), settings.walkSpeedMaxMps);
}
