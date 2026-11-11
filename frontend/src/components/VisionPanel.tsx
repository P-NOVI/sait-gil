import {
    type ClockDirection,
    type CrowdLevel,
    VISION_NOT_READY,
    type VisionFrame,
} from '../platform';
import { distanceLabel } from '../lib/routeApi';

const LEVEL_LABELS: Record<CrowdLevel, string> = {
    clear: '여유',
    caution: '주의',
    crowded: '혼잡',
    danger: '위험',
};

const LEVELS: CrowdLevel[] = ['clear', 'caution', 'crowded', 'danger'];

function clockLabel(direction: ClockDirection): string {
    return `${direction}시`;
}

type VisionPanelProps = {
    available: boolean;
    frame: VisionFrame | null;
};

/**
 * 카메라 인파 인식 결과 자리. 모델(YOLO26n)과 Kotlin 플러그인이 붙기 전에는 준비 중으로 보인다.
 * 결과 문장은 화면에만 두고, 음성 알림은 알림 중재를 거쳐 따로 읽는다.
 */
export default function VisionPanel({ available, frame }: VisionPanelProps) {
    const level = frame?.level ?? null;
    return (
        <section
            className="vision-panel"
            aria-labelledby="vision-title"
            data-level={level ?? undefined}
        >
            <h3 id="vision-title" className="vision-panel__title">
                앞쪽 인파
            </h3>
            <ol className="vision-panel__meter" aria-hidden="true">
                {LEVELS.map((step) => (
                    <li
                        key={step}
                        data-on={
                            level !== null &&
                            LEVELS.indexOf(step) <= LEVELS.indexOf(level)
                                ? true
                                : undefined
                        }
                    >
                        {LEVEL_LABELS[step]}
                    </li>
                ))}
            </ol>
            {!available || !frame ? (
                <p className="vision-panel__status">{VISION_NOT_READY}</p>
            ) : (
                <p className="vision-panel__status">
                    {LEVEL_LABELS[frame.level]}.{' '}
                    {frame.nearestPersonM !== null &&
                        `가장 가까운 사람 ${distanceLabel(frame.nearestPersonM)}. `}
                    {frame.freeDirections.length > 0
                        ? `${frame.freeDirections.map(clockLabel).join(', ')} 방향이 비어 있습니다.`
                        : '비어 있는 방향이 없습니다.'}
                </p>
            )}
        </section>
    );
}
