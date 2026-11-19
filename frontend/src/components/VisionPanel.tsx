import {
    type ClockDirection,
    type CrowdLevel,
    VISION_NOT_READY,
    type VisionFailure,
    type VisionFrame,
    type VisionLevel,
} from '../platform';
import { distanceLabel } from '../lib/routeApi';
import {
    UNKNOWN_TEXT,
    VISION_OFF_STATUS,
    visionFailureText,
} from '../lib/visionAlerts';

const LEVEL_LABELS: Record<VisionLevel, string> = {
    clear: '여유',
    caution: '주의',
    crowded: '혼잡',
    danger: '위험',
    unknown: '판단 불가',
};

const LEVELS: CrowdLevel[] = ['clear', 'caution', 'crowded', 'danger'];

/** 미터에서 켜 둘 칸 수. 판단 불가는 모두 끈다. */
function meterSteps(level: VisionLevel | null): number {
    return level === null || level === 'unknown'
        ? 0
        : LEVELS.indexOf(level) + 1;
}

function statusText(frame: VisionFrame): string {
    if (frame.level === 'unknown') {
        return UNKNOWN_TEXT;
    }
    const nearest =
        frame.nearestPersonM !== null
            ? `가장 가까운 사람 ${distanceLabel(frame.nearestPersonM)}. `
            : '';
    const free =
        frame.freeDirections.length > 0
            ? `${frame.freeDirections.map(clockLabel).join(', ')} 방향이 비어 있습니다.`
            : '비어 있는 방향이 없습니다.';
    return `${nearest}${free}`;
}

function clockLabel(direction: ClockDirection): string {
    return `${direction}시`;
}

type VisionPanelProps = {
    available: boolean;
    frame: VisionFrame | null;
    /** 사용자가 카메라 인식을 켜 두었는지 */
    enabled: boolean;
    /** 카메라를 켜지 못한 이유. 없으면 null */
    failure: VisionFailure | null;
    onToggle: () => void;
};

/** 결과 자리에 보일 문장 */
function panelStatus(
    available: boolean,
    enabled: boolean,
    failure: VisionFailure | null,
    frame: VisionFrame | null,
): string {
    if (!available) {
        return VISION_NOT_READY;
    }
    if (!enabled) {
        return VISION_OFF_STATUS;
    }
    if (failure) {
        return visionFailureText(failure);
    }
    return frame
        ? `${LEVEL_LABELS[frame.level]}. ${statusText(frame)}`
        : VISION_NOT_READY;
}

/**
 * 카메라 인파 인식 결과 자리. 모델(YOLO26n)과 Kotlin 플러그인이 붙기 전에는 준비 중으로 보인다.
 * 결과 문장은 화면에만 두고, 음성 알림은 알림 중재를 거쳐 따로 읽는다.
 * 인식을 쓸 수 있으면 카메라 인식을 끄고 켜는 버튼을 둔다.
 */
export default function VisionPanel({
    available,
    frame,
    enabled,
    failure,
    onToggle,
}: VisionPanelProps) {
    const level = enabled ? (frame?.level ?? null) : null;
    const lit = meterSteps(level);
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
                        data-on={LEVELS.indexOf(step) < lit ? true : undefined}
                    >
                        {LEVEL_LABELS[step]}
                    </li>
                ))}
            </ol>
            <p className="vision-panel__status">
                {panelStatus(available, enabled, failure, frame)}
            </p>
            {available && (
                <button
                    type="button"
                    className="vision-panel__toggle"
                    aria-pressed={enabled}
                    onClick={onToggle}
                >
                    {/* 상태는 aria-pressed 와 위 문장이 알려 글자는 고정한다. 화면낭독기가 두 번 읽지 않게 한다. */}
                    카메라 인식
                </button>
            )}
        </section>
    );
}
