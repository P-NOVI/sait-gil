import { useCallback, useRef, useState } from 'react';

import {
    type AccessibilitySettings,
    scaledPattern,
    SPEECH_RATES,
} from '../lib/accessibility';
import type { AlertLevel } from '../lib/alertArbiter';
import {
    canListen,
    listenOnce,
    speak,
    stopListening,
    stopSpeaking,
    vibrate,
} from '../platform';
import { VIBRATION_PATTERNS } from '../settings';

/**
 * 음성·진동으로 알린다. 접근성 설정의 음성 속도·진동 세기를 따르고,
 * 음성 안내를 껐으면 진동만 한다.
 * ask 는 묻고 나서 마이크를 켜 대답을 듣는다.
 */
export function useAnnouncer(settings: AccessibilitySettings) {
    const { voice, speechSpeed, vibration } = settings;
    const [listening, setListening] = useState(false);
    // 말할 때마다 늘린다. 묻고 듣는 사이에 다른 말이 끼어들면 그 대답은 버린다.
    const turn = useRef(0);

    const interrupt = useCallback(() => {
        turn.current += 1;
        stopListening();
        setListening(false);
    }, []);

    const announce = useCallback(
        (text: string, level?: AlertLevel) => {
            interrupt();
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
        [interrupt, voice, speechSpeed, vibration],
    );

    /**
     * 읽고 나서 마이크를 켜 대답을 듣고, 알아들은 말을 돌려준다.
     * 음성 안내를 껐거나, 듣는 기능이 없거나, 다른 말이 끼어들었거나, 대답이 없으면 null.
     * 음성 안내를 끈 사람(화면낭독기 사용자)에게는 묻지 않는다.
     */
    const ask = useCallback(
        async (text: string): Promise<string | null> => {
            if (!voice) {
                return null;
            }
            interrupt();
            const mine = turn.current;
            await speak(text, { rate: SPEECH_RATES[speechSpeed] }).catch(
                () => undefined,
            );
            if (turn.current !== mine || !canListen()) {
                return null;
            }
            setListening(true);
            const heard = await listenOnce().catch(() => null);
            if (turn.current !== mine) {
                return null;
            }
            setListening(false);
            return heard;
        },
        [interrupt, voice, speechSpeed],
    );

    const silence = useCallback(() => {
        interrupt();
        void stopSpeaking();
    }, [interrupt]);

    return { announce, ask, silence, listening };
}
