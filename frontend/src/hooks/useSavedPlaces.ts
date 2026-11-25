import { useCallback, useEffect, useState } from 'react';

import type { Place } from '../lib/placeApi';
import {
    HOME_PLACE_KEY,
    RECENT_PLACES_KEY,
    storedPlace,
    storedPlaces,
    withRecent,
} from '../lib/savedPlaces';
import { readStored, writeStored } from '../platform';

/** 집과 최근 간 곳. 바꿀 때마다 기기에 저장한다. */
export function useSavedPlaces() {
    const [home, setHomeState] = useState<Place | null>(() =>
        storedPlace(readStored(HOME_PLACE_KEY)),
    );
    const [recent, setRecent] = useState<Place[]>(() =>
        storedPlaces(readStored(RECENT_PLACES_KEY)),
    );

    useEffect(() => {
        writeStored(RECENT_PLACES_KEY, recent);
    }, [recent]);

    /** null 이면 집을 지운다. */
    const setHome = useCallback((place: Place | null) => {
        const kept = place && { ...place, distance_m: null };
        setHomeState(kept);
        writeStored(HOME_PLACE_KEY, kept);
    }, []);

    // 오래된 렌더에서 불려도 앞서 넣은 곳을 잃지 않게 함수형으로 바꾼다.
    const addRecent = useCallback((place: Place) => {
        setRecent((list) => withRecent(list, place));
    }, []);

    return { home, recent, setHome, addRecent };
}
