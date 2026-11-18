// 플러그인 없이 인파 알림을 확인하는 웹 mock. 단계를 정해진 순서대로 되풀이해 흘린다.

import type { VisionFrame } from './vision';

// 한 프레임 간격(ms). 플러그인도 1초에 몇 번씩 결과를 낸다.
const FRAME_INTERVAL_MS = 500;
// 단계마다 같은 프레임을 이만큼 연달아 보낸다. 여러 프레임 확인을 지나도록 넉넉히 둔다.
const FRAMES_PER_STEP = 12;

const SCRIPT: readonly VisionFrame[] = [
    { level: 'clear', nearestPersonM: null, freeDirections: [11, 12, 1] },
    { level: 'caution', nearestPersonM: 6, freeDirections: [12, 1] },
    { level: 'crowded', nearestPersonM: 3, freeDirections: [11] },
    { level: 'crowded', nearestPersonM: 2.5, freeDirections: [] },
    { level: 'danger', nearestPersonM: 0.8, freeDirections: [] },
    { level: 'unknown', nearestPersonM: null, freeDirections: [] },
];

export function startMockVision(
    onFrame: (frame: VisionFrame) => void,
): () => void {
    let count = 0;
    const timer = setInterval(() => {
        const step = Math.floor(count / FRAMES_PER_STEP) % SCRIPT.length;
        count += 1;
        onFrame(SCRIPT[step]);
    }, FRAME_INTERVAL_MS);
    return () => clearInterval(timer);
}
