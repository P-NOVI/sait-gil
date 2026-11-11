import { TextToSpeech } from '@capacitor-community/text-to-speech';
import { isNativeApp, SPEECH_LANG } from './runtime';

export interface SpeakOptions {
    rate?: number;
}

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
    speechSynthesis.speak(utterance);
}

export async function stopSpeaking(): Promise<void> {
    if (isNativeApp()) {
        await TextToSpeech.stop();
        return;
    }
    if ('speechSynthesis' in globalThis) speechSynthesis.cancel();
}
