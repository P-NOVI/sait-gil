import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import BottomSheet from './components/BottomSheet';
import MapView from './components/MapView';
import MenuBar, { type Tab } from './components/MenuBar';
import MyLocationControl from './components/MyLocationControl';
import NavigationPanel from './components/NavigationPanel';
import RoutePanel from './components/RoutePanel';
import SettingsPanel from './components/SettingsPanel';
import TopSearch from './components/TopSearch';
import VisionPanel from './components/VisionPanel';
import { useAccessibility } from './hooks/useAccessibility';
import { useAnnouncer } from './hooks/useAnnouncer';
import { useGuidance } from './hooks/useGuidance';
import { useHeading } from './hooks/useHeading';
import { useRequest } from './hooks/useRequest';
import type { LngLat } from './lib/geo';
import {
    findAddress,
    type Place,
    searchPlaces,
    spokenAddress,
} from './lib/placeApi';
import {
    fetchRoutes,
    type PlannedRoute,
    type RouteRequest,
    routesAnnouncement,
    routeTitle,
    sameKindRoute,
} from './lib/routeApi';
import { ROUTE_ANSWER_HINT, routeAnswer } from './lib/voiceCommand';
import {
    canListen,
    getCurrentPosition,
    listenOnce,
    type LocationFix,
    requestCompassPermission,
    visionAvailable,
} from './platform';

const SHEET_TITLES: Record<Exclude<Tab, 'search'>, string> = {
    route: '길찾기',
    settings: '접근성 설정',
};

const TRY_TEXT = '음성과 진동으로 이렇게 알려 드립니다.';
const NO_ADDRESS_TEXT = '이곳의 주소를 찾지 못했습니다.';
const NO_LOCATION_TEXT = '내 위치를 아직 찾지 못했습니다.';

const requestPlaces = (
    signal: AbortSignal,
    query: string,
    near: LngLat | null,
) => searchPlaces(query, near, signal);

const requestRoutes = (signal: AbortSignal, request: RouteRequest) =>
    fetchRoutes(request, signal);

const requestAddress = async (signal: AbortSignal, position: LngLat) => {
    const address = await findAddress(position, signal);
    return address ? spokenAddress(address) : NO_ADDRESS_TEXT;
};

function errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}

