import {
    type AccessibilitySettings,
    CROWD_SENSITIVITY_LABELS,
    FONT_SCALE_LABELS,
    SPEECH_SPEED_LABELS,
    VIBRATION_LABELS,
} from '../lib/accessibility';

type SettingsPanelProps = {
    settings: AccessibilitySettings;
    onChange: (change: Partial<AccessibilitySettings>) => void;
    onTry: () => void;
};

type ChoiceProps<T extends string> = {
    name: string;
    legend: string;
    labels: Readonly<Record<T, string>>;
    value: T;
    onChange: (value: T) => void;
};

/** 라디오 버튼 묶음. 화면낭독기는 "n개 중 m번째"로 읽는다. */
function Choice<T extends string>({
    name,
    legend,
    labels,
    value,
    onChange,
}: ChoiceProps<T>) {
    return (
        <fieldset className="settings-panel__group">
            <legend>{legend}</legend>
            <div className="settings-panel__choices">
                {(Object.keys(labels) as T[]).map((option) => (
                    <label key={option} className="settings-panel__choice">
                        <input
                            type="radio"
                            name={name}
                            value={option}
                            checked={value === option}
                            onChange={() => onChange(option)}
                        />
                        <span>{labels[option]}</span>
                    </label>
                ))}
            </div>
        </fieldset>
    );
}

/** 접근성 설정: 글자 크기, 음성, 진동, 인파 알림, 고대비. 이 기기에만 저장한다. */
export default function SettingsPanel({
    settings,
    onChange,
    onTry,
}: SettingsPanelProps) {
    return (
        <div className="settings-panel">
            <Choice
                name="font-scale"
                legend="글자 크기"
                labels={FONT_SCALE_LABELS}
                value={settings.fontScale}
                onChange={(fontScale) => onChange({ fontScale })}
            />
            <label className="settings-panel__switch">
                <span>음성 안내</span>
                <input
                    type="checkbox"
                    role="switch"
                    checked={settings.voice}
                    onChange={(event) =>
                        onChange({ voice: event.target.checked })
                    }
                />
            </label>
            <Choice
                name="speech-speed"
                legend="음성 속도"
                labels={SPEECH_SPEED_LABELS}
                value={settings.speechSpeed}
                onChange={(speechSpeed) => onChange({ speechSpeed })}
            />
            <Choice
                name="vibration"
                legend="진동 세기"
                labels={VIBRATION_LABELS}
                value={settings.vibration}
                onChange={(vibration) => onChange({ vibration })}
            />
            <button
                type="button"
                className="settings-panel__try"
                onClick={onTry}
            >
                음성·진동 들어보기
            </button>
            <Choice
                name="crowd-sensitivity"
                legend="인파 알림"
                labels={CROWD_SENSITIVITY_LABELS}
                value={settings.crowdSensitivity}
                onChange={(crowdSensitivity) => onChange({ crowdSensitivity })}
            />
            <label className="settings-panel__switch">
                <span>고대비 화면</span>
                <input
                    type="checkbox"
                    role="switch"
                    checked={settings.highContrast}
                    onChange={(event) =>
                        onChange({ highContrast: event.target.checked })
                    }
                />
            </label>
            <p className="settings-panel__note">
                설정은 이 기기에만 저장합니다. 경로는 바뀌지 않고 안내 방식만
                바뀝니다.
            </p>
        </div>
    );
}
