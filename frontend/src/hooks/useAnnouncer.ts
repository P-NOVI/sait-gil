import { useCallback, useRef, useState } from 'react';

import {
    type AccessibilitySettings,
    scaledPattern,
    SPEECH_RATES,
} from '../lib/accessibility';
import type { AlertLevel } from '../lib/alertArbiter';
import { speakingTracker } from '../lib/speaking';
import {
    canListen,
    listenOnce,
    speak,
    stopListening,
    stopSpeaking,
    vibrate,
} from '../platform';
import {
    LISTEN_START_DELAY_MS,
    SPEECH_BUSY_MAX_MS,
    VIBRATION_PATTERNS,
} from '../settings';

/**
 * ask 의 결과. heard: 알아들은 말, silent: 들었지만 대답이 없음,
 * interrupted: 다른 말이 끼어듦, unavailable: 음성 안내를 껐거나 듣는 기능이 없음.
 */
export type Answer =
    | { status: 'heard'; text: string }
    | { status: 'silent' }
    | { status: 'interrupted' }
    | { status: 'unavailable' };

/**
 * 들으려 했는데 대답이 없었거나 알아듣지 못할 말이 왔는지.
 * 끼어들었거나 들을 수 없었으면 못 알아들었다고 말하지 않는다.
 */
export function listened(answer: Answer): boolean {
    return answer.status === 'heard' || answer.status === 'silent';
}

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
    // 읽고 있는 말의 단계. 안내 중 알림은 이것보다 높은 단계일 때만 끊고 읽는다.
    const [speaking] = useState(speakingTracker);

    const interrupt = useCallback(() => {
        turn.current += 1;
        speaking.clear();
        stopListening();
        setListening(false);
    }, [speaking]);

    /** 다 읽을 때까지 level 의 말을 읽는 중으로 둔다. 단계 없는 말은 경로 안내와 같게 본다. */
    const say = useCallback(
        async (text: string, level: AlertLevel = 'route') => {
            const done = speaking.start(level);
            const timer = setTimeout(done, SPEECH_BUSY_MAX_MS);
            await speak(text, { rate: SPEECH_RATES[speechSpeed] }).catch(
                () => undefined,
            );
            clearTimeout(timer);
            done();
        },
        [speaking, speechSpeed],
    );

    /** 말 없이 진동만 한다. 진동 세기 설정을 따른다. */
    const buzz = useCallback(
        (pattern: readonly number[]) => {
            const scaled = scaledPattern(pattern, vibration);
            if (scaled.length > 0) {
                void vibrate(scaled);
            }
        },
        [vibration],
    );

    const announce = useCallback(
        (text: string, level?: AlertLevel) => {
            interrupt();
            if (level) {
                buzz(VIBRATION_PATTERNS[level]);
            }
            if (voice) {
                void say(text, level);
            }
        },
        [buzz, interrupt, say, voice],
    );

    /**
     * 읽고 나서 마이크를 켜 대답을 듣는다.
     * 음성 안내를 끈 사람(화면낭독기 사용자)에게는 묻지 않는다.
     */
    const ask = useCallback(
        async (text: string): Promise<Answer> => {
            if (!voice) {
                return { status: 'unavailable' };
            }
            interrupt();
            const mine = turn.current;
            await say(text);
            if (turn.current !== mine) {
                return { status: 'interrupted' };
            }
            if (!canListen()) {
                return { status: 'unavailable' };
            }
            await new Promise((resolve) =>
                setTimeout(resolve, LISTEN_START_DELAY_MS),
            );
            if (turn.current !== mine) {
                return { status: 'interrupted' };
            }
            setListening(true);
            const heard = await listenOnce().catch(() => null);
            if (turn.current !== mine) {
                return { status: 'interrupted' };
            }
            setListening(false);
            return heard
                ? { status: 'heard', text: heard }
                : { status: 'silent' };
        },
        [interrupt, say, voice],
    );

    /** 말을 모두 멈춘다. 읽으려고 기다리던 알림도 버린다. */
    const silence = useCallback(() => {
        speaking.stop();
        interrupt();
        void stopSpeaking();
    }, [interrupt, speaking]);

    return {
        announce,
        ask,
        buzz,
        silence,
        listening,
        busyFor: speaking.busyFor,
        whenIdle: speaking.whenIdle,
    };
}
