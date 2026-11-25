// 앱을 처음 열 때 묻는 권한. 각 기능을 켜지 않고 권한만 묻는다.
// Android 는 권한 창을 하나씩만 띄우므로 permissionQueue 로 차례를 지킨다.

import { requestMicPermission } from './listen';
import { requestLocationPermission } from './location';
import { requestStepsPermission } from './steps';
import { requestCameraPermission } from './vision';

export type AppPermission = 'location' | 'microphone' | 'camera' | 'steps';

const REQUESTS: Readonly<Record<AppPermission, () => Promise<boolean>>> = {
    location: requestLocationPermission,
    microphone: requestMicPermission,
    camera: requestCameraPermission,
    steps: requestStepsPermission,
};

/** kind 권한을 묻는다. 허용하면 true, 거절했거나 쓸 수 없으면 false */
export function requestAppPermission(kind: AppPermission): Promise<boolean> {
    return REQUESTS[kind]();
}
