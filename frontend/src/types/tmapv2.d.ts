// Tmap JavaScript SDK v2 중 이 앱이 쓰는 부분의 타입. 공식 타입 패키지가 없어 문서를 보고 적었다.
// https://tmapapi.tmapmobility.com/main.html#webv2/docs/WebDocs.Tmap

declare namespace Tmapv2 {
    class LatLng {
        constructor(lat: number, lng: number);
        lat(): number;
        lng(): number;
    }

    class LatLngBounds {
        constructor(coord?: LatLng);
        extend(coord: LatLng): void;
    }

    class Size {
        constructor(width: number, height: number);
    }

    class Point {
        constructor(x: number, y: number);
    }

    type Margin = { left: number; top: number; right: number; bottom: number };

    type MapOptions = {
        center: LatLng;
        width?: string;
        height?: string;
        zoom?: number;
        zoomControl?: boolean;
        scaleBar?: boolean;
        httpsMode?: boolean;
    };

    class Map {
        constructor(div: string | HTMLElement, options: MapOptions);
        getZoom(): number;
        setZoom(zoom: number): void;
        setCenter(center: LatLng): void;
        panTo(center: LatLng): void;
        fitBounds(bounds: LatLngBounds, padding?: number | Margin): void;
        /**
         * 지도 div 크기가 바뀌었을 때 부른다. 문서는 문자열이라 하지만
         * '375px' 처럼 넘기면 줌 계산(fitBounds)이 깨져 숫자(px)로 넘긴다.
         */
        resize(width: number, height: number): void;
        destroy(): void;
    }

    type PolylineOptions = {
        path: LatLng[];
        strokeColor?: string;
        strokeWeight?: number;
        strokeOpacity?: number;
        outline?: boolean;
        outlineColor?: string;
        zIndex?: number;
        map?: Map;
    };

    class Polyline {
        constructor(options: PolylineOptions);
        setMap(map: Map | null): void;
        addListener(event: 'click', handler: () => void): void;
    }

    type MarkerOptions = {
        position: LatLng;
        /** HTML 아이콘. 쓰면 iconSize 가 꼭 있어야 한다. */
        iconHTML?: string;
        iconSize?: Size;
        /** 아이콘에서 position 에 놓일 점(px) */
        offset?: Point;
        zIndex?: number;
        map?: Map;
    };

    class Marker {
        constructor(options: MarkerOptions);
        setMap(map: Map | null): void;
    }

    type CircleOptions = {
        center: LatLng;
        radius: number;
        strokeColor?: string;
        strokeOpacity?: number;
        strokeWeight?: number;
        fillColor?: string;
        fillOpacity?: number;
        map?: Map;
    };

    class Circle {
        constructor(options: CircleOptions);
        setMap(map: Map | null): void;
    }
}

interface Window {
    /** SDK 를 불러오기 전에는 없다. */
    Tmapv2?: typeof Tmapv2;
}
