// 음성 명령을 듣는 동안 블루투스 이어폰 마이크로 받기.
// Android 음성 인식기는 마이크를 고르지 않아, 앱에서는 Kotlin 플러그인 SaitgilAudio 로 통화용 연결(SCO)을 켠다.
// 웹(브라우저)에서는 브라우저가 고른 마이크를 그대로 쓴다.

import { registerPlugin } from '@capacitor/core';

import { BLUETOOTH_MIC_CONNECT_MS } from '../settings';
import { isNativeApp } from './runtime';

type SaitgilAudioPlugin = {
    /** 블루투스 이어폰 마이크로 바꾼다. 이어폰이 없거나 timeoutMs 안에 연결되지 않으면 connected 가 false 다. */
    startBluetoothMic(options: {
        timeoutMs: number;
    }): Promise<{ connected: boolean }>;
    /** 원래 마이크로 되돌린다. */
    stopBluetoothMic(): Promise<void>;
};

let plugin: SaitgilAudioPlugin | null = null;

const audio = () =>
    (plugin ??= registerPlugin<SaitgilAudioPlugin>('SaitgilAudio'));

/** 블루투스 이어폰 마이크로 바꿨으면 true. 못 바꾸면 폰 마이크로 듣도록 false 를 돌려준다. */
export async function startBluetoothMic(): Promise<boolean> {
    if (!isNativeApp()) return false;
    try {
        const { connected } = await audio().startBluetoothMic({
            timeoutMs: BLUETOOTH_MIC_CONNECT_MS,
        });
        return connected;
    } catch {
        return false;
    }
}

/** 원래 마이크로 되돌린다. 되돌리지 못해도 듣기는 끝낸다. */
export async function stopBluetoothMic(): Promise<void> {
    if (!isNativeApp()) return;
    try {
        await audio().stopBluetoothMic();
    } catch {
        // 플러그인이 없는 빌드 등. 켠 적도 없으니 되돌릴 것이 없다.
    }
}
