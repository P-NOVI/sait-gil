import { useCallback } from 'react';

import {
    type AccessibilitySettings,
    scaledPattern,
    SPEECH_RATES,
} from '../lib/accessibility';
import type { AlertLevel } from '../lib/alertArbiter';
import { speak, stopSpeaking, vibrate } from '../platform';
import { VIBRATION_PATTERNS } from '../settings';

/**
 * 음성·진동으로 알린다. 접근성 설정의 음성 속도·진동 세기를 따르고,
 * 음성 안내를 껐으면 진동만 한다.
 */
export function useAnnouncer(settings: AccessibilitySettings) {
    const { voice, speechSpeed, vibration } = settings;

    const announce = useCallback(
        (text: string, level?: AlertLevel) => {
            if (level) {
                const pattern = scaledPattern(
                    VIBRATION_PATTERNS[level],
                    vibration,
                );
                if (pattern.length > 0) {
                    void vibrate(pattern);
                }
            }
            if (voice) {
                void speak(text, { rate: SPEECH_RATES[speechSpeed] });
            }
        },
        [voice, speechSpeed, vibration],
    );

    const silence = useCallback(() => {
        void stopSpeaking();
    }, []);

    return { announce, silence };
}
