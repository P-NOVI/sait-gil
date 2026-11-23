import { afterEach, describe, expect, it, vi } from 'vitest';

const native = vi.hoisted(() => ({ value: false }));
const plugin = vi.hoisted(() => ({ openAppSettings: vi.fn() }));

vi.mock('@capacitor/core', () => ({
    Capacitor: { isNativePlatform: () => native.value },
    registerPlugin: () => plugin,
}));

import { canOpenAppSettings, openAppSettings } from './appSettings';

afterEach(() => {
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
    it('플러그인이 앱으로 돌아왔다고 알려야 끝난다', async () => {
        let back: () => void = () => undefined;
        plugin.openAppSettings.mockReturnValue(
            new Promise<void>((resolve) => {
                back = resolve;
            }),
        );
        let done = false;

        const opened = openAppSettings().then(() => {
            done = true;
        });
        await Promise.resolve();
        expect(done).toBe(false);

        back();
        await opened;
        expect(plugin.openAppSettings).toHaveBeenCalledTimes(1);
        expect(done).toBe(true);
    });

    it('설정 화면을 열지 못하면 실패한다', async () => {
        plugin.openAppSettings.mockRejectedValue(new Error('no activity'));

        await expect(openAppSettings()).rejects.toThrow('no activity');
    });
});
