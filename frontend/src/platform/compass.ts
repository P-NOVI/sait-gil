// 나침반(기기 방향 센서). 웹과 앱(Android WebView) 모두 deviceorientation 이벤트를 쓴다.
// 북쪽 기준 값(deviceorientationabsolute)이 있으면 그것을, 없으면 iOS 의 webkitCompassHeading 을 쓴다.

import {
    compassFromOrientation,
    type OrientationReading,
} from '../lib/heading';

type PermissionRequest = () => Promise<'granted' | 'denied'>;

function screenAngle(): number {
    return globalThis.screen?.orientation?.angle ?? 0;
}

/**
 * 나침반 방향(북쪽 0도, 시계 방향)이 바뀔 때마다 onHeading 으로 알린다.
 * 센서가 없는 기기에서는 아무것도 하지 않는다. 돌려준 함수를 부르면 멈춘다.
 */
export function watchCompass(onHeading: (degrees: number) => void): () => void {
    if (!('DeviceOrientationEvent' in globalThis)) {
        return () => undefined;
    }
    const type =
        'ondeviceorientationabsolute' in globalThis
            ? 'deviceorientationabsolute'
            : 'deviceorientation';
    const handle = (event: Event) => {
        const heading = compassFromOrientation(
            event as unknown as OrientationReading,
            screenAngle(),
        );
        if (heading !== null) {
            onHeading(heading);
        }
    };
    globalThis.addEventListener(type, handle);
    return () => globalThis.removeEventListener(type, handle);
}

/**
 * iOS 는 버튼을 누른 순간에 권한을 물어야 나침반 값이 온다. 버튼 클릭에서 바로 부른다.
 * 묻지 않아도 되는 기기(Android 등)는 true.
 */
export async function requestCompassPermission(): Promise<boolean> {
    // 메서드를 떼어 부르면 iOS 가 막으므로 DeviceOrientationEvent 에서 바로 부른다.
    const orientation = (
        globalThis as {
            DeviceOrientationEvent?: { requestPermission?: PermissionRequest };
        }
    ).DeviceOrientationEvent;
    if (!orientation?.requestPermission) {
        return true;
    }
    try {
        return (await orientation.requestPermission()) === 'granted';
    } catch {
        return false;
    }
}
