import { useEffect, useRef, useState } from 'react';

import type { LngLat } from '../lib/geo';
import { hasMapKey, loadTmap, SEOUL_CITY_HALL, toLatLng } from '../lib/tmapMap';
import type { LocationFix } from '../platform';

// Tmap 줌 레벨. 숫자가 클수록 확대 (0~19)
const DEFAULT_ZOOM = 16;
// 안내 중 줌 레벨. 걸으며 골목이 보이게 기본보다 한 단계 확대한다.
const FOLLOW_ZOOM = 17;
// 경로가 지도 가장자리·내 위치 버튼에 붙지 않게 두는 여백(px)
const FIT_PADDING = 48;
// 고른 경로: 흰 테두리를 두른 대표색 선. 고르지 않은 경로는 아래에 회색으로 그린다.
const CHOSEN_LINE = {
    strokeWeight: 8,
    strokeColor: '#b35400',
    outline: true,
    outlineColor: '#ffffff',
    zIndex: 4,
};
const OTHER_LINE = { strokeWeight: 6, strokeColor: '#8a929e', zIndex: 1 };
const MY_LOCATION_COLOR = '#1a73e8';
// 도착 핀(30×40). 아래 끝이 도착점을 가리킨다.
const GOAL_PIN = {
    html: '<svg class="map-pin" viewBox="0 0 30 40" width="30" height="40"><path d="M15 39C15 39 2 24.5 2 14a13 13 0 0 1 26 0c0 10.5-13 25-13 25Z"/><circle cx="15" cy="14" r="5"/></svg>',
    width: 30,
    height: 40,
};
// 내 위치 점과 바라보는 방향 부채꼴(56×56). 부채꼴은 북쪽을 향해 그리고 방향만큼 돌린다.
// 방향을 모르면 부채꼴을 숨기고 점만 보인다.
const MY_LOCATION_MARKER = {
    html:
        '<div class="my-location-marker">' +
        '<svg class="my-location-heading" viewBox="0 0 56 56" width="56" height="56" style="visibility:hidden">' +
        `<defs><linearGradient id="my-location-heading-fade" x1="0" y1="1" x2="0" y2="0"><stop offset="0" stop-color="${MY_LOCATION_COLOR}" stop-opacity="0.85"/><stop offset="1" stop-color="${MY_LOCATION_COLOR}" stop-opacity="0.1"/></linearGradient></defs>` +
        '<path d="M28 28 L17 4.4 A26 26 0 0 1 39 4.4 Z" fill="url(#my-location-heading-fade)"/>' +
        '</svg><div class="my-location-dot"></div></div>',
    size: 56,
};
const HEADING_CONE = '.my-location-heading';

/** 부채꼴을 방향(북쪽 0도, 시계 방향)만큼 돌린다. 방향을 모르면 숨긴다. */
function turnCone(cone: SVGElement, heading: number | null) {
    cone.style.visibility = heading === null ? 'hidden' : 'visible';
    if (heading !== null) {
        cone.style.transform = `rotate(${heading}deg)`;
    }
}

type MapViewProps = {
    /** 지도에 그릴 경로들. chosen 번째를 굵게 그린다. */
    paths: LngLat[][];
    chosen: number;
    goal: LngLat | null;
    myLocation: LocationFix | null;
    /** 내가 바라보는 방향(북쪽 0도, 시계 방향). 모르면 null */
    heading?: number | null;
    /** 안내 중 따라갈 위치. null 이면 따라가지 않는다. */
    follow: LngLat | null;
    /** 말로 찾은 결과 중 확인하고 있는 곳. 지도를 그리로 옮긴다. */
    preview?: LngLat | null;
    /** 경로를 고르면 그 번호를 알린다. */
    onPathClick?: (index: number) => void;
};

type MapState =
    | { status: 'loading' }
    | { status: 'ready'; map: Tmapv2.Map }
    | { status: 'error'; message: string };

/**
 * Tmap 지도. 지도는 보조 화면이라 키가 없거나 불러오지 못해도 나머지 기능은 그대로 쓴다.
 * 화면낭독기는 지도를 건너뛰고(aria-hidden) 경로 목록·안내 문장을 읽는다.
 */
export default function MapView(props: MapViewProps) {
    if (!hasMapKey()) {
        return (
            <div className="map-view map-view--empty" aria-hidden="true">
                <p>지도 키가 없어 지도를 표시하지 않습니다.</p>
            </div>
        );
    }
    return <TmapView {...props} />;
}

