// 플러그인 없이 인파 알림을 확인하는 웹 mock. 단계를 정해진 순서대로 되풀이해 흘린다.

import type { VisionApproach, VisionFrame } from './vision';

// 한 프레임 간격(ms). 플러그인도 1초에 몇 번씩 결과를 낸다.
const FRAME_INTERVAL_MS = 500;
// 단계마다 같은 프레임을 이만큼 연달아 보낸다. 여러 프레임 확인을 지나도록 넉넉히 둔다.
const FRAMES_PER_STEP = 12;

/** 한 단계. approach 가 있으면 그 단계에 들어설 때 정면 접근을 한 번 보낸다. */
type MockStep = { frame: VisionFrame; approach?: VisionApproach };

const SCRIPT: readonly MockStep[] = [
    {
        frame: {
            level: 'clear',
            nearestPersonM: null,
            freeDirections: [11, 12, 1],
        },
    },
    { frame: { level: 'caution', nearestPersonM: 6, freeDirections: [12, 1] } },
    // 같이 걷던 앞사람이 멈춰 빠르게 가까워진다.
    {
        frame: {
            level: 'caution',
            nearestPersonM: 2.5,
            freeDirections: [1, 2],
        },
        approach: { distanceM: 2.5, freeDirections: [1, 2] },
    },
    { frame: { level: 'crowded', nearestPersonM: 3, freeDirections: [11] } },
    { frame: { level: 'crowded', nearestPersonM: 2.5, freeDirections: [] } },
    { frame: { level: 'danger', nearestPersonM: 0.8, freeDirections: [] } },
    { frame: { level: 'unknown', nearestPersonM: null, freeDirections: [] } },
];

export function startMockVision(
    onFrame: (frame: VisionFrame) => void,
    onApproach: (approach: VisionApproach) => void = () => undefined,
): () => void {
    let count = 0;
    const timer = setInterval(() => {
        const index = Math.floor(count / FRAMES_PER_STEP) % SCRIPT.length;
        const step = SCRIPT[index];
        const entering = count % FRAMES_PER_STEP === 0;
        count += 1;
        onFrame(step.frame);
        if (entering && step.approach) {
            onApproach(step.approach);
        }
    }, FRAME_INTERVAL_MS);
    return () => clearInterval(timer);
}
