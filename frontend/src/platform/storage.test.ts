import { afterEach, describe, expect, it, vi } from 'vitest';

import { readStored, writeStored } from './storage';

afterEach(() => {
    vi.unstubAllGlobals();
});

function memoryStorage() {
    const items = new Map<string, string>();
    return {
        getItem: (key: string) => items.get(key) ?? null,
        setItem: (key: string, value: string) => void items.set(key, value),
    };
}

describe('storage', () => {
    it('저장한 값을 JSON 으로 되읽는다', () => {
        vi.stubGlobal('localStorage', memoryStorage());

        writeStored('key', { voice: false });

        expect(readStored('key')).toEqual({ voice: false });
        expect(readStored('missing')).toBeNull();
    });

    it('저장소를 쓸 수 없어도 오류 없이 넘어간다', () => {
        const denied = () => {
            throw new Error('denied');
        };
        vi.stubGlobal('localStorage', { getItem: denied, setItem: denied });

        expect(() => writeStored('key', 1)).not.toThrow();
        expect(readStored('key')).toBeNull();
    });
});
