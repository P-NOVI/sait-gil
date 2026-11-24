import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const recognition = vi.hoisted(() => ({
    available: vi.fn(),
    requestPermissions: vi.fn(),
    start: vi.fn(),
    stop: vi.fn(),
}));

vi.mock('@capacitor/core', () => ({
    Capacitor: { isNativePlatform: () => true },
    registerPlugin: () => ({
        startBluetoothMic: vi.fn().mockResolvedValue({ connected: false }),
        stopBluetoothMic: vi.fn().mockResolvedValue(undefined),
    }),
}));
vi.mock('@capacitor-community/speech-recognition', () => ({
    SpeechRecognition: recognition,
}));

import { LISTEN_RETRY_DELAY_MS } from '../settings';
import { listenOnce } from './listen';

const INSTANT_ERROR = new Error("Didn't understand, please try again.");

beforeEach(() => {
    vi.useFakeTimers();
    vi.spyOn(console, 'info').mockImplementation(() => undefined);
    recognition.available.mockResolvedValue({ available: true });
    recognition.requestPermissions.mockResolvedValue({
        speechRecognition: 'granted',
    });
    recognition.stop.mockResolvedValue(undefined);
});

afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    vi.clearAllMocks();
});

describe('listenOnce (앱)', () => {
    it('바로 실패하면 한 번 다시 시도해 들은 말을 돌려준다', async () => {
        recognition.start
            .mockRejectedValueOnce(INSTANT_ERROR)
            .mockResolvedValueOnce({ matches: ['카메라 켜줘'] });

        const heard = listenOnce();
        await vi.advanceTimersByTimeAsync(LISTEN_RETRY_DELAY_MS);

        await expect(heard).resolves.toBe('카메라 켜줘');
        expect(recognition.start).toHaveBeenCalledTimes(2);
    });

    it('다시 시도해도 바로 실패하면 오류를 던진다', async () => {
        recognition.start.mockRejectedValue(INSTANT_ERROR);

        const heard = listenOnce();
        const caught = heard.catch((error: unknown) => error);
        await vi.advanceTimersByTimeAsync(LISTEN_RETRY_DELAY_MS);

        await expect(caught).resolves.toBe(INSTANT_ERROR);
        expect(recognition.start).toHaveBeenCalledTimes(2);
    });

    it('한참 듣다가 실패한 오류는 다시 시도하지 않는다', async () => {
        recognition.start.mockImplementation(async () => {
            await new Promise((resolve) => setTimeout(resolve, 3_000));
            throw new Error('No speech input');
        });

        const heard = listenOnce();
        const caught = heard.catch((error: unknown) => error);
        await vi.advanceTimersByTimeAsync(3_000);

        await expect(caught).resolves.toBeInstanceOf(Error);
        expect(recognition.start).toHaveBeenCalledTimes(1);
    });

    it('다시 시도를 기다리는 중 멈추면 더 시도하지 않고 null 을 돌려준다', async () => {
        recognition.start.mockRejectedValue(INSTANT_ERROR);
        const { stopListening } = await import('./listen');

        const heard = listenOnce();
        await vi.advanceTimersByTimeAsync(0);
        stopListening();
        await vi.advanceTimersByTimeAsync(LISTEN_RETRY_DELAY_MS);

        await expect(heard).resolves.toBeNull();
        expect(recognition.start).toHaveBeenCalledTimes(1);
    });
});
