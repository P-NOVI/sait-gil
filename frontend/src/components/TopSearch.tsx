import {
    type FormEvent,
    type RefObject,
    useEffect,
    useId,
    useRef,
    useState,
} from 'react';

import { type Answer, listened } from '../hooks/useAnnouncer';
import type { RequestState } from '../hooks/useRequest';
import type { LngLat } from '../lib/geo';
import type { Place } from '../lib/placeApi';
import { distanceLabel } from '../lib/routeApi';
import {
    HOME_MISSING_TEXT,
    HOME_REGISTER_PROMPT,
    homeCommand,
    homeSetupCommand,
    NOT_HEARD_TEXT,
    PLACE_ANSWER_HINT,
    type PlaceAnswer,
    placeAnswer,
} from '../lib/voiceCommand';
import {
    GO_QUESTION,
    HOME_QUESTION,
    LISTEN_FAILED_TEXT,
    NO_MORE_PLACES_TEXT,
    NO_PLACES_TEXT,
    placeQuestion,
    searchSpoken,
    spokenQueries,
} from '../lib/voiceSearch';
import Icon from './Icon';

type TopSearchProps = {
    inputRef: RefObject<HTMLInputElement | null>;
    results: RequestState<Place[]>;
    /** 가까운 곳부터 찾을 기준 위치. 검색마다 한 번 묻는다. 모르면 null */
    onFindNear: () => Promise<LngLat | null>;
    /** near 가까운 곳부터 검색한 결과를 돌려준다. 실패하면 null */
    onSearch: (query: string, near: LngLat | null) => Promise<Place[] | null>;
    /** 말로 목적지를 넣는다. 알아들은 말을 돌려주고, 못 알아들으면 null */
    onListen: () => Promise<string | null>;
    onPick: (place: Place) => void;
    /** 말로 찾다가 생긴 안내를 음성으로 읽는다. */
    onAnnounce: (text: string) => void;
    /** 말로 찾은 곳을 읽고 대답을 듣는다. */
    onAsk: (text: string) => Promise<Answer>;
    /** 음성 안내를 켰으면 화면낭독기가 같은 문장을 또 읽지 않게 한다. */
    voice: boolean;
    /** 고른 곳으로 갈지(go), 집으로 저장할지(home). 묻는 말과 대답 버튼이 달라진다. */
    purpose?: 'go' | 'home';
    /** 집 등록 화면에서 지금 위치를 집으로 저장한다. 주면 버튼을 보인다. */
    onUseHere?: () => void;
    /** 등록한 집. "집으로 갈게"라고 말하면 이곳으로 바로 안내한다. 없으면 null */
    home?: Place | null;
    /** 집으로 안내를 시작한다. 주면 말로 "집으로 갈게"를 알아듣는다. */
    onGoHome?: (home: Place) => void;
    /** 목적지 찾기 화면에서 "집 등록할게"라고 말하면 집 등록 화면으로 간다. */
    onRegisterHome?: () => void;
    /** 열자마자 집으로 등록할 곳을 말로 묻는다. 물은 뒤 onAskUsed 를 부른다. */
    askOnOpen?: boolean;
    onAskUsed?: () => void;
    /** 내 위치를 찾는 중이면 지금 위치 버튼을 막는다. */
    locating?: boolean;
    /** 앱을 열 때 첫 화면에서 들은 목적지. 주면 말로 찾은 것처럼 한 번 찾고 onSpokenUsed 를 부른다. */
    spoken?: string | null;
    onSpokenUsed?: () => void;
};

/** 말로 찾은 결과 중 지금 묻고 있는 것 */
type Confirming = { places: Place[]; index: number };

/**
 * 목적지 검색 화면. 입력하거나 말한 목적지를 검색하고 결과에서 고른다.
 * 결과 수는 화면낭독기가 읽도록 status 로 알린다.
 * 말로 찾으면 첫 결과부터 하나씩 읽고 이곳으로 갈지 묻는다. 말로도 버튼으로도 대답한다.
 */
