// 말로 찾은 목적지: 말끝 정리, 첫 결과부터 하나씩 읽고 확인하는 문장

import { spokenDistance } from './guidanceText';
import type { Place } from './placeApi';

// "서울역으로 가 줘"의 "으로 가 줘"처럼 장소 이름 뒤에 붙는 말
const REQUEST_ENDING =
    /\s*(?:(?:으로|로|까지|에)\s*)?(?:가\s*(?:줘|주세요|자|요|고\s*싶어요?|려고\s*해요?|는\s*길)|안내해\s*(?:줘|주세요)|길\s*(?:찾아|알려)\s*(?:줘|주세요)|찾아\s*(?:줘|주세요)|검색해\s*(?:줘|주세요)|어디야|어디예요|어디에요)$/;
const TRAILING_MARKS = /[\s.,!?。]+$/;
// "서울역[KTX정차역]"의 대괄호. 읽을 때는 "서울역 KTX정차역"
const NAME_BRACKETS = /\s*\[(.*?)\]/g;

/** 말한 문장에서 검색어만 남긴다. 다 지워지면 원래 말을 그대로 쓴다. */
export function cleanSpokenQuery(heard: string): string {
    const trimmed = heard.replace(TRAILING_MARKS, '').trim();
    const query = trimmed.replace(REQUEST_ENDING, '').trim();
    return query || trimmed;
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
