import type { ReactNode } from 'react';

import type { Guidance } from '../hooks/useGuidance';
import type { RequestState } from '../hooks/useRequest';
import { ARRIVED_TEXT, eventLabel, upcomingText } from '../lib/guidanceText';
import {
    distanceLabel,
    type PlannedRoute,
    remainingMinutes,
} from '../lib/routeApi';
import { upcomingEvents } from '../lib/routeEvents';
import { UPCOMING_EVENTS_SHOWN } from '../settings';

type NavigationPanelProps = {
    route: PlannedRoute;
    destinationName: string;
    guidance: Guidance;
    rerouting: boolean;
    /** 경로를 다시 찾지 못했을 때의 이유와 전 경로로 계속 안내한다는 말 */
    routeError: string | null;
    whereAmI: RequestState<string>;
    /** 지금 상황 문장을 다시 읽는다. */
    onRepeat: (text: string) => void;
    onWhereAmI: () => void;
    onStop: () => void;
    /** 한 번 듣고 명령("카메라 꺼")을 따른다. 말로 할 수 없으면 null 이고 버튼을 숨긴다. */
    onSpeak: (() => void) | null;
    /** 음성 안내를 켰으면 화면낭독기가 같은 문장을 또 읽지 않게 한다. */
    voice: boolean;
    /** 카메라 인식 끄기·켜기 버튼 */
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
    if (step.offRoute) {
        return '경로를 벗어났습니다.';
    }
    switch (step.judgement) {
        case 'arrived':
            return ARRIVED_TEXT;
        case 'uncertain':
            return '위치가 정확하지 않아 잠시 기다립니다.';
        // 이탈이 확정되기 전에는 위치가 잠깐 튄 것으로 보고 경로 안내를 그대로 둔다.
        case 'off_route':
        case 'on_route':
            return (
                upcomingText(route.events, step.progress.travelledM) ??
                '경로를 따라 계속 가세요.'
            );
    }
}

/** 길안내 화면: 목적지와 남은 거리, 지금 안내, 다음 안내, 카메라 인식, 말하기·다시 듣기·내 위치·종료 */
export default function NavigationPanel({
    route,
    destinationName,
    guidance,
    rerouting,
    routeError,
    whereAmI,
    onRepeat,
    onWhereAmI,
    onStop,
    onSpeak,
    voice,
    vision,
}: NavigationPanelProps) {
    const now = situation(route, guidance, rerouting);
    const travelledM = guidance.step?.progress.travelledM ?? 0;
    const remainingM = guidance.step?.progress.remainingM ?? route.distance_m;
    const next = upcomingEvents(
        route.events,
        travelledM,
        UPCOMING_EVENTS_SHOWN,
    );

    return (
        <div className="navigation">
            <div className="navigation__goal">
                <p className="navigation__destination">
                    목적지: {destinationName}
                </p>
                <p className="navigation__remaining">
                    남은 거리 {distanceLabel(remainingM)} · 약{' '}
                    {remainingMinutes(route, remainingM)}분
                </p>
            </div>
            <h2
                className="navigation__now"
                aria-live={voice ? 'off' : 'polite'}
            >
                {now}
            </h2>
            {guidance.lastAlert && guidance.lastAlert !== now && (
                <p className="navigation__note">
                    마지막 안내: {guidance.lastAlert}
                </p>
            )}
            {guidance.error && guidance.step && (
                <p className="message message--error" role="alert">
                    {guidance.error}
                </p>
            )}
            {routeError && (
                <p className="message message--error" role="alert">
                    {routeError}
                </p>
            )}
            {next.length > 0 && (
                <ol className="list" aria-label="다음 안내">
                    {next.map((event) => (
                        <li
                            key={`${event.kind}-${event.distance_m}`}
                            className="row"
                        >
                            <span>{eventLabel(event)}</span>
                            <span className="row__side">
                                {distanceLabel(event.distance_m - travelledM)}
                            </span>
                        </li>
                    ))}
                </ol>
            )}

            {vision}

            <div className="navigation__actions">
                {onSpeak && (
                    <button type="button" className="button" onClick={onSpeak}>
                        말하기
                    </button>
                )}
                <button
                    type="button"
                    className="button"
                    onClick={() => onRepeat(now)}
                >
                    다시 듣기
                </button>
                <button
                    type="button"
                    className="button"
                    disabled={whereAmI.status === 'loading'}
                    onClick={onWhereAmI}
                >
                    {whereAmI.status === 'loading' ? '주소 찾는 중' : '내 위치'}
                </button>
                <button
                    type="button"
                    className="button button--stop"
                    onClick={onStop}
                >
                    안내 종료
                </button>
            </div>
            {whereAmI.status === 'success' && (
                <p
                    role={voice ? undefined : 'status'}
                    className="navigation__note"
                >
                    {whereAmI.data}
                </p>
            )}
            {whereAmI.status === 'error' && (
                <p className="message message--error" role="alert">
                    {whereAmI.message}
                </p>
            )}
        </div>
    );
}
