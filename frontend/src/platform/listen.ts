import { SpeechRecognition as NativeRecognition } from '@capacitor-community/speech-recognition';
import { isNativeApp, SPEECH_LANG } from './runtime';

interface WebRecognitionResult {
    results: ArrayLike<ArrayLike<{ transcript: string }>>;
}

interface WebRecognition {
    lang: string;
    interimResults: boolean;
    maxAlternatives: number;
    onresult: ((event: WebRecognitionResult) => void) | null;
    onerror: (() => void) | null;
    onend: (() => void) | null;
    start(): void;
}

type WebRecognitionConstructor = new () => WebRecognition;

function webRecognition(): WebRecognitionConstructor | undefined {
    const scope = globalThis as {
        SpeechRecognition?: WebRecognitionConstructor;
        webkitSpeechRecognition?: WebRecognitionConstructor;
    };
    return scope.SpeechRecognition ?? scope.webkitSpeechRecognition;
}

/** 한 번 말한 내용을 글자로 돌려준다. 인식할 수 없으면 null. */
export async function listenOnce(): Promise<string | null> {
    if (isNativeApp()) {
        const { available } = await NativeRecognition.available();
        if (!available) return null;
        const permission = await NativeRecognition.requestPermissions();
        if (permission.speechRecognition !== 'granted') return null;
        const { matches } = await NativeRecognition.start({
            language: SPEECH_LANG,
            maxResults: 1,
            partialResults: false,
            popup: false,
        });
        return matches?.[0] ?? null;
    }

    const Recognition = webRecognition();
    if (!Recognition) return null;
    return new Promise((resolve) => {
        const recognition = new Recognition();
        recognition.lang = SPEECH_LANG;
        recognition.interimResults = false;
        recognition.maxAlternatives = 1;
        let transcript: string | null = null;
        recognition.onresult = (event) => {
            transcript = event.results[0]?.[0]?.transcript ?? null;
        };
        recognition.onerror = () => resolve(null);
        recognition.onend = () => resolve(transcript);
        recognition.start();
    });
}
