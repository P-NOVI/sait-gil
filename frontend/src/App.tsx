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
import { listened, useAnnouncer } from './hooks/useAnnouncer';
import { useGuidance } from './hooks/useGuidance';
import { useDoubleTap } from './hooks/useDoubleTap';
import { useHeading } from './hooks/useHeading';
import { useRequest } from './hooks/useRequest';
import { useVision } from './hooks/useVision';
import { CROWD_ALERT_FROM } from './lib/accessibility';
import type { Alert } from './lib/alertArbiter';
import type { LngLat } from './lib/geo';
import { REROUTE_FAILED_KEY, shownFix } from './lib/guidance';
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
import { nearCrosswalk } from './lib/routeEvents';
import { nearForSearch } from './lib/searchNear';
import {
    cameraAnswer,
    CAMERA_PERMISSION_LATER_TEXT,
    CAMERA_PERMISSION_QUESTION,
    LOCATION_FOUND_TEXT,
    LOCATION_PERMISSION_LATER_TEXT,
    LOCATION_PERMISSION_QUESTION,
    NAVIGATION_COMMAND_HINT,
    navigationCommand,
    NOT_HEARD_TEXT,
    OPEN_CAMERA_SETTINGS_TEXT,
    OPEN_SETTINGS_TEXT,
    permissionAnswer,
    routeAnswer,
    routeAnswerHint,
    routeQuestion,
    SPEAK_PROMPT,
    VISION_DEFAULT_ON_TEXT,
    VISION_QUESTION,
} from './lib/voiceCommand';
import { VISION_OFF_TEXT, VISION_ON_TEXT } from './lib/visionAlerts';
import { isStandingStill } from './lib/walkSpeed';
import {
    canListen,
    canOpenAppSettings,
    getCurrentPosition,
    isLocationDenied,
    listenOnce,
    type LocationFix,
    openAppSettings,
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

/** 안내 중 경로를 다시 찾지 못했을 때. 하던 안내는 이어 간다. */
const keptRouteText = (message: string) =>
    `${message} 전 경로로 계속 안내합니다.`;

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
    const { announce, ask, buzz, silence, listening, busyFor, whenIdle } =
        useAnnouncer(settings);

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

    // 안내 중 알림을 알림 중재로 보낸다. useGuidance 가 아래에서 만들어져 ref 로 잇는다.
    const reportAlert = useRef<(alert: Alert) => void>(() => undefined);

    // 실패하면 화면에 띄우는 문장을 음성으로도 읽는다.
    // 안내 중 재탐색 실패는 다른 안내처럼 알림 중재를 거친다.
    const places = useRequest(requestPlaces, announce);
    const routes = useRequest(requestRoutes, (message) => {
        if (navigating) {
            reportAlert.current({
                key: REROUTE_FAILED_KEY,
                level: 'route',
                text: keptRouteText(message),
            });
        } else {
            announce(message);
        }
    });
    const whereAmI = useRequest(requestAddress, announce);

    // 지금 찾고 있는 내 위치. 검색이 위치보다 먼저 오면 이걸 기다린다.
    const pendingFix = useRef<Promise<LocationFix | null> | null>(null);

    const settle = useCallback(
        (pending: Promise<LocationFix>, onError?: (error: unknown) => void) => {
            const result: Promise<LocationFix | null> = pending
                .then(
                    (fix) => {
                        setMyLocation(fix);
                        setLocationError(null);
                        return fix;
                    },
                    (error: unknown) => {
                        setLocationError(errorMessage(error));
                        onError?.(error);
                        return null;
                    },
                )
                .finally(() => {
                    setLocating(false);
                    if (pendingFix.current === result) {
                        pendingFix.current = null;
                    }
                });
            pendingFix.current = result;
            return result;
        },
        [],
    );

    /** 내 위치를 찾는다. 못 찾으면 onError 로 이유를 넘긴다. */
    const findMe = (onError?: (error: unknown) => void) => {
        setLocating(true);
        return settle(getCurrentPosition(), onError);
    };

    // 위치 권한을 묻는 중이면 다시 묻지 않는다. 앱을 열 때와 버튼을 누를 때가 겹쳐도 한 번만 묻는다.
    const askingPermission = useRef(false);

    /**
     * 위치 권한이 꺼져 있다고 읽고 켤지 묻는다. "켜 줘"·"응"이라고 하면 권한 창을 다시 띄우고,
     * Android 가 더 묻지 않으면 앱 설정 화면을 연 뒤 돌아오면 다시 찾는다.
     */
    const askLocationPermission = async () => {
        if (askingPermission.current) {
            return;
        }
        askingPermission.current = true;
        try {
            const heard = await ask(LOCATION_PERMISSION_QUESTION);
            const answer =
                heard.status === 'heard' ? permissionAnswer(heard.text) : null;
            if (answer !== 'on') {
                if (listened(heard)) {
                    announce(LOCATION_PERMISSION_LATER_TEXT);
                }
                return;
            }
            let failure: unknown = null;
            const remember = (error: unknown) => {
                failure = error;
            };
            let fix = await findMe(remember);
            if (!fix && isLocationDenied(failure)) {
                announce(OPEN_SETTINGS_TEXT);
                await whenIdle();
                await openAppSettings().catch(() => undefined);
                fix = await findMe(remember);
            }
            announce(fix ? LOCATION_FOUND_TEXT : errorMessage(failure));
        } finally {
            askingPermission.current = false;
        }
    };

    /**
     * 내 위치를 못 찾은 이유를 읽는다. 앱에서 권한이 꺼져 있고 말로 대답할 수 있으면 켤지 묻는다.
     * 브라우저는 한 번 거절한 권한을 다시 묻지 않고 설정 화면도 열 수 없어 이유만 읽는다.
     */
    const tellLocationError = (error: unknown) => {
        if (
            isLocationDenied(error) &&
            canOpenAppSettings() &&
            settings.voice &&
            canListen()
        ) {
            void askLocationPermission();
        } else {
            announce(errorMessage(error));
        }
    };
    // 앱을 열 때 찾은 결과는 처음 한 번만 받으므로 최신 함수를 ref 로 넘긴다.
    const tellLocationErrorNow = useRef(tellLocationError);
    useEffect(() => {
        tellLocationErrorNow.current = tellLocationError;
    });

    useEffect(() => {
        // 음성 안내를 껐으면 announce 는 읽지 않고, 화면낭독기가 화면의 오류를 읽는다.
        void settle(getCurrentPosition(), (error) =>
            tellLocationErrorNow.current(error),
        );
    }, [settle]);

    const locate = () => {
        // iOS 는 버튼을 누른 순간에만 나침반 권한을 물을 수 있다.
        void requestCompassPermission();
        return findMe(tellLocationError);
    };

    /** 목적지 검색 기준 위치. 앱을 막 열어 내 위치를 찾는 중이면 알리고 기다린다. */
    const findNear = () =>
        nearForSearch(myLocation, pendingFix.current, (text) => announce(text));

    const found = useMemo(
        () =>
            routes.state.status === 'success'
                ? routes.state.data
                : routes.state.status === 'loading'
                  ? (routes.state.previous ?? [])
                  : [],
        [routes.state],
    );

    // 안내를 시작·종료할 때마다 늘린다. 지난 안내에서 늦게 온 대답은 버린다.
    const guidanceRun = useRef(0);
    const canAskByVoice = () =>
        settings.voice && canListen() && visionAvailable();

    // 사용자가 카메라 인식을 켜거나 끌 때마다 늘린다. 안내 시작 때 묻는 사이 직접 고른 것을 알아챈다.
    const visionChoice = useRef(0);

    /** 카메라 인식을 켜거나 끄고 알린다. */
    const switchVision = (on: boolean) => {
        visionChoice.current += 1;
        vision.setEnabled(on);
        announce(on ? VISION_ON_TEXT : VISION_OFF_TEXT);
    };

    const startGuidance = (route: PlannedRoute) => {
        offered.current = null;
        guidanceRun.current += 1;
        setGuided(route);
        const started = `${routeTitle(route)}로 안내를 시작합니다.`;
        if (canAskByVoice()) {
            // 켜짐 여부는 저장하지 않고 안내마다 묻는다. 끄려는 사람에게 권한 창·실패 안내가
            // 뜨지 않도록 대답을 듣기 전에는 카메라를 켜지 않는다.
            vision.setEnabled(false);
            void askVision(started);
        } else {
            vision.setEnabled(true);
            announce(started, 'route');
        }
    };

    /**
     * 안내 시작을 알리며 카메라 인식을 켤지 묻는다.
     * 대답이 없거나 못 알아들으면 안전을 위해 켜고 끄는 방법을 알려 준다.
     */
    const askVision = async (started: string) => {
        const run = guidanceRun.current;
        const choice = visionChoice.current;
        const heard = await ask(`${started} ${VISION_QUESTION}`);
        // 안내가 바뀌었거나, 묻는 사이 사용자가 버튼·말로 직접 고른 것은 덮지 않는다.
        if (guidanceRun.current !== run || visionChoice.current !== choice) {
            return;
        }
        const answer =
            heard.status === 'heard' ? cameraAnswer(heard.text) : null;
        if (answer) {
            switchVision(answer === 'on');
            return;
        }
        vision.setEnabled(true);
        if (listened(heard)) {
            // 위험 알림 등이 묻는 말을 끊었으면 그 알림을 덮지 않는다.
            announce(VISION_DEFAULT_ON_TEXT);
        }
    };

    /** 안내 중 말하기 버튼: 한 번 듣고 명령을 따른다. */
    const listenCommand = async () => {
        const run = guidanceRun.current;
        const heard = await ask(SPEAK_PROMPT);
        if (guidanceRun.current !== run) {
            return;
        }
        const command =
            heard.status === 'heard' ? navigationCommand(heard.text) : null;
        if (command) {
            switchVision(command.answer === 'on');
        } else if (listened(heard)) {
            announce(NAVIGATION_COMMAND_HINT);
        }
    };

    /** 찾은 경로를 읽고, 말로 고르거나 안내를 시작하게 한다. 못 알아들으면 한 번 더 묻는다. */
    const offerRoutes = async (result: PlannedRoute[]) => {
        if (result.length === 0) {
            announce(routesAnnouncement(result));
            return;
        }
        // 경로가 하나뿐이면 고를 것이 없으므로 요약을 읽지 않고 바로 안내를 시작한다.
        if (result.length === 1) {
            startGuidance(result[0]);
            return;
        }
        offered.current = result;
        const byVoice = settings.voice && canListen();
        let heard = await ask(
            routesAnnouncement(
                result,
                byVoice ? routeQuestion(result.length) : undefined,
            ),
        );
        let reply =
            heard.status === 'heard' ? routeAnswer(heard.text, result) : null;
        if (
            heard.status === 'heard' &&
            reply === null &&
            offered.current === result
        ) {
            heard = await ask(routeAnswerHint(result.length));
            reply =
                heard.status === 'heard'
                    ? routeAnswer(heard.text, result)
                    : null;
        }
        if (offered.current !== result) {
            return;
        }
        if (!reply) {
            if (listened(heard)) {
                announce(NOT_HEARD_TEXT);
            }
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

    // 도착하면 읽던 도착 안내는 끊지 않고 안내를 끝낸다.
    // 진행 중인 재탐색도 끊어 끝난 안내가 다시 시작되지 않게 한다.
    const arrive = () => {
        guidanceRun.current += 1;
        setGuided(null);
        whereAmI.reset();
        routes.reset();
    };

    const guidance = useGuidance({
        active: navigating,
        route: guided,
        announce,
        busyFor,
        whenIdle,
        onReroute: reroute,
        onArrive: arrive,
    });
    useEffect(() => {
        reportAlert.current = guidance.report;
    }, [guidance.report]);
    // 서 있는지는 경로 선에 붙이기 전의 GPS 위치(속력)로 본다.
    const gpsLocation = guidance.fix ?? myLocation;
    const atCrosswalk =
        guided !== null &&
        guidance.step !== null &&
        nearCrosswalk(guided.events, guidance.step.progress.travelledM);
    const vision = useVision({
        active: navigating,
        minLevel: CROWD_ALERT_FROM[settings.crowdSensitivity],
        atCrosswalk,
        // 횡단보도 근처에서 서 있으면 신호를 기다리는 중이다. 멈춰 있으면 속력이 오지 않을 수도 있다.
        waiting: atCrosswalk && isStandingStill(gpsLocation),
        // 안내 전에 찾은 오래된 위치(myLocation)의 속력이 새 값처럼 들어가지 않게 계속 갱신되는 안내 위치만 쓴다.
        walkFix: guidance.fix,
        report: guidance.report,
        buzz,
    });

    // 카메라 권한을 묻는 중이면 다시 묻지 않는다.
    const askingCameraPermission = useRef(false);

    /**
     * 카메라 권한이 거부되고 더 묻지 않는 상태라 실패 알림을 읽은 뒤, 설정 화면을 열지 묻는다. "응"이라고 하면 설정 화면을 열고,
     * 돌아오면 카메라를 다시 켜 본다.
     */
    const askCameraPermission = async () => {
        if (askingCameraPermission.current) {
            return;
        }
        askingCameraPermission.current = true;
        const run = guidanceRun.current;
        const choice = visionChoice.current;
        // 안내가 끝났거나, 묻는 사이 사용자가 카메라를 직접 켜고 끈 것은 덮지 않는다.
        const stale = () =>
            guidanceRun.current !== run || visionChoice.current !== choice;
        try {
            // 실패 알림이 끊기지 않게 다 읽은 뒤 묻는다.
            await whenIdle();
            const heard = await ask(CAMERA_PERMISSION_QUESTION);
            if (stale()) {
                return;
            }
            const answer =
                heard.status === 'heard' ? permissionAnswer(heard.text) : null;
            if (answer !== 'on') {
                if (listened(heard)) {
                    announce(CAMERA_PERMISSION_LATER_TEXT);
                }
                return;
            }
            announce(OPEN_CAMERA_SETTINGS_TEXT);
            await whenIdle();
            await openAppSettings().catch(() => undefined);
            if (!stale()) {
                vision.setEnabled(true);
            }
        } finally {
            askingCameraPermission.current = false;
        }
    };
    // 실패가 바뀔 때만 물으므로 최신 함수를 ref 로 넘긴다.
    const askCameraPermissionNow = useRef(askCameraPermission);
    useEffect(() => {
        askCameraPermissionNow.current = askCameraPermission;
    });
    // 시스템 창이 다시 뜨지 않는 거부(blocked)만 묻는다. 그냥 거부(denied)는 카메라를 다시 켜면 창이 뜬다.
    // 브라우저는 설정 화면을 열 수 없고, 음성 안내가 꺼져 있으면 말로 물을 수 없어 실패 알림만 읽는다.
    const cameraBlocked = vision.failure === 'blocked';
    useEffect(() => {
        if (
            cameraBlocked &&
            canOpenAppSettings() &&
            settings.voice &&
            canListen()
        ) {
            void askCameraPermissionNow.current();
        }
    }, [cameraBlocked, settings.voice]);
    const rerouting = routes.state.status === 'loading';
    // 안내 중 지도에 그릴 내 위치. 이탈이 확정되기 전에는 경로 선 위에 붙인다.
    // 새 객체를 매번 만들면 지도가 마커를 다시 그리므로 위치가 바뀔 때만 만든다.
    const guidedFix = useMemo(
        () => guidance.fix && shownFix(guidance.fix, guidance.step, rerouting),
        [guidance.fix, guidance.step, rerouting],
    );
    const shownLocation = guidedFix ?? myLocation;
    const heading = useHeading(shownLocation?.course ?? null);
    // 안내 중 화면 아무 곳이나 두 번 탭하면 말하기 버튼처럼 한 번 듣는다.
    useDoubleTap(navigating && canAskByVoice(), () => void listenCommand());

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
        guidanceRun.current += 1;
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
                follow={guidedFix?.position ?? null}
                onPathClick={guided ? undefined : setChosen}
            />
            {guided ? (
                <NavigationPanel
                    route={guided}
                    guidance={guidance}
                    rerouting={rerouting}
                    routeError={
                        routes.state.status === 'error'
                            ? keptRouteText(routes.state.message)
                            : null
                    }
                    whereAmI={whereAmI.state}
                    onRepeat={(text) => announce(text)}
                    onWhereAmI={() => void tellWhereIAm()}
                    onStop={stopGuidance}
                    onSpeak={
                        canAskByVoice() ? () => void listenCommand() : null
                    }
                    voice={settings.voice}
                    vision={
                        <VisionPanel
                            available={visionAvailable()}
                            frame={vision.frame}
                            enabled={vision.enabled}
                            failure={vision.failure}
                            onToggle={() => switchVision(!vision.enabled)}
                        />
                    }
                />
            ) : (
                <>
                    {tab === 'search' && (
                        <TopSearch
                            inputRef={searchInput}
                            results={places.state}
                            onFindNear={findNear}
                            onSearch={(query, near) => places.run(query, near)}
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
                        voice={settings.voice}
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
