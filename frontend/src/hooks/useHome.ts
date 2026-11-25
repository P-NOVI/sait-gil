import { useCallback, useState } from 'react';

import { HOME_STORAGE_KEY, normalizeHome } from '../lib/favorites';
import type { Place } from '../lib/placeApi';
import { readStored, writeStored } from '../platform';

/** 즐겨찾기 집. 등록·해제하면 기기에 저장한다. 등록하지 않았으면 null. */
export function useHome(): [
    Place | null,
    { setHome: (place: Place) => void; clearHome: () => void },
] {
    const [home, setHomeState] = useState(() =>
        normalizeHome(readStored(HOME_STORAGE_KEY)),
    );

    const setHome = useCallback((place: Place) => {
        const next = normalizeHome(place);
        writeStored(HOME_STORAGE_KEY, next);
        setHomeState(next);
    }, []);

    const clearHome = useCallback(() => {
        writeStored(HOME_STORAGE_KEY, null);
        setHomeState(null);
    }, []);

    return [home, { setHome, clearHome }];
}
