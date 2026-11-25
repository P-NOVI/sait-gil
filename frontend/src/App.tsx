import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import HomeScreen from './components/HomeScreen';
import NavigationPanel from './components/NavigationPanel';
import OnboardingScreen from './components/OnboardingScreen';
import RoutePanel from './components/RoutePanel';
import Screen, { type ScreenName } from './components/Screen';
import SettingsPanel from './components/SettingsPanel';
import TopSearch, {
    type HereFix,
    type HomeSetup,
} from './components/TopSearch';
import VisionPanel from './components/VisionPanel';
import { useAccessibility } from './hooks/useAccessibility';
import { listened, useAnnouncer } from './hooks/useAnnouncer';
import { useGuidance } from './hooks/useGuidance';
import { useDoubleTap } from './hooks/useDoubleTap';
import { useHeading } from './hooks/useHeading';
import { useRequest } from './hooks/useRequest';
import { useSavedPlaces } from './hooks/useSavedPlaces';
import { useVision } from './hooks/useVision';
import { CROWD_ALERT_FROM } from './lib/accessibility';
import type { Alert } from './lib/alertArbiter';
import type { LngLat } from './lib/geo';
import { REROUTE_FAILED_KEY } from './lib/guidance';
import {
    type Address,
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
import {
    crossingBearing,
    facingCrossing,
    nearCrosswalk,
} from './lib/routeEvents';
import { samePlace } from './lib/savedPlaces';
import {
    DESTINATION_PROMPT,
    ONBOARDED_KEY,
    type OnboardingLine,
    PERMISSION_STEPS,
    runOnboarding,
    WELCOME_TEXT,
} from './lib/onboarding';
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
import { HOME_MAX_ACCURACY_M } from './settings';
import {
    canListen,
    canOpenAppSettings,
    getCurrentPosition,
    isLocationDenied,
    isNativeApp,
    listenOnce,
    type LocationFix,
    micPermitted,
    openAppSettings,
    readStored,
    requestAppPermission,
    requestCompassPermission,
    visionAvailable,
    watchCameraHeading,
    writeStored,
} from './platform';

const SCREEN_TITLES: Record<ScreenName, string> = {
    home: '사잇길',
    search: '목적지 찾기',
    route: '경로 선택',
    settings: '설정',
    'set-home': '집 등록',
};

/** 지금 화면과 뒤로 버튼이 돌아갈 화면들. 처음 화면으로 가면 비운다. */
type Navigation = { screen: ScreenName; history: ScreenName[] };

const TRY_TEXT = '음성과 진동으로 이렇게 알려 드립니다.';
const HOME_SAVED_TEXT =
    '집으로 저장했습니다. 첫 화면의 집 버튼을 누르면 바로 안내합니다.';
const HOME_CLEARED_TEXT = '집을 지웠습니다.';
/** 주소를 알 수 없을 때 지금 위치로 저장한 집의 이름 */
const HERE_NAME = '현재 위치';
const HERE_CHECKING_TEXT = '지금 위치의 주소를 확인합니다.';
const homeAccuracyText = (accuracyM: number) =>
    `위치 오차가 약 ${Math.round(accuracyM)}미터로 커서 정확하지 않을 수 있습니다. 밖으로 나가 다시 확인하면 더 정확합니다.`;
const DOUBLE_TAP_HINT = '화면을 두 번 누르면 말하기';
const SETTINGS_NOTE = '설정은 이 기기에만 저장합니다.';
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

/** 앱에서 처음 열었으면 시작 안내를 한다. 웹은 권한을 브라우저가 그때그때 묻는다. */
const needsOnboarding = () =>
    isNativeApp() && readStored(ONBOARDED_KEY) !== true;

function errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}

