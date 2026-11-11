import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const native = vi.hoisted(() => ({ value: false }));
const plugins = vi.hoisted(() => ({
    tts: { speak: vi.fn(), stop: vi.fn() },
    haptics: { vibrate: vi.fn() },
    stt: { available: vi.fn(), requestPermissions: vi.fn(), start: vi.fn() },
    keepAwake: { keepAwake: vi.fn(), allowSleep: vi.fn() },
}));

vi.mock('@capacitor/core', () => ({
    Capacitor: { isNativePlatform: () => native.value },
}));
vi.mock('@capacitor-community/text-to-speech', () => ({
    TextToSpeech: plugins.tts,
}));
vi.mock('@capacitor/haptics', () => ({ Haptics: plugins.haptics }));
vi.mock('@capacitor-community/speech-recognition', () => ({
    SpeechRecognition: plugins.stt,
}));
vi.mock('@capacitor-community/keep-awake', () => ({
    KeepAwake: plugins.keepAwake,
}));

import { keepScreenOn, listenOnce, speak, vibrate } from './index';

beforeEach(() => {
    native.value = false;
    vi.clearAllMocks();
});

afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
});

describe('speak', () => {
    it('앱에서는 TTS 플러그인으로 한국어를 읽는다', async () => {
        native.value = true;

        await speak('앞이 붐빕니다', { rate: 1.2 });

        expect(plugins.tts.speak).toHaveBeenCalledWith({
            text: '앞이 붐빕니다',
            lang: 'ko-KR',
            rate: 1.2,
        });
    });

    it('웹에서는 읽던 문장을 끊고 speechSynthesis로 읽는다', async () => {
        const synth = { cancel: vi.fn(), speak: vi.fn() };
        vi.stubGlobal('speechSynthesis', synth);
        vi.stubGlobal(
            'SpeechSynthesisUtterance',
            class {
                lang = '';
                rate = 1;
                text: string;
                constructor(text: string) {
                    this.text = text;
                }
            },
        );

        await speak('멈추세요');

        expect(synth.cancel).toHaveBeenCalled();
        expect(synth.speak.mock.calls[0][0]).toMatchObject({
            text: '멈추세요',
            lang: 'ko-KR',
        });
    });
});

describe('vibrate', () => {
    it('웹에서 진동을 지원하지 않으면 false를 돌려준다', async () => {
        vi.stubGlobal('navigator', {});

        expect(await vibrate([200])).toBe(false);
    });

    it('앱에서는 패턴의 진동 구간만 플러그인으로 울린다', async () => {
        native.value = true;
        vi.useFakeTimers();

        const done = vibrate([300, 100, 500]);
        await vi.runAllTimersAsync();

        expect(await done).toBe(true);
        expect(plugins.haptics.vibrate.mock.calls).toEqual([
            [{ duration: 300 }],
            [{ duration: 500 }],
        ]);
    });
});

describe('listenOnce', () => {
    it('앱에서 마이크 권한이 없으면 null을 돌려준다', async () => {
        native.value = true;
        plugins.stt.available.mockResolvedValue({ available: true });
        plugins.stt.requestPermissions.mockResolvedValue({
            speechRecognition: 'denied',
        });

        expect(await listenOnce()).toBeNull();
        expect(plugins.stt.start).not.toHaveBeenCalled();
    });

    it('웹에서 인식한 첫 문장을 돌려준다', async () => {
        vi.stubGlobal(
            'webkitSpeechRecognition',
            class {
                lang = '';
                interimResults = true;
                maxAlternatives = 5;
                onresult: ((event: unknown) => void) | null = null;
                onerror: (() => void) | null = null;
                onend: (() => void) | null = null;
                start() {
                    this.onresult?.({
                        results: [[{ transcript: '한강 축제 가 줘' }]],
                    });
                    this.onend?.();
                }
            },
        );

        expect(await listenOnce()).toBe('한강 축제 가 줘');
    });

    it('웹에서 음성 인식을 지원하지 않으면 null을 돌려준다', async () => {
        expect(await listenOnce()).toBeNull();
    });
});

describe('keepScreenOn', () => {
    it('웹에서 Wake Lock을 지원하지 않으면 false를 돌려준다', async () => {
        vi.stubGlobal('navigator', {});

        expect(await keepScreenOn()).toBe(false);
    });
});
