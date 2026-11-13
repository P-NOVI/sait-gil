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
    abort(): void;
}

type WebRecognitionConstructor = new () => WebRecognition;

function webRecognition(): WebRecognitionConstructor | undefined {
    const scope = globalThis as {
        SpeechRecognition?: WebRecognitionConstructor;
        webkitSpeechRecognition?: WebRecognitionConstructor;
    };
    return scope.SpeechRecognition ?? scope.webkitSpeechRecognition;
}

// 지금 듣고 있는 것을 멈추는 함수. 듣고 있지 않으면 null
let stopCurrent: (() => void) | null = null;

/** 이 기기에서 말을 알아들을 수 있는지 */
export function canListen(): boolean {
    return isNativeApp() || webRecognition() !== undefined;
}

/** 듣고 있으면 멈춘다. 멈춘 listenOnce 는 null 을 돌려준다. */
export function stopListening(): void {
    const stop = stopCurrent;
    stopCurrent = null;
    stop?.();
}

async function listenNative(): Promise<string | null> {
    const { available } = await NativeRecognition.available();
    if (!available) return null;
    const permission = await NativeRecognition.requestPermissions();
    if (permission.speechRecognition !== 'granted') return null;
    let stopped = false;
    const stop = () => {
        stopped = true;
        void NativeRecognition.stop();
    };
    stopCurrent = stop;
    try {
        const { matches } = await NativeRecognition.start({
            language: SPEECH_LANG,
            maxResults: 1,
            partialResults: false,
            popup: false,
        });
        return stopped ? null : (matches?.[0] ?? null);
    } finally {
        if (stopCurrent === stop) stopCurrent = null;
    }
}

function listenWeb(Recognition: WebRecognitionConstructor) {
    return new Promise<string | null>((resolve) => {
        const recognition = new Recognition();
        recognition.lang = SPEECH_LANG;
        recognition.interimResults = false;
        recognition.maxAlternatives = 1;
        let transcript: string | null = null;
        const stop = () => {
            transcript = null;
            recognition.abort();
        };
        const finish = (heard: string | null) => {
            if (stopCurrent === stop) stopCurrent = null;
            resolve(heard);
        };
        recognition.onresult = (event) => {
            transcript = event.results[0]?.[0]?.transcript ?? null;
        };
        recognition.onerror = () => finish(null);
        recognition.onend = () => finish(transcript);
        stopCurrent = stop;
        try {
            recognition.start();
        } catch {
            // 마이크 권한이 없거나 이미 듣는 중이면 바로 던진다.
            finish(null);
        }
    });
}

/** 한 번 말한 내용을 글자로 돌려준다. 인식할 수 없거나 멈추면 null. 듣던 것은 멈춘다. */
export async function listenOnce(): Promise<string | null> {
    stopListening();
    if (isNativeApp()) {
        return listenNative();
    }
    const Recognition = webRecognition();
    return Recognition ? listenWeb(Recognition) : null;
}
