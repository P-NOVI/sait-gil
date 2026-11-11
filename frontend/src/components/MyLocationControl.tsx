type MyLocationControlProps = {
    locating: boolean;
    error: string | null;
    onLocate: () => void;
};

/** 지도 위 '내 위치' 버튼. 못 찾으면 이유를 버튼 옆에 띄운다. */
export default function MyLocationControl({
    locating,
    error,
    onLocate,
}: MyLocationControlProps) {
    return (
        <div className="my-location-control">
            {error && (
                <p role="alert" className="my-location-control__error">
                    {error}
                </p>
            )}
            <button
                type="button"
                className="my-location-control__button"
                aria-label={locating ? '내 위치 찾는 중' : '내 위치 찾기'}
                disabled={locating}
                onClick={onLocate}
            >
                <svg viewBox="0 0 24 24" aria-hidden="true">
                    <circle
                        cx="12"
                        cy="12"
                        r="7"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2"
                    />
                    <circle cx="12" cy="12" r="3" fill="currentColor" />
                    <path
                        d="M12 2v3M12 19v3M2 12h3M19 12h3"
                        stroke="currentColor"
                        strokeWidth="2"
                        strokeLinecap="round"
                    />
                </svg>
            </button>
        </div>
    );
}