export default function App() {
    const [settings, updateSettings] = useAccessibility();
    const { announce, ask, buzz, silence, listening, busyFor, whenIdle } =
        useAnnouncer(settings);

    const [{ screen }, setNavigation] = useState<Navigation>({
        screen: 'home',
        history: [],
    });
    const searchInput = useRef<HTMLInputElement>(null);
    const saved = useSavedPlaces();
    // 묻고 듣는 사이 사용자가 다른 화면으로 갔는지 본다.
    const screenNow = useRef(screen);
    useEffect(() => {
        screenNow.current = screen;
    });

    // 앱을 처음 열 때 시작 안내 화면에 보이는 문장. 안내를 마치면 null
    const [onboardingLine, setOnboardingLine] = useState<OnboardingLine | null>(
        () => (needsOnboarding() ? { text: WELCOME_TEXT, step: null } : null),
    );
    // 앱을 열 때 첫 화면에서 들은 목적지. 목적지 찾기 화면이 한 번 찾고 지운다.
    const [spokenDestination, setSpokenDestination] = useState<string | null>(
        null,
    );
    const spokenUsed = useCallback(() => setSpokenDestination(null), []);
    // 말로 집 등록 화면에 왔으면 열자마자 할 일(지금 위치로 / 등록할 곳 묻기)
    const [homeOpenAction, setHomeOpenAction] = useState<HomeSetup | null>(
        null,
    );
    const homeOpenActionUsed = useCallback(() => setHomeOpenAction(null), []);

    // 출발은 항상 내 위치. 앱을 열면 바로 찾는다.
    const [myLocation, setMyLocation] = useState<LocationFix | null>(null);
    const [locating, setLocating] = useState(true);
    const [locationError, setLocationError] = useState<string | null>(null);

    const [destination, setDestination] = useState<Place | null>(null);
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

    // 안내를 시작하면 목적지를 최근 간 곳에 남긴다.
    const { addRecent } = saved;
    useEffect(() => {
        if (navigating && destination) {
            addRecent(destination);
        }
    }, [navigating, destination, addRecent]);

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
        whereAmI.reset();
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

    /** 내 위치에서 goal 까지 경로를 찾는다. 내 위치를 못 찾았거나 실패하면 null */
    const routesTo = async (goal: Place) => {
        offered.current = null;
        const start = myLocation?.position ?? (await locate())?.position;
        if (!start) {
            return null;
        }
        const result = await routes.run({
            start,
            end: goal.position,
            endName: goal.name,
        });
        if (result) {
            setChosen(0);
        }
        return result;
    };

    /** 경로를 찾아 읽고 고르게 한다. */
    const findRoutes = async (goal: Place) => {
        const result = await routesTo(goal);
        if (result) {
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
    // 목걸이에 건 휴대폰 카메라가 보는 방향. 걸을 때는 GPS 진행 방향으로 나침반을 바로잡는다.
    const cameraHeading = useHeading(
        guidance.fix?.course ?? null,
        watchCameraHeading,
    );
    const crossing =
        guided !== null && guidance.step !== null
            ? crossingBearing(
                  guided,
                  guided.events,
                  guidance.step.progress.travelledM,
              )
            : null;
    const vision = useVision({
        active: navigating,
        minLevel: CROWD_ALERT_FROM[settings.crowdSensitivity],
        atCrosswalk,
        facingCrossing: facingCrossing(cameraHeading, crossing),
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
            if (stale()) {
                return;
            }
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
    // blocked 인 채로 음성 안내를 켜면 새 실패가 없어도 그때 묻는다.
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
    // 안내 중 화면 아무 곳이나 두 번 탭하면 말하기 버튼처럼 한 번 듣는다.
    useDoubleTap(navigating && canAskByVoice(), () => void listenCommand());

    const goTo = (next: ScreenName) => {
        // 경로 선택 화면을 떠나면 경로를 묻던 것은 그만 듣는다.
        if (next !== 'route') {
            offered.current = null;
        }
        // 집 등록과 목적지 찾기는 검색 결과를 함께 쓰지 않는다.
        if (next === 'set-home' || screen === 'set-home') {
            places.reset();
        }
        setNavigation((now) =>
            now.screen === next
                ? now
                : {
                      screen: next,
                      history:
                          next === 'home' ? [] : [...now.history, now.screen],
                  },
        );
    };

    /** 지금 화면을 기록에 남기지 않고 다른 화면으로 바꾼다. 뒤로 가면 지금 화면 전 화면으로 간다. */
    const replaceWith = (next: ScreenName) => {
        offered.current = null;
        places.reset();
        setNavigation((now) => ({ screen: next, history: now.history }));
    };

    const goBack = () => {
        offered.current = null;
        if (screen === 'set-home') {
            places.reset();
        }
        setNavigation((now) => ({
            screen: now.history.at(-1) ?? 'home',
            history: now.history.slice(0, -1),
        }));
    };

    const pickPlace = (place: Place) => {
        setDestination(place);
        goTo('route');
        void findRoutes(place);
    };

    /** 집 버튼: 집까지 경로를 찾아 고르지 않고 추천 경로로 바로 안내한다. */
    const goHome = async (home: Place) => {
        setDestination(home);
        goTo('route');
        const result = await routesTo(home);
        if (!result) {
            return;
        }
        if (result.length === 0) {
            announce(routesAnnouncement(result));
            return;
        }
        startGuidance(result[0]);
    };

    const saveHome = (place: Place) => {
        saved.setHome(place);
        announce(HOME_SAVED_TEXT);
        goBack();
    };

    /** 집 등록 화면: 지금 위치와 주소를 알아낸다. 위치를 못 찾으면 locate 가 이유를 알리고 null. */
    const findHere = async (): Promise<HereFix | null> => {
        announce(
            saved.home
                ? `지금 집은 ${saved.home.name}입니다. ${HERE_CHECKING_TEXT}`
                : HERE_CHECKING_TEXT,
        );
        const fix = await locate();
        if (!fix) {
            return null;
        }
        let address: Address | null = null;
        try {
            address = await findAddress(fix.position);
        } catch {
            // 주소를 못 찾아도 좌표로 집을 저장한다.
        }
        // 도로명 주소(신주소) 하나만 쓴다. 이름과 주소를 같게 두면 읽고 보여 줄 때 한 번만 나온다.
        const shown = address?.road_address || address?.full_address || '';
        const place = {
            name: shown || HERE_NAME,
            address: shown,
            position: fix.position,
            distance_m: null,
        };
        return fix.accuracy > HOME_MAX_ACCURACY_M
            ? { place, note: homeAccuracyText(fix.accuracy) }
            : { place };
    };

    const clearHome = () => {
        saved.setHome(null);
        announce(HOME_CLEARED_TEXT);
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

    /** 내 위치를 새로 찾고 그곳의 주소를 읽는다. */
    const tellHere = async () => {
        const fix = await locate();
        if (!fix) {
            return;
        }
        const text = await whereAmI.run(fix.position);
        if (text) {
            announce(text);
        }
    };

    /**
     * 앱을 열 때. 처음 열면 시작 안내를 읽으며 위치·마이크·카메라·신체 활동 권한을 차례로 묻는다.
     * 그다음 내 위치를 찾고, 음성 안내를 켰고 마이크를 쓸 수 있으면 첫 화면에서 어디로 갈지 묻는다.
     * 알아들으면 목적지 찾기 화면에서 그 말로 찾는다.
     */
    const startUp = async () => {
        let locationDenied = false;
        if (needsOnboarding()) {
            const say = async (line: OnboardingLine) => {
                setOnboardingLine(line);
                announce(line.text);
                await whenIdle();
            };
            const denied = await runOnboarding(say, requestAppPermission);
            setOnboardingLine(null);
            writeStored(ONBOARDED_KEY, true);
            locationDenied = denied.includes('location');
        }
        if (locationDenied) {
            // 방금 거절한 위치 권한을 바로 다시 묻지 않는다. 내 위치 듣기로 다시 켤 수 있다.
            setLocating(false);
            setLocationError(LOCATION_PERMISSION_LATER_TEXT);
        } else {
            // 음성 안내를 껐으면 announce 는 읽지 않고, 화면낭독기가 화면의 오류를 읽는다.
            void settle(getCurrentPosition(), (error) =>
                tellLocationErrorNow.current(error),
            );
        }
        if (!isNativeApp() || !settings.voice || !(await micPermitted())) {
            return;
        }
        const heard = await ask(DESTINATION_PROMPT);
        // 묻는 사이 다른 화면으로 갔으면 대답을 버린다.
        if (heard.status === 'heard' && screenNow.current === 'home') {
            setSpokenDestination(heard.text);
            goTo('search');
        }
    };
    const startUpNow = useRef(startUp);
    useEffect(() => {
        startUpNow.current = startUp;
    });
    // 개발 모드에서 효과가 두 번 불려도 한 번만 시작한다.
    const startedUp = useRef(false);
    useEffect(() => {
        if (!startedUp.current) {
            startedUp.current = true;
            void startUpNow.current();
        }
    }, []);

    const myLocationText = locating
        ? '내 위치 찾는 중'
        : myLocation
          ? `내 위치 · 오차 ${Math.round(myLocation.accuracy)}m`
          : '내 위치를 찾지 못함';

    /** 화면 맨 아래 상태 한 줄 */
    const screenStatus = (): string => {
        switch (screen) {
            case 'home':
                return myLocationText;
            case 'search':
            case 'set-home':
                if (places.state.status === 'loading') {
                    return '검색 중';
                }
                if (places.state.status === 'success') {
                    return `검색 결과 ${places.state.data.length}곳`;
                }
                return screen === 'set-home'
                    ? '고른 곳을 집으로 저장합니다'
                    : '말하거나 입력해서 찾으세요';
            case 'route':
                return `출발: ${myLocationText}`;
            case 'settings':
                return SETTINGS_NOTE;
        }
    };

    const chooseScreen = () => {
        if (screen === 'home') {
            const home = saved.home;
            return (
                <Screen title={SCREEN_TITLES.home} status={screenStatus()}>
                    <HomeScreen
                        home={home}
                        recent={saved.recent.filter(
                            (place) => !home || !samePlace(place, home),
                        )}
                        locating={locating}
                        locationError={locationError}
                        whereAmI={whereAmI.state}
                        onSearch={() => goTo('search')}
                        onPick={pickPlace}
                        onGoHome={(home) => void goHome(home)}
                        onSetHome={() => goTo('set-home')}
                        onWhereAmI={() => void tellHere()}
                        onSettings={() => goTo('settings')}
                        voice={settings.voice}
                    />
                </Screen>
            );
        }
        const body =
            screen === 'search' || screen === 'set-home' ? (
                <TopSearch
                    // 목적지 찾기와 집 등록이 검색어·확인 중인 결과를 함께 쓰지 않게 따로 그린다.
                    key={screen}
                    inputRef={searchInput}
                    results={places.state}
                    onFindNear={findNear}
                    onSearch={(query, near) => places.run(query, near)}
                    onListen={listenOnce}
                    onPick={screen === 'set-home' ? saveHome : pickPlace}
                    onAnnounce={(text) => announce(text)}
                    onAsk={ask}
                    voice={settings.voice}
                    purpose={screen === 'set-home' ? 'home' : 'go'}
                    home={saved.home}
                    onGoHome={
                        screen === 'search'
                            ? (home) => void goHome(home)
                            : undefined
                    }
                    onUseHere={findHere}
                    onClearHome={clearHome}
                    onRegisterHome={
                        screen === 'search'
                            ? (action) => {
                                  setHomeOpenAction(action);
                                  // 저장하고 돌아올 때 검색 화면이 아니라 첫 화면으로 가게 검색 화면을 대신한다.
                                  replaceWith('set-home');
                              }
                            : undefined
                    }
                    openAction={screen === 'set-home' ? homeOpenAction : null}
                    onOpenActionUsed={homeOpenActionUsed}
                    locating={locating}
                    spoken={screen === 'search' ? spokenDestination : null}
                    onSpokenUsed={spokenUsed}
                />
            ) : screen === 'route' ? (
                <RoutePanel
                    locating={locating}
                    locationError={locationError}
                    destination={destination}
                    routes={routes.state}
                    chosen={chosen}
                    onLocate={() => void locate()}
                    onFindRoutes={() =>
                        destination && void findRoutes(destination)
                    }
                    onChoose={setChosen}
                    onSearchDestination={() => goTo('search')}
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
                    home={saved.home}
                    onSetHome={() => goTo('set-home')}
                    onClearHome={clearHome}
                />
            );
        return (
            <Screen
                title={SCREEN_TITLES[screen]}
                onBack={goBack}
                onHome={() => goTo('home')}
                status={screenStatus()}
            >
                {body}
            </Screen>
        );
    };

    return (
        <div className="app">
            {/* 화면낭독기가 읽으면 마이크에 들어가므로 화면에만 보인다. */}
            {listening && (
                <p className="voice-listening" aria-hidden="true">
                    듣고 있어요. 말씀하세요.
                </p>
            )}
            {onboardingLine ? (
                <OnboardingScreen
                    line={onboardingLine}
                    total={PERMISSION_STEPS.length}
                    voice={settings.voice}
                />
            ) : guided ? (
                <Screen
                    title="길안내"
                    status={
                        canAskByVoice()
                            ? DOUBLE_TAP_HINT
                            : `${routeTitle(guided)} 안내 중`
                    }
                >
                    <NavigationPanel
                        route={guided}
                        destinationName={
                            destination?.name ?? routeTitle(guided)
                        }
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
                </Screen>
            ) : (
                chooseScreen()
            )}
        </div>
    );
}
