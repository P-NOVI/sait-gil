import { useEffect, useRef, useState } from 'react';

import type { LngLat } from '../lib/geo';
import {
    hasMapKey,
    loadKakaoMaps,
    SEOUL_CITY_HALL,
    toLatLng,
} from '../lib/kakaoMap';
import type { LocationFix } from '../platform';

// 카카오맵 확대 수준. 숫자가 작을수록 확대 (1~14)
const DEFAULT_LEVEL = 4;
// 안내 중 확대 수준. 걸으며 골목이 보이게 기본보다 한 단계 확대한다.
const FOLLOW_LEVEL = 3;
// 고른 경로: 흰 테두리 위에 대표색 선. 고르지 않은 경로는 아래에 회색으로 그린다.
const CHOSEN_OUTLINE = { strokeWeight: 12, strokeColor: '#ffffff', zIndex: 3 };
const CHOSEN_LINE = { strokeWeight: 8, strokeColor: '#b35400', zIndex: 4 };
const OTHER_LINE = { strokeWeight: 6, strokeColor: '#8a929e', zIndex: 1 };

type MapViewProps = {
    /** 지도에 그릴 경로들. chosen 번째를 굵게 그린다. */
    paths: LngLat[][];
    chosen: number;
    goal: LngLat | null;
    myLocation: LocationFix | null;
    /** 안내 중 따라갈 위치. null 이면 따라가지 않는다. */
    follow: LngLat | null;
    /** 경로를 고르면 그 번호를 알린다. */
    onPathClick?: (index: number) => void;
};

type MapState =
    | { status: 'loading' }
    | { status: 'ready'; map: kakao.maps.Map }
    | { status: 'error'; message: string };

/**
 * 카카오맵. 지도는 보조 화면이라 키가 없거나 불러오지 못해도 나머지 기능은 그대로 쓴다.
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
    return <KakaoMap {...props} />;
}

function KakaoMap({
    paths,
    chosen,
    goal,
    myLocation,
    follow,
    onPathClick,
}: MapViewProps) {
    const container = useRef<HTMLDivElement>(null);
    const [state, setState] = useState<MapState>({ status: 'loading' });
    // 지도 크기가 바뀐 횟수. 바뀌면 경로가 다 보이게 다시 맞춘다.
    const [resized, setResized] = useState(0);

    useEffect(() => {
        let cancelled = false;
        loadKakaoMaps()
            .then((maps) => {
                if (cancelled || !container.current) {
                    return;
                }
                const map = new maps.Map(container.current, {
                    center: toLatLng(SEOUL_CITY_HALL),
                    level: DEFAULT_LEVEL,
                });
                setState({ status: 'ready', map });
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
        };
    }, []);

    const map = state.status === 'ready' ? state.map : null;

    // 시트를 펴고 접어 지도 크기가 바뀌면 카카오맵을 다시 그린다.
    useEffect(() => {
        const element = container.current;
        if (!map || !element) {
            return;
        }
        const observer = new ResizeObserver(() => {
            map.relayout();
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
        const lines: kakao.maps.Polyline[] = [];
        paths.forEach((path, index) => {
            const latLngs = path.map(toLatLng);
            const styles =
                index === chosen ? [CHOSEN_OUTLINE, CHOSEN_LINE] : [OTHER_LINE];
            for (const style of styles) {
                const line = new kakao.maps.Polyline({
                    path: latLngs,
                    strokeOpacity: 1,
                    strokeStyle: 'solid',
                    ...style,
                });
                line.setMap(map);
                if (index !== chosen && onPathClick) {
                    kakao.maps.event.addListener(line, 'click', () =>
                        onPathClick(index),
                    );
                }
                lines.push(line);
            }
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
        const bounds = new kakao.maps.LatLngBounds();
        paths.flat().forEach((point) => bounds.extend(toLatLng(point)));
        map.setBounds(bounds);
    }, [map, paths, following, resized]);

    // 도착 핀
    useEffect(() => {
        if (!map || !goal) {
            return;
        }
        const marker = new kakao.maps.CustomOverlay({
            position: toLatLng(goal),
            content: '<div class="map-pin map-pin--goal"></div>',
            yAnchor: 1,
        });
        marker.setMap(map);
        return () => marker.setMap(null);
    }, [map, goal]);

    // 내 위치 점과 오차 원
    useEffect(() => {
        if (!map || !myLocation) {
            return;
        }
        const position = toLatLng(myLocation.position);
        const dot = new kakao.maps.CustomOverlay({
            position,
            content: '<div class="my-location-dot"></div>',
            zIndex: 5,
        });
        const circle = new kakao.maps.Circle({
            center: position,
            radius: myLocation.accuracy,
            strokeWeight: 1,
            strokeColor: '#1a73e8',
            strokeOpacity: 0.4,
            fillColor: '#1a73e8',
            fillOpacity: 0.12,
        });
        dot.setMap(map);
        circle.setMap(map);
        return () => {
            dot.setMap(null);
            circle.setMap(null);
        };
    }, [map, myLocation]);

    // 내 위치를 새로 찾으면 지도를 그리로 옮긴다. 경로를 보는 중에는 옮기지 않는다.
    const hasPaths = paths.length > 0;
    useEffect(() => {
        if (map && myLocation && !hasPaths && !following) {
            map.setCenter(toLatLng(myLocation.position));
        }
    }, [map, myLocation, hasPaths, following]);

    // 안내 중에는 내 위치를 따라간다. 지도 크기가 바뀌어도 내 위치를 가운데에 둔다.
    useEffect(() => {
        if (!map || !follow) {
            return;
        }
        if (map.getLevel() > FOLLOW_LEVEL) {
            map.setLevel(FOLLOW_LEVEL);
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
