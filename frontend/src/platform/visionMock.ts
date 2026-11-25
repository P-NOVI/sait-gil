// 플러그인 없이 인파·장애물·신호등 알림을 확인하는 웹 mock. 단계를 정해진 순서대로 되풀이해 흘린다.

import type {
    VisionApproach,
    VisionFrame,
    VisionObstacle,
    VisionSideEntry,
} from './vision';

// 한 프레임 간격(ms). 플러그인도 1초에 몇 번씩 결과를 낸다.
const FRAME_INTERVAL_MS = 500;
// 단계마다 같은 프레임을 이만큼 연달아 보낸다. 여러 프레임 확인을 지나도록 넉넉히 둔다.
const FRAMES_PER_STEP = 12;

/**
 * 한 단계. approach·obstacle 이 있으면 그 단계에 들어설 때 정면 접근·장애물을 한 번 보낸다.
 * obstacle 은 그 단계 동안 프레임마다 화면용 장애물(obstacles)로도 보낸다.
 * 신호등은 길안내 중 횡단보도 근처에서만 읽는다.
 */
type MockStep = {
    frame: Omit<VisionFrame, 'obstacles' | 'signalId'>;
    approach?: VisionApproach;
    obstacle?: VisionObstacle;
    sideEntry?: VisionSideEntry;
};

const SCRIPT: readonly MockStep[] = [
    {
        frame: {
            level: 'clear',
            nearestPersonM: null,
            freeDirections: [11, 12, 1],
            signal: null,
        },
    },
    {
        frame: {
            level: 'caution',
            nearestPersonM: 6,
            freeDirections: [12, 1],
            signal: null,
        },
    },
    // 같이 걷던 앞사람이 멈춰 빠르게 가까워진다.
    {
        frame: {
            level: 'caution',
            nearestPersonM: 2.5,
            freeDirections: [1, 2],
            signal: null,
        },
        approach: { distanceM: 2.5, freeDirections: [1, 2] },
    },
    // 왼쪽에서 가까운 사람이 들어온다.
    {
        frame: {
            level: 'caution',
            nearestPersonM: 1.2,
            freeDirections: [12, 1, 2],
            signal: null,
        },
        sideEntry: { side: 'left' },
    },
    {
        frame: {
            level: 'crowded',
            nearestPersonM: 3,
            freeDirections: [11],
            signal: null,
        },
    },
    {
        frame: {
            level: 'crowded',
            nearestPersonM: 2.5,
            freeDirections: [],
            signal: null,
        },
    },
    {
        frame: {
            level: 'danger',
            nearestPersonM: 0.8,
            freeDirections: [],
            signal: null,
        },
    },
    {
        frame: {
            level: 'unknown',
            nearestPersonM: null,
            freeDirections: [],
            signal: null,
        },
    },
    // 앞에 기둥이 있고, 횡단보도 앞에서 빨간불이 바뀐다.
    {
        frame: {
            level: 'clear',
            nearestPersonM: null,
            freeDirections: [11, 12, 1],
            signal: null,
        },
        obstacle: { kind: 'pole', direction: 12 },
    },
    {
        frame: {
            level: 'clear',
            nearestPersonM: null,
            freeDirections: [11, 12, 1],
            signal: 'red',
        },
    },
    {
        frame: {
            level: 'clear',
            nearestPersonM: null,
            freeDirections: [11, 12, 1],
            signal: 'other',
        },
    },
];

export function startMockVision(
    onFrame: (frame: VisionFrame) => void,
    onApproach: (approach: VisionApproach) => void = () => undefined,
    onObstacle: (obstacle: VisionObstacle) => void = () => undefined,
    onSideEntry: (entry: VisionSideEntry) => void = () => undefined,
): () => void {
    let count = 0;
    const timer = setInterval(() => {
        const index = Math.floor(count / FRAMES_PER_STEP) % SCRIPT.length;
        const step = SCRIPT[index];
        const entering = count % FRAMES_PER_STEP === 0;
        count += 1;
        // 장애물 알림을 보내는 단계는 그 장애물이 화면에도 보이게 한다.
        onFrame({
            ...step.frame,
            signalId: 0,
            obstacles: step.obstacle ? [step.obstacle] : [],
        });
        if (entering && step.approach) {
            onApproach(step.approach);
        }
        if (entering && step.obstacle) {
            onObstacle(step.obstacle);
        }
        if (entering && step.sideEntry) {
            onSideEntry(step.sideEntry);
        }
    }, FRAME_INTERVAL_MS);
    return () => clearInterval(timer);
}