export default function App() {
    const [settings, updateSettings] = useAccessibility();
    const { announce, ask, silence, listening } = useAnnouncer(settings);

    const [tab, setTab] = useState<Tab>('search');
    const [sheetOpen, setSheetOpen] = useState(true);
    const searchInput = useRef<HTMLInputElement>(null);

    // 출발은 항상 내 위치. 앱을 열면 바로 찾는다.
    const [myLocation, setMyLocation] = useState<LocationFix | null>(null);
    const [locating, setLocating] = useState(true);
    const [locationError, setLocationError] = useState<string | null>(null);

    const [destination, setDestination] = useState<Place | null>(null);
    // 말로 찾은 결과 중 확인하고 있는 곳. 지도에 핀을 꽂고 그리로 옮긴다.
    const [preview, setPreview] = useState<Place | null>(null);
    const [chosen, setChosen] = useState(0);
    // 말로 대답이 왔을 때 쓸 지금 고른 경로와 묻고 있는 경로 목록.
    // 목록이 바뀌었거나 안내를 시작했으면 늦게 온 대답은 버린다.
    const chosenNow = useRef(chosen);
    const offered = useRef<PlannedRoute[] | null>(null);
    useEffect(() => {
        chosenNow.current = chosen;
    }, [chosen]);
    // 안내 중인 경로. 경로를 다시 찾으면 바뀐다.
    const [guided, setGuided] = useState<PlannedRoute | null>(null);
    const navigating = guided !== null;

    const places = useRequest(requestPlaces);
    const routes = useRequest(requestRoutes);
    const whereAmI = useRequest(requestAddress);

    const settle = useCallback(
        (pending: Promise<LocationFix>) =>
            pending
                .then(
                    (fix) => {
                        setMyLocation(fix);
                        setLocationError(null);
                        return fix;
                    },
                    (error: unknown) => {
                        setLocationError(errorMessage(error));
                        return null;
                    },
                )
                .finally(() => setLocating(false)),
        [],
    );

    useEffect(() => {
        void settle(getCurrentPosition());
    }, [settle]);

    const locate = () => {
        // iOS 는 버튼을 누른 순간에만 나침반 권한을 물을 수 있다.
        void requestCompassPermission();
        setLocating(true);
        return settle(getCurrentPosition());
    };

    const found = useMemo(
        () =>
            routes.state.status === 'success'
                ? routes.state.data
                : routes.state.status === 'loading'
                  ? (routes.state.previous ?? [])
                  : [],
        [routes.state],
    );

    const startGuidance = (route: PlannedRoute) => {
        offered.current = null;
        setGuided(route);
        announce(`${routeTitle(route)}로 안내를 시작합니다.`, 'route');
    };

    /** 찾은 경로를 읽고, 말로 고르거나 안내를 시작하게 한다. 못 알아들으면 한 번 더 묻는다. */
    const offerRoutes = async (result: PlannedRoute[]) => {
        if (result.length === 0) {
            announce(routesAnnouncement(result));
            return;
        }
        offered.current = result;
        const byVoice = settings.voice && canListen();
        let heard = await ask(
            routesAnnouncement(result, byVoice ? ROUTE_ANSWER_HINT : undefined),
        );
        let reply = heard === null ? null : routeAnswer(heard, result);
        if (heard !== null && reply === null && offered.current === result) {
            heard = await ask(ROUTE_ANSWER_HINT);
            reply = heard === null ? null : routeAnswer(heard, result);
        }
        if (!reply || offered.current !== result) {
            return;
        }
        if (reply.action === 'repeat') {
            void offerRoutes(result);
            return;
        }
        const index = reply.index ?? chosenNow.current;
        const route = result[index];
        if (route) {
            setChosen(index);
            startGuidance(route);
        }
    };

    const findRoutes = async (goal: Place) => {
        offered.current = null;
        const start = myLocation?.position ?? (await locate())?.position;
        if (!start) {
            return;
        }
        const result = await routes.run({
            start,
            end: goal.position,
            endName: goal.name,
        });
        if (result) {
            setChosen(0);
            void offerRoutes(result);
        }
    };

    // 경로를 벗어나면 지금 위치에서 같은 기준(덜 붐비는 길 등)의 경로를 다시 찾는다.
    const reroute = useCallback(
        async (position: LngLat) => {
            if (!guided || !destination) {
                return;
            }
            const result = await routes.run({
                start: position,
                end: destination.position,
                endName: destination.name,
            });
            const next = result && sameKindRoute(result, guided.kinds[0]);
            if (result && next) {
                setChosen(result.indexOf(next));
                setGuided(next);
                announce(
                    `경로를 다시 찾았습니다. ${routeTitle(next)}로 안내합니다.`,
                    'route',
                );
            }
        },
        [guided, destination, routes, announce],
    );

    const guidance = useGuidance({
        active: navigating,
        route: guided,
        announce,
        onReroute: reroute,
    });
    const shownLocation = guidance.fix ?? myLocation;
    const heading = useHeading(shownLocation?.course ?? null);

    const pickPlace = (place: Place) => {
        setPreview(null);
        setDestination(place);
        setTab('route');
        setSheetOpen(true);
        void findRoutes(place);
    };

    const selectTab = (next: Tab) => {
        // 검색 탭을 한 번 더 누르면 검색창으로 간다.
        if (next === 'search' && tab === 'search') {
            searchInput.current?.focus();
        }
        // 길찾기 탭을 떠나면 경로를 묻던 것은 그만 듣는다.
        if (next !== 'route') {
            offered.current = null;
        }
        setTab(next);
        setSheetOpen(true);
    };

    const stopGuidance = () => {
        silence();
        setGuided(null);
        whereAmI.reset();
    };

    const tellWhereIAm = async () => {
        const position = guidance.fix?.position ?? myLocation?.position;
        if (!position) {
            announce(NO_LOCATION_TEXT);
            return;
        }
        const text = await whereAmI.run(position);
        if (text) {
            announce(text);
        }
    };

    const paths = useMemo(
        () => (guided ? [guided.coordinates] : found.map((r) => r.coordinates)),
        [guided, found],
    );

    const sheet =
        tab === 'route' ? (
            <RoutePanel
                myLocation={myLocation}
                locating={locating}
                locationError={locationError}
                destination={destination}
                routes={routes.state}
                chosen={chosen}
                onLocate={() => void locate()}
                onFindRoutes={() => destination && void findRoutes(destination)}
                onChoose={setChosen}
                onSearchDestination={() => selectTab('search')}
                onStart={() => {
                    const route = found[chosen];
                    if (route) {
                        startGuidance(route);
                    }
                }}
            />
        ) : (
            <SettingsPanel
                settings={settings}
                onChange={updateSettings}
                onTry={() => announce(TRY_TEXT, 'route')}
            />
        );

    return (
        <div
            className="app"
            data-tab={tab}
            data-sheet={
                navigating || tab === 'search'
                    ? 'none'
                    : sheetOpen
                      ? 'open'
                      : 'collapsed'
            }
            data-navigating={navigating || undefined}
        >
            <h1 className="visually-hidden">사잇길</h1>
            {/* 화면낭독기가 읽으면 마이크에 들어가므로 화면에만 보인다. */}
            {listening && (
                <p className="voice-listening" aria-hidden="true">
                    듣고 있어요. 말씀하세요.
                </p>
            )}
            <MapView
                paths={paths}
                chosen={guided ? 0 : chosen}
                goal={preview?.position ?? destination?.position ?? null}
                preview={preview?.position ?? null}
                myLocation={shownLocation}
                heading={heading}
                follow={guidance.fix?.position ?? null}
                onPathClick={guided ? undefined : setChosen}
            />
            {guided ? (
                <NavigationPanel
                    route={guided}
                    guidance={guidance}
                    rerouting={routes.state.status === 'loading'}
                    routeError={
                        routes.state.status === 'error'
                            ? routes.state.message
                            : null
                    }
                    whereAmI={whereAmI.state}
                    onRepeat={(text) => announce(text)}
                    onWhereAmI={() => void tellWhereIAm()}
                    onStop={stopGuidance}
                    voice={settings.voice}
                    vision={
                        <VisionPanel
                            available={visionAvailable()}
                            frame={null}
                        />
                    }
                />
            ) : (
                <>
                    {tab === 'search' && (
                        <TopSearch
                            inputRef={searchInput}
                            results={places.state}
                            onSearch={(query) =>
                                places.run(query, myLocation?.position ?? null)
                            }
                            onListen={listenOnce}
                            onPick={pickPlace}
                            onPreview={setPreview}
                            onAnnounce={(text) => announce(text)}
                            onAsk={ask}
                            voice={settings.voice}
                        />
                    )}
                    <MyLocationControl
                        locating={locating}
                        error={tab === 'route' ? null : locationError}
                        onLocate={() => void locate()}
                    />
                    {tab !== 'search' && (
                        <BottomSheet
                            title={SHEET_TITLES[tab]}
                            open={sheetOpen}
                            onOpenChange={setSheetOpen}
                        >
                            {sheet}
                        </BottomSheet>
                    )}
                    <MenuBar tab={tab} onSelect={selectTab} />
                </>
            )}
        </div>
    );
}
