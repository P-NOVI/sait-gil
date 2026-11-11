// 카메라 인파 인식 자리. 아직 연결하지 않았다.
//
// 앱에서는 Kotlin 플러그인(CameraX + LiteRT 로 YOLO26n)이 카메라를 돌리고,
// 사람 거리·밀집도·빈 방향 같은 추론 결과만 이 어댑터로 넘긴다(영상은 기기 밖으로 보내지 않는다).
// 모델 학습이 끝나면 startVision 을 플러그인 호출로 바꾼다. 화면은 VisionPanel 이 쓴다.

/** 밀집도 4단계: 여유, 주의, 혼잡, 위험 */
export type CrowdLevel = 'clear' | 'caution' | 'crowded' | 'danger';

/** 빈 공간을 알리는 시계 방향 (10시~2시 5방향) */
export type ClockDirection = 10 | 11 | 12 | 1 | 2;

/** 한 번 추론한 결과 */
export type VisionFrame = {
    level: CrowdLevel;
    /** 앞쪽에서 가장 가까운 사람까지 거리(m). 사람이 없으면 null */
    nearestPersonM: number | null;
    /** 지나갈 만한 빈 방향. 넓은 순 */
    freeDirections: ClockDirection[];
};

export const VISION_NOT_READY = '인파 인식은 준비 중입니다.';

/** 이 기기에서 인파 인식을 쓸 수 있는지. 플러그인을 붙이기 전까지는 false */
export function visionAvailable(): boolean {
    return false;
}

/**
 * 인파 인식을 시작하고 결과가 나올 때마다 onFrame 으로 알린다. 돌려준 함수를 부르면 멈춘다.
 * 지금은 플러그인이 없어 항상 실패한다.
 */
export async function startVision(
    onFrame: (frame: VisionFrame) => void,
): Promise<() => void> {
    void onFrame;
    throw new Error(VISION_NOT_READY);
}
