import { useId } from 'react';

import {
    type AccessibilitySettings,
    CROWD_SENSITIVITY_LABELS,
    FONT_SCALE_LABELS,
    SPEECH_SPEED_LABELS,
    VIBRATION_LABELS,
} from '../lib/accessibility';
import type { Place } from '../lib/placeApi';

type SettingsPanelProps = {
    settings: AccessibilitySettings;
    onChange: (change: Partial<AccessibilitySettings>) => void;
    onTry: () => void;
    home: Place | null;
    onSetHome: () => void;
    onClearHome: () => void;
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
        <fieldset className="settings__group">
            <legend>{legend}</legend>
            <div className="settings__choices">
                {(Object.keys(labels) as T[]).map((option) => (
                    <label key={option} className="settings__choice">
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

/** 설정: 집, 글자 크기, 음성, 진동, 인파 알림, 고대비. 이 기기에만 저장한다. */
export default function SettingsPanel({
    settings,
    onChange,
    onTry,
    home,
    onSetHome,
    onClearHome,
}: SettingsPanelProps) {
    const homeId = useId();
    return (
        <div className="settings">
            <section className="settings__group" aria-labelledby={homeId}>
                <h2 id={homeId} className="settings__heading">
                    집
                </h2>
                <p className="settings__home">
                    {home ? home.name : '등록한 집이 없습니다.'}
                </p>
                <div className="pair">
                    <button
                        type="button"
                        className="button"
                        onClick={onSetHome}
                    >
                        {home ? '집 바꾸기' : '집 등록하기'}
                    </button>
                    {home && (
                        <button
                            type="button"
                            className="button button--stop"
                            onClick={onClearHome}
                        >
                            집 지우기
                        </button>
                    )}
                </div>
            </section>
            <Choice
                name="font-scale"
                legend="글자 크기"
                labels={FONT_SCALE_LABELS}
                value={settings.fontScale}
                onChange={(fontScale) => onChange({ fontScale })}
            />
            <label className="settings__switch">
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
                className="button settings__try"
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
            <label className="settings__switch">
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
        </div>
    );
}
