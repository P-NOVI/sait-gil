import type { RequestState } from '../hooks/useRequest';
import type { Place } from '../lib/placeApi';
import {
    mergedKindsNote,
    type PlannedRoute,
    routeSummary,
    routeTitle,
} from '../lib/routeApi';
import type { LocationFix } from '../platform';

type RoutePanelProps = {
    myLocation: LocationFix | null;
    locating: boolean;
    locationError: string | null;
    destination: Place | null;
    routes: RequestState<PlannedRoute[]>;
    chosen: number;
    onLocate: () => void;
    onFindRoutes: () => void;
    onChoose: (index: number) => void;
    onSearchDestination: () => void;
    onStart: () => void;
};

/** 길찾기 탭: 출발(내 위치)·도착, 경로 3종 중 고르기, 안내 시작 */
export default function RoutePanel({
    myLocation,
    locating,
    locationError,
    destination,
    routes,
    chosen,
    onLocate,
    onFindRoutes,
    onChoose,
    onSearchDestination,
    onStart,
}: RoutePanelProps) {
    const found =
        routes.status === 'success'
            ? routes.data
            : routes.status === 'loading'
              ? (routes.previous ?? [])
              : [];
    const canFind = destination !== null && routes.status !== 'loading';

    return (
        <div className="route-panel">
            <dl className="route-panel__endpoints">
                <div className="route-panel__endpoint">
                    <dt>출발</dt>
                    <dd>
                        {locating
                            ? '내 위치를 찾는 중'
                            : myLocation
                              ? `내 위치 (오차 약 ${Math.round(myLocation.accuracy)}m)`
                              : '내 위치를 아직 찾지 못했습니다'}
                    </dd>
                    <button
                        type="button"
                        className="route-panel__small"
                        disabled={locating}
                        onClick={onLocate}
                    >
                        다시 찾기
                    </button>
                </div>
                <div className="route-panel__endpoint">
                    <dt>도착</dt>
                    <dd>
                        {destination ? (
                            <>
                                {destination.name}
                                <span className="route-panel__address">
                                    {destination.address}
                                </span>
                            </>
                        ) : (
                            '목적지를 고르세요'
                        )}
                    </dd>
                    <button
                        type="button"
                        className="route-panel__small"
                        onClick={onSearchDestination}
                    >
                        {destination ? '바꾸기' : '검색'}
                    </button>
                </div>
            </dl>
            {locationError && (
                <p className="route-panel__error" role="alert">
                    {locationError}
                </p>
            )}

            <button
                type="button"
                className="route-panel__primary"
                disabled={!canFind}
                onClick={onFindRoutes}
            >
                {routes.status === 'loading' ? '경로를 찾는 중' : '경로 찾기'}
            </button>

            {routes.status === 'error' && (
                <p className="route-panel__error" role="alert">
                    {routes.message}
                </p>
            )}

            {found.length > 0 && (
                <>
                    <h3 className="route-panel__heading">
                        경로 {found.length}개
                    </h3>
                    <ol className="route-panel__options">
                        {found.map((route, index) => {
                            const note = mergedKindsNote(route);
                            return (
                                <li key={route.kinds.join(',')}>
                                    <button
                                        type="button"
                                        className="route-panel__option"
                                        aria-pressed={index === chosen}
                                        onClick={() => onChoose(index)}
                                    >
                                        <span className="route-panel__option-title">
                                            {routeTitle(route)}
                                        </span>
                                        <span className="route-panel__option-detail">
                                            {routeSummary(route)}
                                        </span>
                                        {note && (
                                            <span className="route-panel__option-note">
                                                {note}
                                            </span>
                                        )}
                                    </button>
                                </li>
                            );
                        })}
                    </ol>
                    <button
                        type="button"
                        className="route-panel__primary route-panel__start"
                        disabled={routes.status !== 'success'}
                        onClick={onStart}
                    >
                        {routeTitle(found[chosen] ?? found[0])}로 안내 시작
                    </button>
                </>
            )}
        </div>
    );
}
