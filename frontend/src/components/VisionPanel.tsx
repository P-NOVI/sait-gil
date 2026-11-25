type VisionPanelProps = {
    available: boolean;
    /** 사용자가 카메라 인식을 켜 두었는지 */
    enabled: boolean;
    onToggle: () => void;
};

/**
 * 길안내 화면의 카메라 인식 끄고 켜는 버튼. 인식 결과와 켜지 못한 이유는 화면에 두지 않고
 * 알림 중재를 거쳐 음성으로만 읽는다. 화면낭독기로 넘겨 가며 들을 글을 줄인다.
 */
export default function VisionPanel({
    available,
    enabled,
    onToggle,
}: VisionPanelProps) {
    if (!available) {
        return null;
    }
    return (
        <button type="button" className="button" onClick={onToggle}>
            {enabled ? '카메라 끄기' : '카메라 켜기'}
        </button>
    );
}
