import type { ReactNode } from 'react';

import type { Guidance } from '../hooks/useGuidance';
import type { RequestState } from '../hooks/useRequest';
import { ARRIVED_TEXT, upcomingText } from '../lib/guidanceText';
import { distanceLabel, type PlannedRoute, routeTitle } from '../lib/routeApi';

type NavigationPanelProps = {
    route: PlannedRoute;
    guidance: Guidance;
    rerouting: boolean;
    /** 경로를 다시 찾지 못했을 때의 이유. 전 경로로 계속 안내한다. */
    routeError: string | null;
    whereAmI: RequestState<string>;
    /** 지금 상황 문장을 다시 읽는다. */
    onRepeat: (text: string) => void;
    onWhereAmI: () => void;
    onStop: () => void;
    /** 음성 안내를 켰으면 화면낭독기가 같은 문장을 또 읽지 않게 한다. */
    voice: boolean;
    /** 카메라 인파 인식 자리 */
    vision: ReactNode;
};

/** 지금 상황을 한 문장으로. 화면에 크게 보이고 다시 듣기에 쓴다. */
function situation(
    route: PlannedRoute,
    { step, error }: Guidance,
    rerouting: boolean,
): string {
    if (rerouting) {
        return '경로를 다시 찾는 중입니다.';
    }
    if (!step) {
        return error ?? '내 위치를 찾는 중입니다.';
    }
    switch (step.judgement) {
        case 'arrived':
            return ARRIVED_TEXT;
        case 'off_route':
            return '경로를 벗어났습니다.';
        case 'uncertain':
            return '위치가 정확하지 않아 잠시 기다립니다.';
        case 'on_route':
            return (
                upcomingText(route.events, step.progress.travelledM) ??
                '경로를 따라 계속 가세요.'
            );
    }
}

/** 길안내 중 화면: 다음 안내, 남은 거리, 다시 듣기·내 위치·종료, 인파 인식 자리 */
export default function NavigationPanel({
    route,
    guidance,
    rerouting,
    routeError,
    whereAmI,
    onRepeat,
    onWhereAmI,
    onStop,
    voice,
    vision,
}: NavigationPanelProps) {
    const now = situation(route, guidance, rerouting);
    const remainingM = guidance.step?.progress.remainingM ?? route.distance_m;

    return (
        <section className="navigation-panel" aria-labelledby="navigation-now">
            <p className="navigation-panel__route">
                <span>{routeTitle(route)} 안내 중</span>
                <span>남은 거리 {distanceLabel(remainingM)}</span>
            </p>
            <h2
                id="navigation-now"
                className="navigation-panel__now"
                aria-live={voice ? 'off' : 'polite'}
            >
                {now}
            </h2>
            {guidance.lastAlert && guidance.lastAlert !== now && (
                <p className="navigation-panel__last">
                    마지막 안내: {guidance.lastAlert}
                </p>
            )}
            {guidance.error && guidance.step && (
                <p className="navigation-panel__error" role="alert">
                    {guidance.error}
                </p>
            )}
            {routeError && (
                <p className="navigation-panel__error" role="alert">
                    {routeError} 전 경로로 계속 안내합니다.
                </p>
            )}

            {vision}

            <div className="navigation-panel__actions">
                <button type="button" onClick={() => onRepeat(now)}>
                    다시 듣기
                </button>
                <button
                    type="button"
                    disabled={whereAmI.status === 'loading'}
                    onClick={onWhereAmI}
                >
                    {whereAmI.status === 'loading'
                        ? '주소 찾는 중'
                        : '내 위치 말하기'}
                </button>
                <button
                    type="button"
                    className="navigation-panel__stop"
                    onClick={onStop}
                >
                    안내 종료
                </button>
            </div>
            {whereAmI.status === 'success' && (
                <p className="navigation-panel__address">{whereAmI.data}</p>
            )}
            {whereAmI.status === 'error' && (
                <p className="navigation-panel__error" role="alert">
                    {whereAmI.message}
                </p>
            )}
        </section>
    );
}
