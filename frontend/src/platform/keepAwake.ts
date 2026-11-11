import { KeepAwake } from '@capacitor-community/keep-awake';
import { isNativeApp } from './runtime';

let webLock: WakeLockSentinel | null = null;

/** 길 안내 중 화면이 꺼지지 않게 한다. 지원하지 않으면 false. */
export async function keepScreenOn(): Promise<boolean> {
    if (isNativeApp()) {
        await KeepAwake.keepAwake();
        return true;
    }
    if (typeof navigator === 'undefined' || !('wakeLock' in navigator))
        return false;
    webLock = await navigator.wakeLock.request('screen');
    return true;
}

export async function allowScreenOff(): Promise<void> {
    if (isNativeApp()) {
        await KeepAwake.allowSleep();
        return;
    }
    await webLock?.release();
    webLock = null;
}
