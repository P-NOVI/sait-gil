// 현재 위치. 웹은 navigator.geolocation, 앱은 Capacitor Geolocation 플러그인을 쓴다.
// 좌표는 저장하지 않고 요청한 곳에만 돌려준다. 배리어프리 lib/geolocation.ts 에서 가져왔다.

import { Geolocation, type Position } from '@capacitor/geolocation';

import type { LngLat } from '../lib/geo';
import type { Course } from '../lib/heading';
import { isNativeApp } from './runtime';

// 정확한 위치(GPS)를 먼저 기다리고, 실패하면 Wi-Fi·기지국 기반 위치로 다시 묻는다.
const PRECISE: PositionOptions = { enableHighAccuracy: true, timeout: 10_000 };
const COARSE: PositionOptions = {
    enableHighAccuracy: false,
    timeout: 10_000,
    maximumAge: 60_000,
};
// 안내 중에는 GPS 위치를 계속 받는다. 다음 위치가 늦어도 오류로 끊지 않는다.
const WATCH: PositionOptions = { enableHighAccuracy: true, maximumAge: 0 };

// GeolocationPositionError 코드
const PERMISSION_DENIED = 1;

/** 찾은 위치 */
export type LocationFix = {
    position: LngLat;
    /** 오차 반경(m). 실제 위치는 이 원 안에 있을 가능성이 높다. */
    accuracy: number;
    /** GPS 진행 방향·속력. 움직일 때만 온다. */
    course?: Course;
    /** 앱에서 대략적인 위치만 허용해 받은 위치. 오차가 커 경로 이탈·도착을 판단하지 못한다. */
    approximate?: true;
};

export class LocationError extends Error {
    constructor(message: string) {
        super(message);
        this.name = 'LocationError';
    }
}

const UNSUPPORTED = '이 기기는 위치 찾기를 지원하지 않습니다.';
const DENIED =
    '위치 권한이 꺼져 있습니다. 설정에서 사잇길의 위치 권한을 허용하세요.';
/** 대략적인 위치만 허용했을 때 안내 중 한 번 읽는 말 */
export const APPROXIMATE_TEXT =
    '정확한 위치를 허용해야 길안내를 할 수 있습니다. 설정에서 사잇길의 정확한 위치 사용을 켜세요.';
const FAILED =
    '현재 위치를 찾지 못했습니다. 잠시 뒤 다시 시도하거나 밖으로 나가 보세요.';

type Coords = {
    longitude: number;
    latitude: number;
    accuracy: number;
    // 멈춰 있으면 웹은 NaN, 앱은 null 을 준다.
    heading?: number | null;
    speed?: number | null;
};

const isNumber = (value: number | null | undefined): value is number =>
    typeof value === 'number' && Number.isFinite(value);

function toFix(coords: Coords): LocationFix {
    const fix: LocationFix = {
        position: [coords.longitude, coords.latitude],
        accuracy: coords.accuracy,
    };
    if (isNumber(coords.heading) && isNumber(coords.speed)) {
        fix.course = { heading: coords.heading, speed: coords.speed };
    }
    return fix;
}

/** 앱에서 받은 위치. 정확한 위치를 허용하지 않았으면 대략적인 위치로 표시한다. */
function toNativeFix(coords: Coords, precise: boolean): LocationFix {
    return precise ? toFix(coords) : { ...toFix(coords), approximate: true };
}

function isPermissionDenied(error: unknown): boolean {
    return (
        error instanceof Object &&
        'code' in error &&
        error.code === PERMISSION_DENIED
    );
}

function toLocationError(error: unknown): LocationError {
    return new LocationError(isPermissionDenied(error) ? DENIED : FAILED);
}

function locateWeb(
    geolocation: Geolocation,
    options: PositionOptions,
): Promise<LocationFix> {
    return new Promise((resolve, reject) =>
        geolocation.getCurrentPosition(
            (position) => resolve(toFix(position.coords)),
            reject,
            options,
        ),
    );
}

/** 정확한 위치 허용 여부. Android 12+의 대략적인 위치만 허용한 경우도 사용할 수 있다. */
async function ensureNativePermission(): Promise<boolean> {
    const { location, coarseLocation } = await Geolocation.requestPermissions();
    if (location !== 'granted' && coarseLocation !== 'granted') {
        throw new LocationError(DENIED);
    }
    return location === 'granted';
}

async function currentNative(): Promise<LocationFix> {
    const precise = await ensureNativePermission();
    for (const options of precise ? [PRECISE, COARSE] : [COARSE]) {
        try {
            const position: Position =
                await Geolocation.getCurrentPosition(options);
            return toNativeFix(position.coords, precise);
        } catch {
            // 정확한 위치가 실패하면 대략적인 위치로 다시 묻는다.
        }
    }
    throw new LocationError(FAILED);
}

async function currentWeb(geolocation: Geolocation): Promise<LocationFix> {
    try {
        return await locateWeb(geolocation, PRECISE);
    } catch (error) {
        // 권한이 없으면 다시 물어도 같은 결과라 바로 알린다.
        if (isPermissionDenied(error)) {
            throw toLocationError(error);
        }
    }
    try {
        return await locateWeb(geolocation, COARSE);
    } catch (error) {
        throw toLocationError(error);
    }
}

export async function getCurrentPosition(
    geolocation: Geolocation | undefined = globalThis.navigator?.geolocation,
): Promise<LocationFix> {
    if (isNativeApp()) {
        // 기기 위치가 꺼져 있으면 플러그인이 영어 원문으로 실패하므로 안내 문장으로 바꾼다.
        return currentNative().catch((error: unknown) => {
            throw error instanceof LocationError
                ? error
                : toLocationError(error);
        });
    }
    if (!geolocation) {
        throw new LocationError(UNSUPPORTED);
    }
    return currentWeb(geolocation);
}

/**
 * 위치가 바뀔 때마다 onFix 로 알린다. 돌려준 함수를 부르면 멈춘다.
 * 위치를 잠시 못 받아도 멈추지 않고, 다음 위치가 오면 다시 onFix 를 부른다.
 */
export function watchLocation(
    onFix: (fix: LocationFix) => void,
    onError: (error: LocationError) => void,
    geolocation: Geolocation | undefined = globalThis.navigator?.geolocation,
): () => void {
    if (isNativeApp()) {
        let stopped = false;
        let id: string | null = null;
        ensureNativePermission()
            .then((precise) =>
                Geolocation.watchPosition(
                    { ...WATCH, enableHighAccuracy: precise },
                    (position, error) => {
                        if (position) {
                            onFix(toNativeFix(position.coords, precise));
                        } else if (error) {
                            onError(toLocationError(error));
                        }
                    },
                ),
            )
            .then((watchId) => {
                id = watchId;
                if (stopped) {
                    void Geolocation.clearWatch({ id: watchId });
                }
            })
            .catch((error: unknown) =>
                onError(
                    error instanceof LocationError
                        ? error
                        : toLocationError(error),
                ),
            );
        return () => {
            stopped = true;
            if (id) {
                void Geolocation.clearWatch({ id });
            }
        };
    }
    if (!geolocation) {
        onError(new LocationError(UNSUPPORTED));
        return () => undefined;
    }
    const id = geolocation.watchPosition(
        (position) => onFix(toFix(position.coords)),
        (error) => onError(toLocationError(error)),
        WATCH,
    );
    return () => geolocation.clearWatch(id);
}
