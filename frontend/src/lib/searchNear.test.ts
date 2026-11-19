import { describe, expect, it, vi } from 'vitest';

import type { LocationFix } from '../platform';
import {
    LOCATING_FOR_SEARCH_TEXT,
    NO_NEAR_TEXT,
    nearForSearch,
} from './searchNear';

const FIX: LocationFix = { position: [127, 37.5], accuracy: 5 };

describe('nearForSearch', () => {
    it('내 위치를 알면 말없이 그 위치로 찾는다', async () => {
        const say = vi.fn();

        await expect(nearForSearch(FIX, null, say)).resolves.toEqual(
            FIX.position,
        );
        expect(say).not.toHaveBeenCalled();
    });

    it('찾는 중이면 알리고 찾은 위치를 기다린다', async () => {
        const say = vi.fn();

        await expect(
            nearForSearch(null, Promise.resolve(FIX), say),
        ).resolves.toEqual(FIX.position);
        expect(say.mock.calls).toEqual([[LOCATING_FOR_SEARCH_TEXT]]);
    });

    it('찾는 중이던 위치를 못 찾으면 위치 없이 찾는다고 알린다', async () => {
        const say = vi.fn();

        await expect(
            nearForSearch(null, Promise.resolve(null), say),
        ).resolves.toBeNull();
        expect(say.mock.calls).toEqual([
            [LOCATING_FOR_SEARCH_TEXT],
            [NO_NEAR_TEXT],
        ]);
    });

    it('이미 못 찾았으면 기다리지 않고 위치 없이 찾는다고 알린다', async () => {
        const say = vi.fn();

        await expect(nearForSearch(null, null, say)).resolves.toBeNull();
        expect(say.mock.calls).toEqual([[NO_NEAR_TEXT]]);
    });
});
