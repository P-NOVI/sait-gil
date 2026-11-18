// 카메라 인파 인식. 앱에 플러그인이 붙기 전에는 웹 mock 만 쓸 수 있다.
//
// 앱에서는 Kotlin 플러그인(CameraX + LiteRT 로 YOLO26n)이 카메라를 돌리고,
// 사람 거리·밀집도·빈 방향 같은 추론 결과만 이 어댑터로 넘긴다(영상은 기기 밖으로 보내지 않는다).
// 모델 학습이 끝나면 startVision 을 플러그인 호출로 바꾼다. 화면은 VisionPanel 이 쓴다.

import { startMockVision } from './visionMock';

/** 밀집도 4단계: 여유, 주의, 혼잡, 위험 */
export type CrowdLevel = 'clear' | 'caution' | 'crowded' | 'danger';

/** 인식한 단계. 어둡거나 가려져 사람을 셀 수 없으면 unknown(판단 불가) */
export type VisionLevel = CrowdLevel | 'unknown';

/** 빈 공간을 알리는 시계 방향 (10시~2시 5방향) */
export type ClockDirection = 10 | 11 | 12 | 1 | 2;

/** 한 번 추론한 결과 */
export type VisionFrame = {
    level: VisionLevel;
    /** 앞쪽에서 가장 가까운 사람까지 거리(m). 사람이 없으면 null */
    nearestPersonM: number | null;
    /** 지나갈 만한 빈 방향. 넓은 순 */
    freeDirections: ClockDirection[];
};

export const VISION_NOT_READY = '인파 인식은 준비 중입니다.';

/** 웹에서 mock 인식을 켰는지. 플러그인 없이 알림을 확인할 때 .env 에 VITE_VISION_MOCK=true 를 둔다. */
function mockEnabled(): boolean {
    return import.meta.env.VITE_VISION_MOCK === 'true';
}

/** 이 기기에서 인파 인식을 쓸 수 있는지. 플러그인을 붙이기 전까지는 mock 을 켰을 때만 true */
export function visionAvailable(): boolean {
    return mockEnabled();
}

/**
 * 인파 인식을 시작하고 결과가 나올 때마다 onFrame 으로 알린다. 돌려준 함수를 부르면 멈춘다.
 * 플러그인이 없어 mock 을 켜지 않았으면 실패한다.
 */
export async function startVision(
    onFrame: (frame: VisionFrame) => void,
): Promise<() => void> {
    if (mockEnabled()) {
        return startMockVision(onFrame);
    }
    throw new Error(VISION_NOT_READY);
}
