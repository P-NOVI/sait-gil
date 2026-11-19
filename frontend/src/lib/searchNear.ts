// 목적지 검색의 기준 위치. 가까운 곳부터 찾도록 내 위치를 쓴다.

import type { LocationFix } from '../platform';
import type { LngLat } from './geo';

export const LOCATING_FOR_SEARCH_TEXT =
    '내 위치를 찾고 있습니다. 찾으면 가까운 곳부터 검색합니다.';
export const NO_NEAR_TEXT =
    '내 위치를 찾지 못해 가까운 곳부터 찾지 못했습니다.';

/**
 * 검색 기준 위치를 정한다.
 * 앱을 막 열어 내 위치를 찾는 중이면 알리고 기다린다. 끝내 못 찾으면 위치 없이 찾는다고 알린다.
 * 이미 못 찾았으면 그 이유를 앞서 읽었으므로 검색할 때마다 또 읽지 않는다.
 * 위치를 모르면 null 을 돌려준다.
 */
export async function nearForSearch(
    known: LocationFix | null,
    pending: Promise<LocationFix | null> | null,
    say: (text: string) => void,
): Promise<LngLat | null> {
    if (known) {
        return known.position;
    }
    if (pending) {
        say(LOCATING_FOR_SEARCH_TEXT);
        const fix = await pending;
        if (fix) {
            return fix.position;
        }
        say(NO_NEAR_TEXT);
    }
    return null;
}