function TmapView({
    paths,
    chosen,
    goal,
    myLocation,
    heading = null,
    follow,
    preview = null,
    onPathClick,
}: MapViewProps) {
    const container = useRef<HTMLDivElement>(null);
    // 마커를 새로 만들 때 바로 지금 방향으로 돌려 놓기 위해 둔다.
    const latestHeading = useRef(heading);
    const [state, setState] = useState<MapState>({ status: 'loading' });
    // 지도 크기가 바뀐 횟수. 바뀌면 경로가 다 보이게 다시 맞춘다.
    const [resized, setResized] = useState(0);

    useEffect(() => {
        let cancelled = false;
        let created: Tmapv2.Map | null = null;
        loadTmap()
            .then((tmap) => {
                if (cancelled || !container.current) {
                    return;
                }
                // 크기를 주지 않으면 div 크기를 쓴다. '100%' 는 div 가 아니라 창 크기로 잡힌다.
                created = new tmap.Map(container.current, {
                    center: toLatLng(SEOUL_CITY_HALL),
                    zoom: DEFAULT_ZOOM,
                    zoomControl: false,
                    httpsMode: true,
                });
                setState({ status: 'ready', map: created });
            })
            .catch((error: unknown) => {
                if (!cancelled) {
                    setState({
                        status: 'error',
                        message:
                            error instanceof Error
                                ? error.message
                                : String(error),
                    });
                }
            });
        return () => {
            cancelled = true;
            created?.destroy();
        };
    }, []);

    const map = state.status === 'ready' ? state.map : null;

    // 시트를 펴고 접어 지도 크기가 바뀌면 Tmap 에 새 크기를 알려 다시 그린다.
    useEffect(() => {
        const element = container.current;
        if (!map || !element) {
            return;
        }
        const observer = new ResizeObserver(([entry]) => {
            const { width, height } = entry.contentRect;
            map.resize(Math.round(width), Math.round(height));
            setResized((count) => count + 1);
        });
        observer.observe(element);
        return () => observer.disconnect();
    }, [map]);

    // 경로 선. 고르지 않은 경로를 누르면 그 경로를 고른다.
    useEffect(() => {
        if (!map || paths.length === 0) {
            return;
        }
        const lines = paths.map((path, index) => {
            const line = new Tmapv2.Polyline({
                path: path.map(toLatLng),
                strokeOpacity: 1,
                ...(index === chosen ? CHOSEN_LINE : OTHER_LINE),
                map,
            });
            if (index !== chosen && onPathClick) {
                line.addListener('click', () => onPathClick(index));
            }
            return line;
        });
        return () => lines.forEach((line) => line.setMap(null));
    }, [map, paths, chosen, onPathClick]);

    // 새 경로를 받거나 지도 크기가 바뀌면 모든 경로가 보이게 맞춘다.
    // 안내 중에는 내 위치를 따라가므로 맞추지 않는다.
    const following = follow !== null;
    useEffect(() => {
        if (!map || paths.length === 0 || following) {
            return;
        }
        // 빈 영역에 점을 더해 만든다. 생성자에 점 하나를 넘기면 영역이 어긋난다.
        const bounds = new Tmapv2.LatLngBounds();
        paths.flat().forEach((point) => bounds.extend(toLatLng(point)));
        map.fitBounds(bounds, FIT_PADDING);
    }, [map, paths, following, resized]);

    // 도착 핀
    useEffect(() => {
        if (!map || !goal) {
            return;
        }
        const marker = new Tmapv2.Marker({
            position: toLatLng(goal),
            iconHTML: GOAL_PIN.html,
            iconSize: new Tmapv2.Size(GOAL_PIN.width, GOAL_PIN.height),
            offset: new Tmapv2.Point(GOAL_PIN.width / 2, GOAL_PIN.height),
            map,
        });
        return () => marker.setMap(null);
    }, [map, goal]);

    // 내 위치 점. 오차 원은 실내 등에서 지도를 덮어 그리지 않는다.
    useEffect(() => {
        if (!map || !myLocation) {
            return;
        }
        const { html, size } = MY_LOCATION_MARKER;
        const dot = new Tmapv2.Marker({
            position: toLatLng(myLocation.position),
            iconHTML: html,
            iconSize: new Tmapv2.Size(size, size),
            offset: new Tmapv2.Point(size / 2, size / 2),
            zIndex: 5,
            map,
        });
        const cone = container.current?.querySelector<SVGElement>(HEADING_CONE);
        if (cone) {
            turnCone(cone, latestHeading.current);
        }
        return () => dot.setMap(null);
    }, [map, myLocation]);

    // 방향만 바뀌면 마커를 다시 만들지 않고 부채꼴만 돌린다.
    useEffect(() => {
        latestHeading.current = heading;
        const cone = container.current?.querySelector<SVGElement>(HEADING_CONE);
        if (cone) {
            turnCone(cone, heading);
        }
    }, [heading, map, myLocation]);

    // 내 위치를 새로 찾으면 지도를 그리로 옮긴다. 경로를 보는 중에는 옮기지 않는다.
    const hasPaths = paths.length > 0;
    useEffect(() => {
        if (map && myLocation && !hasPaths && !following) {
            map.setCenter(toLatLng(myLocation.position));
        }
    }, [map, myLocation, hasPaths, following]);

    // 말로 찾은 곳을 확인하는 동안 그곳을 가운데에 둔다.
    useEffect(() => {
        if (!map || !preview) {
            return;
        }
        if (map.getZoom() < DEFAULT_ZOOM) {
            map.setZoom(DEFAULT_ZOOM);
        }
        map.panTo(toLatLng(preview));
    }, [map, preview, resized]);

    // 안내 중에는 내 위치를 따라간다. 지도 크기가 바뀌어도 내 위치를 가운데에 둔다.
    useEffect(() => {
        if (!map || !follow) {
            return;
        }
        if (map.getZoom() < FOLLOW_ZOOM) {
            map.setZoom(FOLLOW_ZOOM);
        }
        map.panTo(toLatLng(follow));
    }, [map, follow, resized]);

    return (
        <div className="map-view" aria-hidden="true">
            <div ref={container} className="map-view__canvas" />
            {state.status === 'error' && (
                <p className="map-view__error">{state.message}</p>
            )}
        </div>
    );
}
