import { useId } from 'react';

import type { RequestState } from '../hooks/useRequest';
import type { Place } from '../lib/placeApi';
import Icon from './Icon';

type HomeScreenProps = {
    /** 등록한 집. 없으면 집 버튼이 등록 화면으로 간다. */
    home: Place | null;
    /** 최근 안내한 곳. 최근 것이 앞이다. */
    recent: readonly Place[];
    locating: boolean;
    locationError: string | null;
    /** 내 위치 듣기로 찾은 주소 */
    whereAmI: RequestState<string>;
    onSearch: () => void;
    onPick: (place: Place) => void;
    onGoHome: (home: Place) => void;
    onSetHome: () => void;
    onWhereAmI: () => void;
    onSettings: () => void;
    /** 음성 안내를 켰으면 앱이 이유를 읽으므로 화면낭독기가 또 읽지 않게 한다. */
    voice: boolean;
};

/** 첫 화면: 목적지 찾기, 최근 간 곳, 집으로 안내, 내 위치 듣기, 설정 */
export default function HomeScreen({
    home,
    recent,
    locating,
    locationError,
    whereAmI,
    onSearch,
    onPick,
    onGoHome,
    onSetHome,
    onWhereAmI,
    onSettings,
    voice,
}: HomeScreenProps) {
    const recentId = useId();
    return (
        <div className="home">
            <button
                type="button"
                className="button button--primary"
                onClick={onSearch}
            >
                <Icon name="search" />
                어디로 갈까요?
            </button>
            {locationError && (
                <p
                    role={voice ? undefined : 'alert'}
                    className="message message--error"
                >
                    {locationError}
                </p>
            )}
            {whereAmI.status === 'success' && (
                <p role={voice ? undefined : 'status'} className="message">
                    {whereAmI.data}
                </p>
            )}
            {whereAmI.status === 'error' && (
                <p
                    role={voice ? undefined : 'alert'}
                    className="message message--error"
                >
                    {whereAmI.message}
                </p>
            )}
            {recent.length > 0 && (
                <section aria-labelledby={recentId}>
                    <h2 id={recentId} className="home__label">
                        최근 간 곳
                    </h2>
                    <ul className="list">
                        {recent.map((place) => (
                            <li
                                key={`${place.name}-${place.position.join(',')}`}
                            >
                                <button
                                    type="button"
                                    className="row"
                                    onClick={() => onPick(place)}
                                >
                                    <span className="row__name">
                                        {place.name}
                                    </span>
                                    <Icon name="next" />
                                </button>
                            </li>
                        ))}
                    </ul>
                </section>
            )}
            <div className="home__actions">
                <button
                    type="button"
                    className="button"
                    onClick={home ? () => onGoHome(home) : onSetHome}
                >
                    <Icon name="home" />
                    {home ? '집으로 안내' : '집 등록하기'}
                </button>
                <div className="pair">
                    <button
                        type="button"
                        className="button"
                        disabled={locating}
                        onClick={onWhereAmI}
                    >
                        {locating ? '위치 찾는 중' : '내 위치 듣기'}
                    </button>
                    <button
                        type="button"
                        className="button"
                        onClick={onSettings}
                    >
                        설정
                    </button>
                </div>
            </div>
        </div>
    );
}
