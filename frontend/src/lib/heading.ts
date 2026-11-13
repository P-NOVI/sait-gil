// 지도 위 내 위치 마커가 가리킬 방향. 북쪽 0도, 시계 방향(동쪽 90도).
// 나침반을 기본으로 쓰고, 걷는 중에는 GPS 진행 방향과의 차이를 배워 나침반을 바로잡는다.

import { HEADING } from '../settings';

/** GPS 가 알려 준 진행 방향(도)과 속력(m/s). 걷는 중에만 온다. */
export type Course = { heading: number; speed: number };

export type HeadingSettings = typeof HEADING;

const FULL_TURN = 360;
const HALF_TURN = 180;

/** 0 이상 360 미만으로 */
export function normalizeDegrees(degrees: number): number {
    return ((degrees % FULL_TURN) + FULL_TURN) % FULL_TURN;
}

/** from 에서 to 로 가장 짧게 도는 각도. -180 초과 180 이하, 시계 방향이 + */
export function angleDiff(from: number, to: number): number {
    const diff = normalizeDegrees(to - from);
    return diff > HALF_TURN ? diff - FULL_TURN : diff;
}

/** previous 에서 next 쪽으로 factor(0~1)만큼만 움직인다. 나침반 떨림을 줄인다. */
export function smoothAngle(
    previous: number,
    next: number,
    factor: number,
): number {
    return normalizeDegrees(previous + angleDiff(previous, next) * factor);
}

/** deviceorientation 이벤트에서 쓰는 값 */
export type OrientationReading = {
    alpha: number | null;
    absolute: boolean;
    /** iOS Safari 만 준다. 이미 북쪽 기준 시계 방향이다. */
    webkitCompassHeading?: number;
};

/**
 * 기기 방향 센서 값을 화면 위쪽이 가리키는 나침반 방향으로 바꾼다.
 * 북쪽 기준이 아닌 값(absolute 가 아닌 alpha)이면 null.
 * screenAngle 은 화면 회전(가로 모드 90 등)이다.
 */
export function compassFromOrientation(
    reading: OrientationReading,
    screenAngle: number,
): number | null {
    if (typeof reading.webkitCompassHeading === 'number') {
        return normalizeDegrees(reading.webkitCompassHeading + screenAngle);
    }
    if (reading.absolute && reading.alpha !== null) {
        // alpha 는 반시계 방향이라 뒤집는다.
        return normalizeDegrees(FULL_TURN - reading.alpha + screenAngle);
    }
    return null;
}

function isWalking(
    course: Course | null,
    settings: HeadingSettings,
): course is Course {
    return course !== null && course.speed >= settings.minWalkSpeedMps;
}

/**
 * 걷는 중이면 나침반과 GPS 진행 방향의 차이(보정값)를 조금씩 배운다.
 * 쇠붙이·자기 편차로 나침반이 한쪽으로 쏠린 만큼을 바로잡는다.
 */
export function learnOffset(
    offset: number,
    compass: number | null,
    course: Course | null,
    settings: HeadingSettings = HEADING,
): number {
    if (compass === null || !isWalking(course, settings)) {
        return offset;
    }
    const target = angleDiff(compass, course.heading);
    return offset + angleDiff(offset, target) * settings.offsetLearnRate;
}

/**
 * 마커가 가리킬 방향. 나침반이 있으면 보정값을 더하고,
 * 나침반이 없으면 걷는 중에만 GPS 진행 방향을 쓴다. 둘 다 없으면 null.
 */
export function displayHeading(
    compass: number | null,
    offset: number,
    course: Course | null,
    settings: HeadingSettings = HEADING,
): number | null {
    if (compass !== null) {
        return normalizeDegrees(compass + offset);
    }
    return isWalking(course, settings)
        ? normalizeDegrees(course.heading)
        : null;
}
