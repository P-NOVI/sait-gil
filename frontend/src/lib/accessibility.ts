// 접근성 설정: 글자 크기, 음성 속도, 진동 세기, 인파 알림 민감도, 고대비.
// 안내 방식만 바꾸고 경로에는 영향을 주지 않는다. 기기 안에만 저장한다.

import type { CrowdLevel } from '../platform';

export type FontScale = 'normal' | 'large' | 'xlarge';
export type SpeechSpeed = 'slow' | 'normal' | 'fast' | 'faster';
export type VibrationStrength = 'off' | 'weak' | 'strong';
export type CrowdSensitivity = 'low' | 'normal' | 'high';

export type AccessibilitySettings = {
    fontScale: FontScale;
    speechSpeed: SpeechSpeed;
    vibration: VibrationStrength;
    crowdSensitivity: CrowdSensitivity;
    highContrast: boolean;
    /** 음성 안내. 끄면 진동과 화면 글자로만 알린다. */
    voice: boolean;
};

export const DEFAULT_ACCESSIBILITY: AccessibilitySettings = {
    fontScale: 'normal',
    speechSpeed: 'normal',
    vibration: 'strong',
    crowdSensitivity: 'normal',
    highContrast: false,
    voice: true,
};

/** 기본 글자 크기(18px)에 곱하는 배율 */
export const FONT_SCALES: Readonly<Record<FontScale, number>> = {
    normal: 1,
    large: 1.2,
    xlarge: 1.45,
};

/** 음성 속도 배율. 화면낭독기에 익숙한 사용자는 빠르게 듣는 경우가 많다. */
export const SPEECH_RATES: Readonly<Record<SpeechSpeed, number>> = {
    slow: 0.8,
    normal: 1,
    fast: 1.3,
    faster: 1.6,
};

/** 진동 시간에 곱하는 배율. 0 이면 진동하지 않는다. */
export const VIBRATION_SCALES: Readonly<Record<VibrationStrength, number>> = {
    off: 0,
    weak: 0.6,
    strong: 1.4,
};

/** 이 단계부터 인파 알림을 준다(카메라 인파 인식이 붙으면 쓴다). */
export const CROWD_ALERT_FROM: Readonly<Record<CrowdSensitivity, CrowdLevel>> =
    {
        low: 'danger',
        normal: 'crowded',
        high: 'caution',
    };

export const FONT_SCALE_LABELS: Readonly<Record<FontScale, string>> = {
    normal: '보통',
    large: '크게',
    xlarge: '아주 크게',
};

export const SPEECH_SPEED_LABELS: Readonly<Record<SpeechSpeed, string>> = {
    slow: '느리게',
    normal: '보통',
    fast: '빠르게',
    faster: '아주 빠르게',
};

export const VIBRATION_LABELS: Readonly<Record<VibrationStrength, string>> = {
    off: '끄기',
    weak: '약하게',
    strong: '강하게',
};

export const CROWD_SENSITIVITY_LABELS: Readonly<
    Record<CrowdSensitivity, string>
> = {
    low: '낮게 (위험할 때만)',
    normal: '보통 (혼잡부터)',
    high: '높게 (주의부터)',
};

function pick<T extends string>(
    value: unknown,
    options: Readonly<Record<T, unknown>>,
    fallback: T,
): T {
    return typeof value === 'string' && Object.hasOwn(options, value)
        ? (value as T)
        : fallback;
}

/** 저장해 둔 값. 모르는 값이나 빠진 값은 기본값으로 채운다. */
export function normalizeAccessibility(raw: unknown): AccessibilitySettings {
    const value = raw instanceof Object ? (raw as Record<string, unknown>) : {};
    const base = DEFAULT_ACCESSIBILITY;
    return {
        fontScale: pick(value.fontScale, FONT_SCALES, base.fontScale),
        speechSpeed: pick(value.speechSpeed, SPEECH_RATES, base.speechSpeed),
        vibration: pick(value.vibration, VIBRATION_SCALES, base.vibration),
        crowdSensitivity: pick(
            value.crowdSensitivity,
            CROWD_ALERT_FROM,
            base.crowdSensitivity,
        ),
        highContrast:
            typeof value.highContrast === 'boolean'
                ? value.highContrast
                : base.highContrast,
        voice: typeof value.voice === 'boolean' ? value.voice : base.voice,
    };
}

/** 진동 세기를 반영한 패턴. 끄면 빈 목록 */
export function scaledPattern(
    pattern: readonly number[],
    strength: VibrationStrength,
): number[] {
    const scale = VIBRATION_SCALES[strength];
    if (scale === 0) {
        return [];
    }
    // 멈춤(홀수 자리)은 그대로 두고 진동 시간만 바꾼다.
    return pattern.map((ms, index) =>
        index % 2 === 0 ? Math.round(ms * scale) : ms,
    );
}
