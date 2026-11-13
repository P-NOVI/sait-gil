import {
    type FormEvent,
    type RefObject,
    useEffect,
    useId,
    useRef,
    useState,
} from 'react';

import type { RequestState } from '../hooks/useRequest';
import type { Place } from '../lib/placeApi';
import { distanceLabel } from '../lib/routeApi';
import {
    NO_MORE_PLACES_TEXT,
    NO_PLACES_TEXT,
    placeQuestion,
    searchSpoken,
    spokenQueries,
} from '../lib/voiceSearch';

type TopSearchProps = {
    inputRef: RefObject<HTMLInputElement | null>;
    results: RequestState<Place[]>;
    /** 검색 결과를 돌려준다. 실패하면 null */
    onSearch: (query: string) => Promise<Place[] | null>;
    /** 말로 목적지를 넣는다. 알아들은 말을 돌려주고, 못 알아들으면 null */
    onListen: () => Promise<string | null>;
    onPick: (place: Place) => void;
    /** 말로 찾은 결과 중 확인하고 있는 곳. 확인 화면이 닫히면 null */
    onPreview: (place: Place | null) => void;
    /** 말로 찾은 결과를 음성으로 읽는다. */
    onAnnounce: (text: string) => void;
    /** 음성 안내를 켰으면 화면낭독기가 같은 문장을 또 읽지 않게 한다. */
    voice: boolean;
};

/** 말로 찾은 결과 중 지금 묻고 있는 것 */
type Confirming = { places: Place[]; index: number };

/**
 * 지도 위 검색창. 입력하거나 말한 목적지를 검색하고 결과에서 고른다.
 * 결과 수는 화면낭독기가 읽도록 status 로 알린다.
 * 말로 찾으면 첫 결과부터 하나씩 읽고 이곳으로 갈지 묻는다.
 */
export default function TopSearch({
    inputRef,
    results,
    onSearch,
    onListen,
    onPick,
    onPreview,
    onAnnounce,
    voice,
}: TopSearchProps) {
    const [query, setQuery] = useState('');
    const [listening, setListening] = useState(false);
    const [listenFailed, setListenFailed] = useState(false);
    const [confirming, setConfirming] = useState<Confirming | null>(null);
    // 말로 찾다가 생긴 안내. 음성을 끄고 화면낭독기로 쓰는 사람도 알 수 있게 화면에 둔다.
    const [notice, setNotice] = useState<string | null>(null);
    const confirmButton = useRef<HTMLButtonElement>(null);
    const resultList = useRef<HTMLUListElement>(null);
    // 확인 화면을 닫을 때 포커스를 결과 목록(없으면 검색창)으로 옮긴다.
    const restoreFocus = useRef(false);
    const questionId = useId();

    useEffect(() => {
        if (confirming) {
            confirmButton.current?.focus();
            return;
        }
        if (restoreFocus.current) {
            restoreFocus.current = false;
            const first = resultList.current?.querySelector('button');
            (first ?? inputRef.current)?.focus();
        }
    }, [confirming, inputRef]);

    const ask = (places: Place[], index: number) => {
        setConfirming({ places, index });
        onAnnounce(placeQuestion(places[index], index, places.length));
    };

    const closeConfirm = () => {
        restoreFocus.current = true;
        setConfirming(null);
    };

    const submit = (event: FormEvent) => {
        event.preventDefault();
        setConfirming(null);
        setNotice(null);
        if (query.trim()) {
            void onSearch(query.trim());
        }
    };

    const listen = async () => {
        setListening(true);
        setListenFailed(false);
        setConfirming(null);
        setNotice(null);
        const heard = await onListen().catch(() => null);
        setListening(false);
        if (!heard) {
            setListenFailed(true);
            return;
        }
        const queries = spokenQueries(heard);
        setQuery(queries[0]);
        let searched = '';
        const found = await searchSpoken(queries, (candidate) => {
            searched = candidate;
            return onSearch(candidate);
        });
        if (!found) {
            return;
        }
        // Tmap 결과로 고른 검색어로 검색창을 고친다.
        setQuery(found.query);
        if (found.query !== searched) {
            // 목록에도 고른 검색어의 결과가 보이게 다시 검색한다.
            await onSearch(found.query);
        }
        if (found.places.length === 0) {
            // 화면에는 아래 "검색 결과가 없습니다" 안내가 이미 뜬다.
            onAnnounce(NO_PLACES_TEXT);
            return;
        }
        ask(found.places, 0);
    };

    const next = () => {
        if (!confirming) {
            return;
        }
        const index = confirming.index + 1;
        if (index < confirming.places.length) {
            ask(confirming.places, index);
        } else {
            setNotice(NO_MORE_PLACES_TEXT);
            onAnnounce(NO_MORE_PLACES_TEXT);
            closeConfirm();
        }
    };

    const current = confirming ? confirming.places[confirming.index] : null;

    useEffect(() => {
        onPreview(current);
    }, [current, onPreview]);

    // 검색창이 닫히면(다른 탭) 지도에서 확인하던 곳도 지운다.
    useEffect(() => () => onPreview(null), [onPreview]);

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
            <div aria-live={voice ? 'off' : 'polite'}>
                {notice && <p className="top-search__message">{notice}</p>}
            </div>
            {confirming && current && (
                <section
                    className="top-search__confirm"
                    aria-label="말로 찾은 목적지 확인"
                >
                    <p id={questionId} className="top-search__question">
                        {placeQuestion(
                            current,
                            confirming.index,
                            confirming.places.length,
                        )}
                    </p>
                    <div className="top-search__answers">
                        <button
                            ref={confirmButton}
                            type="button"
                            className="top-search__yes"
                            aria-describedby={voice ? undefined : questionId}
                            onClick={() => {
                                setConfirming(null);
                                onPick(current);
                            }}
                        >
                            여기로 갈게요
                        </button>
                        <button type="button" onClick={next}>
                            다음 결과
                        </button>
                        <button type="button" onClick={closeConfirm}>
                            목록 보기
                        </button>
                    </div>
                </section>
            )}
            {!confirming && places.length > 0 && (
                <ul
                    ref={resultList}
                    className="top-search__list"
                    aria-label="검색 결과"
                >
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
