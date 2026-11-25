type HomeScreenProps = {
    locating: boolean;
    locationError: string | null;
    onSearch: () => void;
    onWhereAmI: () => void;
    onSettings: () => void;
    /** 음성 안내를 켰으면 앱이 이유를 읽으므로 화면낭독기가 또 읽지 않게 한다. */
    voice: boolean;
};

/** 홈: 큰 버튼 하나로 목적지를 찾고, 아래 큰 버튼 둘로 내 위치와 설정으로 간다. */
export default function HomeScreen({
    locating,
    locationError,
    onSearch,
    onWhereAmI,
    onSettings,
    voice,
}: HomeScreenProps) {
    return (
        <main className="home">
            <button
                type="button"
                className="big-button home__main"
                onClick={onSearch}
            >
                <svg viewBox="0 0 24 24" aria-hidden="true">
                    <path d="M10.5 4a6.5 6.5 0 1 0 0 13 6.5 6.5 0 0 0 0-13ZM15.2 15.2 20 20" />
                </svg>
                어디로 갈까요?
            </button>
            {locationError && (
                <p role={voice ? undefined : 'alert'} className="home__error">
                    {locationError}
                </p>
            )}
            <div className="home__sub">
                <button
                    type="button"
                    className="big-button big-button--secondary"
                    disabled={locating}
                    onClick={onWhereAmI}
                >
                    {locating ? '내 위치 찾는 중' : '내 위치'}
                </button>
                <button
                    type="button"
                    className="big-button big-button--secondary"
                    onClick={onSettings}
                >
                    설정
                </button>
            </div>
        </main>
    );
}
