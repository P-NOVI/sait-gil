import type { RequestState } from '../hooks/useRequest';
import type { Place } from '../lib/placeApi';
import {
    mergedKindsNote,
    type PlannedRoute,
    routeSummary,
    routeTitle,
} from '../lib/routeApi';
import Icon from './Icon';

type RoutePanelProps = {
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

/** 경로 선택: 목적지, 경로 3종 중 고르기, 안내 시작. 출발은 늘 내 위치다. */
export default function RoutePanel({
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
    const loading = routes.status === 'loading';
    // 경로를 못 찾았거나 아직 찾지 않았으면 다시 찾는 버튼을 둔다.
    const canRetry = destination !== null && !loading && found.length === 0;

    if (!destination) {
        return (
            <div className="route">
                <p className="message">목적지를 먼저 고르세요.</p>
                <button
                    type="button"
                    className="button button--primary"
                    onClick={onSearchDestination}
                >
                    <Icon name="search" />
                    목적지 찾기
                </button>
            </div>
        );
    }

    return (
        <div className="route">
            <p className="route__goal">
                목적지: {destination.name}
                <span className="route__address">{destination.address}</span>
            </p>
            {locationError && (
                <>
                    <p className="message message--error" role="alert">
                        {locationError}
                    </p>
                    <button
                        type="button"
                        className="button"
                        disabled={locating}
                        onClick={onLocate}
                    >
                        {locating ? '위치 찾는 중' : '내 위치 다시 찾기'}
                    </button>
                </>
            )}
            {routes.status === 'error' && (
                <p className="message message--error" role="alert">
                    {routes.message}
                </p>
            )}
            {loading && found.length === 0 && (
                <p className="message">경로를 찾는 중입니다.</p>
            )}
            {found.length > 0 && (
                <ol className="list" aria-label={`경로 ${found.length}개`}>
                    {found.map((route, index) => {
                        const note = mergedKindsNote(route);
                        return (
                            <li key={route.kinds.join(',')}>
                                <button
                                    type="button"
                                    className="row"
                                    aria-pressed={index === chosen}
                                    onClick={() => onChoose(index)}
                                >
                                    <span className="row__main">
                                        <span className="row__name">
                                            {routeTitle(route)}
                                        </span>
                                        <span className="row__detail">
                                            {routeSummary(route)}
                                        </span>
                                        {note && (
                                            <span className="row__detail">
                                                {note}
                                            </span>
                                        )}
                                    </span>
                                    {index === chosen && <Icon name="check" />}
                                </button>
                            </li>
                        );
                    })}
                </ol>
            )}
            {canRetry && (
                <button type="button" className="button" onClick={onFindRoutes}>
                    경로 다시 찾기
                </button>
            )}
            {found.length > 0 && (
                <button
                    type="button"
                    className="button button--primary route__start"
                    disabled={routes.status !== 'success'}
                    onClick={onStart}
                >
                    {routeTitle(found[chosen] ?? found[0])}로 안내 시작
                </button>
            )}
        </div>
    );
}
