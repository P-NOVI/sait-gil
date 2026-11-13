import { useCallback, useEffect, useRef, useState } from 'react';

import {
    angleDiff,
    type Course,
    displayHeading,
    learnOffset,
    smoothAngle,
} from '../lib/heading';
import { watchCompass } from '../platform';
import { HEADING } from '../settings';

/**
 * 내 위치 마커가 가리킬 방향(북쪽 0도, 시계 방향). 모르면 null.
 * 나침반을 기본으로 쓰고, course(GPS 진행 방향)가 오면 나침반 보정값을 배운다.
 */
export function useHeading(course: Course | null): number | null {
    const [heading, setHeading] = useState<number | null>(null);
    const compass = useRef<number | null>(null);
    const offset = useRef(0);
    const latestCourse = useRef<Course | null>(null);
    const shown = useRef<number | null>(null);

    const show = useCallback(() => {
        const next = displayHeading(
            compass.current,
            offset.current,
            latestCourse.current,
        );
        const previous = shown.current;
        if (next === previous) {
            return;
        }
        // 조금씩 떨리는 값으로 지도를 계속 다시 그리지 않는다.
        if (
            next !== null &&
            previous !== null &&
            Math.abs(angleDiff(previous, next)) < HEADING.minStepDeg
        ) {
            return;
        }
        shown.current = next;
        setHeading(next);
    }, []);

    useEffect(
        () =>
            watchCompass((degrees) => {
                compass.current =
                    compass.current === null
                        ? degrees
                        : smoothAngle(
                              compass.current,
                              degrees,
                              HEADING.smoothing,
                          );
                show();
            }),
        [show],
    );

    useEffect(() => {
        latestCourse.current = course;
        offset.current = learnOffset(offset.current, compass.current, course);
        show();
    }, [course, show]);

    return heading;
}
