// 사잇길 앱 설정 화면. 위치 권한을 다시 묻지 못하게 막혀 있으면 사용자가 직접 켜도록 연다.
// 앱에서는 Kotlin 플러그인 SaitgilSettings 를 쓰고, 웹(브라우저)에서는 열 수 없다.

import { registerPlugin } from '@capacitor/core';

import { isNativeApp } from './runtime';

type SaitgilSettingsPlugin = {
    openAppSettings(): Promise<void>;
};

let plugin: SaitgilSettingsPlugin | null = null;

/** 앱 설정 화면을 열 수 있는지. 브라우저에서는 열 수 없다. */
export function canOpenAppSettings(): boolean {
    return isNativeApp();
}

/** 앱 설정 화면(권한)을 열고, 사용자가 앱으로 돌아오면 끝난다. */
export async function openAppSettings(): Promise<void> {
    plugin ??= registerPlugin<SaitgilSettingsPlugin>('SaitgilSettings');
    // 설정 화면이 열리면 앱이 가려지고(hidden), 돌아오면 다시 보인다(visible).
    let onChange: () => void = () => undefined;
    const back = new Promise<void>((resolve) => {
        onChange = () => {
            if (document.visibilityState === 'visible') {
                resolve();
            }
        };
        document.addEventListener('visibilitychange', onChange);
    });
    try {
        await plugin.openAppSettings();
        await back;
    } finally {
        document.removeEventListener('visibilitychange', onChange);
    }
}
