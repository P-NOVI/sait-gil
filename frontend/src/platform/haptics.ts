import { Haptics } from '@capacitor/haptics';
import { isNativeApp } from './runtime';

/** 진동 패턴은 [진동, 멈춤, 진동, …] 밀리초 목록이다. */
export async function vibrate(pattern: number[]): Promise<boolean> {
    if (isNativeApp()) {
        for (const [index, duration] of pattern.entries()) {
            if (index % 2 === 0) await Haptics.vibrate({ duration });
            await wait(duration);
        }
        return true;
    }
    if (typeof navigator === 'undefined' || !('vibrate' in navigator))
        return false;
    return navigator.vibrate(pattern);
}

function wait(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}
