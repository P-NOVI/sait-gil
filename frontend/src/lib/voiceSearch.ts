// 말로 찾은 목적지: 말끝 정리, Tmap 결과로 검색어 고르기, 첫 결과부터 하나씩 읽고 확인하는 문장

import { spokenDistance } from './guidanceText';
import type { Place } from './placeApi';

// "서울역으로 가 줘"의 "가 줘"처럼 장소 이름 뒤에 붙는 부탁하는 말
const REQUEST_ENDING =
    /\s*(?:가\s*(?:줘|주세요|자|요|고\s*싶어요?|려고\s*해요?|는\s*길)|안내해\s*(?:줘|주세요)|길\s*(?:찾아|알려)\s*(?:줘|주세요)|찾아\s*(?:줘|주세요)|검색해\s*(?:줘|주세요)|어디야|어디예요|어디에요)$/;
// 부탁하는 말 앞의 조사. "로"는 장소 이름 끝(종로, 을지로)일 수 있어 따로 본다.
const SURE_PARTICLE = /\s*(?:으로|까지|에)$/;
const TRAILING_MARKS = /[\s.,!?。]+$/;
// "서울역[KTX정차역]"의 대괄호. 읽을 때는 "서울역 KTX정차역"
const NAME_BRACKETS = /\s*\[(.*?)\]/g;

const HANGUL_FIRST = 0xac00;
const HANGUL_LAST = 0xd7a3;
const FINAL_COUNT = 28;
const NO_FINAL = 0;
const RIEUL_FINAL = 8;

/** 글자의 받침 번호. 한글이 아니면 null, 받침이 없으면 0 */
function finalConsonant(char: string): number | null {
    const code = char.charCodeAt(0);
    if (code < HANGUL_FIRST || code > HANGUL_LAST) {
        return null;
    }
    return (code - HANGUL_FIRST) % FINAL_COUNT;
}

/**
 * 말한 문장에서 검색어 후보를 뽑는다. 앞의 것부터 검색해 본다.
 * 끝의 "로"가 조사인지 이름 끝인지 모를 때만 두 개(로를 둔 것, 뗀 것)를 돌려준다.
 */
export function spokenQueries(heard: string): string[] {
    const trimmed = heard.replace(TRAILING_MARKS, '').trim();
    const rest = trimmed.replace(REQUEST_ENDING, '').trim();
    if (!rest || rest === trimmed) {
        return [trimmed];
    }
    const withoutParticle = rest.replace(SURE_PARTICLE, '').trim();
    if (withoutParticle !== rest) {
        return [withoutParticle || rest];
    }
    if (rest.length < 2 || !rest.endsWith('로')) {
        return [rest];
    }
    const before = rest.slice(0, -1).trim();
    // "종로로"의 끝 "로"는 조사다.
    if (before.endsWith('로')) {
        return [before];
    }
    // 조사 "로"는 받침이 없거나 ㄹ 받침인 글자 뒤에만 온다. 종로·대학로의 "로"는 이름이다.
    const final = finalConsonant(before.slice(-1));
    if (final !== null && final !== NO_FINAL && final !== RIEUL_FINAL) {
        return [rest];
    }
    return [rest, before];
}

function compact(text: string): string {
    return text.replace(/\s/g, '');
}

/** 결과 이름에 검색어가 그대로 들어 있는가 */
function matchesQuery(place: Place, query: string): boolean {
    return compact(place.name).includes(compact(query));
}

export type SpokenSearch = { query: string; places: Place[] };

/**
 * 후보 검색어를 차례로 검색해 첫 결과 이름에 검색어가 들어 있는 것을 고른다.
 * 그런 것이 없으면 결과가 있는 첫 후보, 모두 비었으면 마지막 후보를 고른다.
 * 검색이 실패하면 null.
 */
export async function searchSpoken(
    queries: string[],
    search: (query: string) => Promise<Place[] | null>,
): Promise<SpokenSearch | null> {
    let fallback: SpokenSearch | null = null;
    let last: SpokenSearch | null = null;
    for (const query of queries) {
        const places = await search(query);
        if (places === null) {
            return null;
        }
        last = { query, places };
        if (places.length > 0 && matchesQuery(places[0], query)) {
            return last;
        }
        if (!fallback && places.length > 0) {
            fallback = last;
        }
    }
    return fallback ?? last;
}

/** 결과 하나를 읽고 갈지 묻는 문장 */
export function placeQuestion(
    place: Place,
    index: number,
    total: number,
): string {
    const order = total > 1 ? `검색 결과 ${total}개 중 ${index + 1}번째. ` : '';
    const distance =
        place.distance_m !== null
            ? `, ${spokenDistance(place.distance_m)} 거리`
            : '';
    const name = place.name.replace(NAME_BRACKETS, ' $1').trim();
    return `${order}${name}${distance}. ${place.address}. 이곳으로 갈까요?`;
}

export const NO_MORE_PLACES_TEXT =
    '더 이상 검색 결과가 없습니다. 다시 말하거나 목록에서 고르세요.';
export const NO_PLACES_TEXT =
    '검색 결과가 없습니다. 다른 이름으로 다시 말하세요.';
