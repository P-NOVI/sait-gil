import { beforeEach, describe, expect, it, vi } from 'vitest';

const native = vi.hoisted(() => ({ value: false }));
const plugin = vi.hoisted(() => ({
    requestPermissions: vi.fn(),
    getCurrentPosition: vi.fn(),
    watchPosition: vi.fn(),
    clearWatch: vi.fn(),
}));

vi.mock('@capacitor/core', () => ({
    Capacitor: { isNativePlatform: () => native.value },
}));
vi.mock('@capacitor/geolocation', () => ({ Geolocation: plugin }));

import { getCurrentPosition, LocationError, watchLocation } from './location';

const COORDS = { longitude: 126.97, latitude: 37.56, accuracy: 12 };
const FIX = { position: [126.97, 37.56], accuracy: 12 };

type Outcome = { coords: typeof COORDS } | { code: number };

/** 부를 때마다 outcomes 를 차례로 돌려주는 웹 geolocation */
function webGeolocation(...outcomes: Outcome[]) {
    const queue = [...outcomes];
    const fake = {
        getCurrentPosition: vi.fn(
            (
                success: (position: unknown) => void,
                failure: (e: unknown) => void,
            ) => {
                const next = queue.shift();
                if (next && 'coords' in next) {
                    success(next);
                } else {
                    failure(next);
                }
            },
        ),
        watchPosition: vi.fn<(success: (position: unknown) => void) => number>(
            () => 7,
        ),
        clearWatch: vi.fn(),
    };
    return { fake, geolocation: fake as unknown as Geolocation };
}

beforeEach(() => {
    native.value = false;
    vi.clearAllMocks();
});

describe('getCurrentPosition (웹)', () => {
    it('GPS 위치를 [경도, 위도] 로 돌려준다', async () => {
        const { geolocation } = webGeolocation({ coords: COORDS });

        expect(await getCurrentPosition(geolocation)).toEqual(FIX);
    });

    it('GPS 가 실패하면 대략적인 위치로 다시 묻는다', async () => {
        const { fake, geolocation } = webGeolocation(
            { code: 3 },
            { coords: COORDS },
        );

        expect(await getCurrentPosition(geolocation)).toEqual(FIX);
        expect(fake.getCurrentPosition).toHaveBeenCalledTimes(2);
    });

    it('권한이 없으면 다시 묻지 않고 권한 안내를 던진다', async () => {
        const { fake, geolocation } = webGeolocation({ code: 1 });

        await expect(getCurrentPosition(geolocation)).rejects.toThrow(
            '위치 권한',
        );
        expect(fake.getCurrentPosition).toHaveBeenCalledTimes(1);
    });

    it('위치 기능이 없으면 지원하지 않는다고 알린다', async () => {
        await expect(getCurrentPosition(undefined)).rejects.toBeInstanceOf(
            LocationError,
        );
    });
});

describe('getCurrentPosition (앱)', () => {
    it('권한을 거절하면 플러그인으로 위치를 묻지 않는다', async () => {
        native.value = true;
        plugin.requestPermissions.mockResolvedValue({ location: 'denied' });

        await expect(getCurrentPosition()).rejects.toThrow('위치 권한');
        expect(plugin.getCurrentPosition).not.toHaveBeenCalled();
    });

    it('정확한 위치가 실패하면 대략적인 위치로 다시 묻는다', async () => {
        native.value = true;
        plugin.requestPermissions.mockResolvedValue({ location: 'granted' });
        plugin.getCurrentPosition
            .mockRejectedValueOnce(new Error('timeout'))
            .mockResolvedValueOnce({ coords: COORDS });

        expect(await getCurrentPosition()).toEqual(FIX);
        expect(plugin.getCurrentPosition).toHaveBeenCalledTimes(2);
    });
});

describe('watchLocation (웹)', () => {
    it('위치마다 onFix 를 부르고, 멈추면 watch 를 지운다', () => {
        const { fake, geolocation } = webGeolocation();
        const onFix = vi.fn();

        const stop = watchLocation(onFix, vi.fn(), geolocation);
        fake.watchPosition.mock.calls[0][0]({ coords: COORDS });
        stop();

        expect(onFix).toHaveBeenCalledWith(FIX);
        expect(fake.clearWatch).toHaveBeenCalledWith(7);
    });
});
