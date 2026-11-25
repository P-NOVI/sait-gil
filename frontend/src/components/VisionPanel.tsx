import {
    type ClockDirection,
    VISION_NOT_READY,
    type VisionFailure,
    type VisionFrame,
    type VisionLevel,
} from '../platform';
import { distanceLabel } from '../lib/routeApi';
import {
    obstacleName,
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

function clockLabel(direction: ClockDirection): string {
    return `${direction}시`;
}

/** 가까운 사람, 빈 방향, 이 프레임에 보인 장애물. 음성 알림과 달리 여러 프레임 확인 없이 바로 보여 준다. */
function frameDetail(frame: VisionFrame): string {
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
    const obstacles =
        frame.obstacles.length > 0
            ? ` 앞 장애물: ${frame.obstacles
                  .map(
                      ({ kind, direction }) =>
                          `${clockLabel(direction)} ${obstacleName(kind)}`,
                  )
                  .join(', ')}.`
            : '';
    return `${nearest}${free}${obstacles}`;
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

/** 첫 줄(상태)과 둘째 줄(자세한 결과). 둘째 줄이 없으면 null */
function panelText(
    available: boolean,
    enabled: boolean,
    failure: VisionFailure | null,
    frame: VisionFrame | null,
): [string, string | null] {
    if (!available) {
        return [VISION_NOT_READY, null];
    }
    if (!enabled) {
        return [VISION_OFF_STATUS, null];
    }
    if (failure) {
        return [visionFailureText(failure), null];
    }
    return frame
        ? [`카메라 켜짐 · ${LEVEL_LABELS[frame.level]}`, frameDetail(frame)]
        : ['카메라 켜짐', VISION_NOT_READY];
}

/**
 * 길안내 화면의 카메라 인식 한 줄. 결과 문장은 화면에만 두고,
 * 음성 알림은 알림 중재를 거쳐 따로 읽는다. 인식을 쓸 수 있으면 끄고 켜는 버튼을 둔다.
 */
export default function VisionPanel({
    available,
    frame,
    enabled,
    failure,
    onToggle,
}: VisionPanelProps) {
    const [state, detail] = panelText(available, enabled, failure, frame);
    const level = enabled && !failure ? frame?.level : undefined;
    // 판단 불가는 화면에 보이지 않고 음성으로만 알린다.
    if (level === 'unknown') {
        return null;
    }
    return (
        <section className="vision" aria-label="카메라 인식" data-level={level}>
            <p className="vision__text">
                <span className="vision__state">{state}</span>
                {detail && <span className="vision__detail">{detail}</span>}
            </p>
            {available && (
                <button
                    type="button"
                    className="button vision__toggle"
                    onClick={onToggle}
                >
                    <span className="visually-hidden">카메라 인식 </span>
                    {enabled ? '끄기' : '켜기'}
                </button>
            )}
        </section>
    );
}
