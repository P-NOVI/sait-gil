import { TextToSpeech } from '@capacitor-community/text-to-speech';
import { isNativeApp, SPEECH_LANG } from './runtime';

export interface SpeakOptions {
    rate?: number;
}

// 읽고 있는 문장. 참조가 없으면 Chrome 이 끝 이벤트를 놓치는 일이 있어 붙잡아 둔다.
let speaking: SpeechSynthesisUtterance | null = null;

/** 읽는다. 다 읽거나 다른 문장에 끊기면 끝난다. 묻고 들을 때 다 읽기를 기다린다. */
export async function speak(
    text: string,
    { rate = 1 }: SpeakOptions = {},
): Promise<void> {
    if (isNativeApp()) {
        await TextToSpeech.speak({ text, lang: SPEECH_LANG, rate });
        return;
    }
    if (!('speechSynthesis' in globalThis)) return;
    speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = SPEECH_LANG;
    utterance.rate = rate;
    speaking = utterance;
    await new Promise<void>((resolve) => {
        utterance.onend = () => resolve();
        utterance.onerror = () => resolve();
        speechSynthesis.speak(utterance);
    });
    if (speaking === utterance) {
        speaking = null;
    }
}

export async function stopSpeaking(): Promise<void> {
    if (isNativeApp()) {
        await TextToSpeech.stop();
        return;
    }
    if ('speechSynthesis' in globalThis) speechSynthesis.cancel();
}
