import { afterEach, describe, expect, it, vi } from 'vitest';

const native = vi.hoisted(() => ({ value: false }));
const plugin = vi.hoisted(() => ({ openAppSettings: vi.fn() }));

vi.mock('@capacitor/core', () => ({
    Capacitor: { isNativePlatform: () => native.value },
    registerPlugin: () => plugin,
}));

import { canOpenAppSettings, openAppSettings } from './appSettings';

/** 보이는지 바꿀 수 있는 document. 바꾸면 visibilitychange 를 보낸다. */
function fakeDocument() {
    const fake = Object.assign(new EventTarget(), {
        visibilityState: 'visible',
    });
    vi.stubGlobal('document', fake);
    return (state: 'visible' | 'hidden') => {
        fake.visibilityState = state;
        fake.dispatchEvent(new Event('visibilitychange'));
    };
}

afterEach(() => {
    vi.unstubAllGlobals();
    plugin.openAppSettings.mockReset();
    native.value = false;
});

describe('canOpenAppSettings', () => {
    it('앱에서만 설정 화면을 열 수 있다', () => {
        expect(canOpenAppSettings()).toBe(false);
        native.value = true;
        expect(canOpenAppSettings()).toBe(true);
    });
});

describe('openAppSettings', () => {
    it('설정 화면에서 앱으로 돌아와야 끝난다', async () => {
        const show = fakeDocument();
        plugin.openAppSettings.mockResolvedValue(undefined);
        let done = false;

        const opened = openAppSettings().then(() => {
            done = true;
        });
        await Promise.resolve();
        show('hidden');
        await Promise.resolve();
        expect(done).toBe(false);

        show('visible');
        await opened;
        expect(plugin.openAppSettings).toHaveBeenCalledTimes(1);
        expect(done).toBe(true);
    });

    it('설정 화면을 열지 못하면 기다리지 않고 실패한다', async () => {
        fakeDocument();
        plugin.openAppSettings.mockRejectedValue(new Error('no activity'));

        await expect(openAppSettings()).rejects.toThrow('no activity');
    });
});
