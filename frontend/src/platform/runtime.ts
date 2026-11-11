import { Capacitor } from '@capacitor/core';

export const SPEECH_LANG = 'ko-KR';

export function isNativeApp(): boolean {
    return Capacitor.isNativePlatform();
}
