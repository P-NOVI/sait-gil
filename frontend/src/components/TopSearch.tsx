import { type FormEvent, type RefObject, useState } from 'react';

import type { RequestState } from '../hooks/useRequest';
import type { Place } from '../lib/placeApi';
import { distanceLabel } from '../lib/routeApi';

type TopSearchProps = {
    inputRef: RefObject<HTMLInputElement | null>;
    results: RequestState<Place[]>;
    onSearch: (query: string) => void;
    /** 말로 목적지를 넣는다. 알아들은 말을 돌려주고, 못 알아들으면 null */
    onListen: () => Promise<string | null>;
    onPick: (place: Place) => void;
};

/**
 * 지도 위 검색창. 입력하거나 말한 목적지를 검색하고 결과에서 고른다.
 * 결과 수는 화면낭독기가 읽도록 status 로 알린다.
 */
export default function TopSearch({
    inputRef,
    results,
    onSearch,
    onListen,
    onPick,
}: TopSearchProps) {
    const [query, setQuery] = useState('');
    const [listening, setListening] = useState(false);
    const [listenFailed, setListenFailed] = useState(false);

    const submit = (event: FormEvent) => {
        event.preventDefault();
        if (query.trim()) {
            onSearch(query.trim());
        }
    };

    const listen = async () => {
        setListening(true);
        setListenFailed(false);
        const heard = await onListen().catch(() => null);
        setListening(false);
        if (heard) {
            setQuery(heard);
            onSearch(heard);
        } else {
            setListenFailed(true);
        }
    };

    const places =
        results.status === 'success'
            ? results.data
            : results.status === 'loading'
              ? (results.previous ?? [])
              : [];

    return (
        <div className="top-search">
            <form className="top-search__field" role="search" onSubmit={submit}>
                <svg
                    className="top-search__icon"
                    viewBox="0 0 24 24"
                    aria-hidden="true"
                >
                    <path d="M10.5 4a6.5 6.5 0 1 0 0 13 6.5 6.5 0 0 0 0-13ZM15.2 15.2 20 20" />
                </svg>
                <label className="visually-hidden" htmlFor="destination">
                    목적지 검색
                </label>
                <input
                    ref={inputRef}
                    id="destination"
                    type="search"
                    enterKeyHint="search"
                    placeholder="어디로 갈까요?"
                    value={query}
                    onChange={(event) => setQuery(event.target.value)}
                />
                <button
                    type="button"
                    className="top-search__voice"
                    aria-label={listening ? '듣는 중' : '말로 목적지 찾기'}
                    disabled={listening}
                    onClick={() => void listen()}
                >
                    <svg viewBox="0 0 24 24" aria-hidden="true">
                        <path d="M12 3a3 3 0 0 0-3 3v6a3 3 0 0 0 6 0V6a3 3 0 0 0-3-3ZM5.5 11a6.5 6.5 0 0 0 13 0M12 17.5V21" />
                    </svg>
                </button>
            </form>
            <p className="visually-hidden" role="status">
                {listening
                    ? '목적지를 말하세요.'
                    : results.status === 'loading'
                      ? '검색 중입니다.'
                      : results.status === 'success'
                        ? `검색 결과 ${results.data.length}개`
                        : ''}
            </p>
            {listenFailed && (
                <p className="top-search__message" role="alert">
                    말을 알아듣지 못했습니다. 다시 말하거나 글자로 입력하세요.
                </p>
            )}
            {results.status === 'error' && (
                <p className="top-search__message" role="alert">
                    {results.message}
                </p>
            )}
            {results.status === 'success' && places.length === 0 && (
                <p className="top-search__message">
                    검색 결과가 없습니다. 다른 이름으로 찾아보세요.
                </p>
            )}
            {places.length > 0 && (
                <ul className="top-search__list" aria-label="검색 결과">
                    {places.map((place) => (
                        <li key={`${place.name}-${place.position.join(',')}`}>
                            <button
                                type="button"
                                className="top-search__result"
                                onClick={() => onPick(place)}
                            >
                                <span className="top-search__name">
                                    {place.name}
                                </span>
                                <span className="top-search__detail">
                                    {place.distance_m !== null &&
                                        `${distanceLabel(place.distance_m)} · `}
                                    {place.address}
                                </span>
                            </button>
                        </li>
                    ))}
                </ul>
            )}
        </div>
    );
}