export default function TopSearch({
    inputRef,
    results,
    onFindNear,
    onSearch,
    onListen,
    onPick,
    onAnnounce,
    onAsk,
    voice,
    purpose = 'go',
    onUseHere,
    home = null,
    onGoHome,
    onRegisterHome,
    askOnOpen = false,
    onAskUsed,
    locating = false,
    spoken = null,
    onSpokenUsed,
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
    const question = purpose === 'home' ? HOME_QUESTION : GO_QUESTION;
    // 말로 한 대답이 도착했을 때 아직 그 질문을 보고 있는지 확인한다. 버튼으로 먼저 답했으면 버린다.
    const asked = useRef<Confirming | null>(null);

    useEffect(() => {
        asked.current = confirming;
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

    useEffect(
        () => () => {
            asked.current = null;
        },
        [],
    );

    const closeConfirm = () => {
        restoreFocus.current = true;
        setConfirming(null);
    };

    const pick = (place: Place) => {
        setConfirming(null);
        onPick(place);
    };

    const answer = (reply: PlaceAnswer, about: Confirming) => {
        switch (reply) {
            case 'yes':
                pick(about.places[about.index]);
                break;
            case 'next':
                showNext(about);
                break;
            case 'list':
                closeConfirm();
                break;
        }
    };

    /** 이곳으로 갈지 읽고 묻는다. 못 알아들으면 고를 수 있는 말을 알려 주고 한 번 더 듣는다. */
    const ask = async (places: Place[], index: number) => {
        const about = { places, index };
        setConfirming(about);
        let heard = await onAsk(
            placeQuestion(places[index], index, places.length, question),
        );
        let reply = heard.status === 'heard' ? placeAnswer(heard.text) : null;
        if (
            heard.status === 'heard' &&
            reply === null &&
            asked.current === about
        ) {
            heard = await onAsk(PLACE_ANSWER_HINT);
            reply = heard.status === 'heard' ? placeAnswer(heard.text) : null;
        }
        if (asked.current !== about) {
            return;
        }
        if (reply) {
            answer(reply, about);
        } else if (listened(heard)) {
            onAnnounce(NOT_HEARD_TEXT);
        }
    };

    const showNext = ({ places, index }: Confirming) => {
        if (index + 1 < places.length) {
            void ask(places, index + 1);
        } else {
            setNotice(NO_MORE_PLACES_TEXT);
            onAnnounce(NO_MORE_PLACES_TEXT);
            closeConfirm();
        }
    };

    const submit = (event: FormEvent) => {
        event.preventDefault();
        setConfirming(null);
        setNotice(null);
        const typed = query.trim();
        if (typed) {
            void onFindNear().then((near) => onSearch(typed, near));
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
            onAnnounce(LISTEN_FAILED_TEXT);
            return;
        }
        await searchHeard(heard);
    };

    /** 집 등록 화면이면 등록할 곳을 말로 묻고 찾는다. 목적지 찾기 화면이면 집 등록 화면으로 간다. */
    const registerHome = async () => {
        if (purpose === 'go') {
            onRegisterHome?.();
            return;
        }
        const heard = await onAsk(HOME_REGISTER_PROMPT);
        if (heard.status === 'heard') {
            await searchHeard(heard.text);
        } else if (listened(heard)) {
            setListenFailed(true);
            onAnnounce(LISTEN_FAILED_TEXT);
        }
    };

    /** 말로 들은 목적지로 찾고, 찾으면 첫 결과부터 하나씩 묻는다. */
    const searchHeard = async (heard: string) => {
        // "지금 위치를 집으로 설정할게", "집 등록할게"는 검색하지 않고 집을 등록한다.
        const setup = homeSetupCommand(heard);
        if (setup === 'here' && onUseHere) {
            onUseHere();
            return;
        }
        if (setup && (purpose === 'home' || onRegisterHome)) {
            await registerHome();
            return;
        }
        // "집으로 갈게"는 검색하지 않고 등록한 집으로 간다.
        if (onGoHome && homeCommand(heard)) {
            if (home) {
                onGoHome(home);
            } else {
                onAnnounce(HOME_MISSING_TEXT);
            }
            return;
        }
        const queries = spokenQueries(heard);
        setQuery(queries[0]);
        // 검색어 후보가 여럿이어도 기준 위치는 한 번만 묻는다.
        const near = await onFindNear();
        let searched = '';
        const found = await searchSpoken(queries, (candidate) => {
            searched = candidate;
            return onSearch(candidate, near);
        });
        if (!found) {
            return;
        }
        // Tmap 결과로 고른 검색어로 검색창을 고친다.
        setQuery(found.query);
        if (found.query !== searched) {
            // 목록에도 고른 검색어의 결과가 보이게 다시 검색한다.
            await onSearch(found.query, near);
        }
        if (found.places.length === 0) {
            // 화면에는 아래 "검색 결과가 없습니다" 안내가 이미 뜬다.
            onAnnounce(NO_PLACES_TEXT);
            return;
        }
        void ask(found.places, 0);
    };

    // 첫 화면에서 들은 목적지는 한 번만 찾는다. 다시 그려져도 또 찾지 않게 부모에게 알린다.
    const searchHeardNow = useRef(searchHeard);
    useEffect(() => {
        searchHeardNow.current = searchHeard;
    });
    useEffect(() => {
        if (spoken) {
            onSpokenUsed?.();
            void searchHeardNow.current(spoken);
        }
    }, [spoken, onSpokenUsed]);

    // 말로 집 등록 화면에 왔으면 한 번만 묻는다. 다시 그려져도 또 묻지 않게 부모에게 알린다.
    const registerHomeNow = useRef(registerHome);
    useEffect(() => {
        registerHomeNow.current = registerHome;
    });
    useEffect(() => {
        if (askOnOpen) {
            onAskUsed?.();
            void registerHomeNow.current();
        }
    }, [askOnOpen, onAskUsed]);

    const current = confirming ? confirming.places[confirming.index] : null;

    const places =
        results.status === 'success'
            ? results.data
            : results.status === 'loading'
              ? (results.previous ?? [])
              : [];

    return (
        <div className="search">
            <button
                type="button"
                className="button button--primary search__voice"
                disabled={listening}
                onClick={() => void listen()}
            >
                <Icon name="mic" />
                {listening ? '듣는 중' : '말로 찾기'}
            </button>
            {purpose === 'home' && onUseHere && (
                <button
                    type="button"
                    className="button"
                    disabled={locating}
                    onClick={onUseHere}
                >
                    <Icon name="home" />
                    {locating ? '내 위치 찾는 중' : '지금 위치를 집으로'}
                </button>
            )}
            <form className="search__field" role="search" onSubmit={submit}>
                <Icon name="search" />
                <label className="visually-hidden" htmlFor="destination">
                    {purpose === 'home' ? '집 검색' : '목적지 검색'}
                </label>
                <input
                    ref={inputRef}
                    id="destination"
                    type="search"
                    enterKeyHint="search"
                    placeholder={
                        purpose === 'home'
                            ? '집 주소나 건물 이름'
                            : '어디로 갈까요?'
                    }
                    value={query}
                    onChange={(event) => setQuery(event.target.value)}
                />
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
                <p className="message message--error" role="alert">
                    {LISTEN_FAILED_TEXT}
                </p>
            )}
            {results.status === 'error' && (
                <p className="message message--error" role="alert">
                    {results.message}
                </p>
            )}
            {results.status === 'success' && places.length === 0 && (
                <p className="message">
                    검색 결과가 없습니다. 다른 이름으로 찾아보세요.
                </p>
            )}
            <div aria-live={voice ? 'off' : 'polite'}>
                {notice && <p className="message">{notice}</p>}
            </div>
            {confirming && current && (
                <section className="confirm" aria-label="말로 찾은 목적지 확인">
                    <p id={questionId} className="confirm__question">
                        {placeQuestion(
                            current,
                            confirming.index,
                            confirming.places.length,
                            question,
                        )}
                    </p>
                    <div className="confirm__answers">
                        <button
                            ref={confirmButton}
                            type="button"
                            className="button button--primary"
                            aria-describedby={voice ? undefined : questionId}
                            onClick={() => pick(current)}
                        >
                            {purpose === 'home'
                                ? '집으로 할게요'
                                : '여기로 갈게요'}
                        </button>
                        <button
                            type="button"
                            className="button"
                            onClick={() => showNext(confirming)}
                        >
                            다음 결과
                        </button>
                        <button
                            type="button"
                            className="button"
                            onClick={closeConfirm}
                        >
                            목록 보기
                        </button>
                    </div>
                </section>
            )}
            {!confirming && places.length > 0 && (
                <ul ref={resultList} className="list" aria-label="검색 결과">
                    {places.map((place) => (
                        <li key={`${place.name}-${place.position.join(',')}`}>
                            <button
                                type="button"
                                className="row"
                                onClick={() => onPick(place)}
                            >
                                <span className="row__main">
                                    <span className="row__name">
                                        {place.name}
                                    </span>
                                    <span className="row__detail">
                                        {place.address}
                                    </span>
                                </span>
                                {place.distance_m !== null && (
                                    <span className="row__side">
                                        {distanceLabel(place.distance_m)}
                                    </span>
                                )}
                            </button>
                        </li>
                    ))}
                </ul>
            )}
        </div>
    );
}
