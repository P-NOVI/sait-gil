// Tmap 지도 SDK(JavaScript v2) 로드와 좌표 변환. 좌표 순서 변환은 이 파일에서만 한다.
// 백엔드는 GeoJSON 순서 [lng, lat], Tmap 은 LatLng(lat, lng) 순서다.

import type { LngLat } from './geo';

const LOADER_URL = 'https://apis.openapi.sk.com/tmap/jsv2';
const NO_KEY = 'VITE_TMAP_APP_KEY 가 없습니다. frontend/.env 를 확인하세요.';
const LOAD_FAILED = 'Tmap 지도를 불러오지 못했습니다. 지도 키를 확인하세요.';

// 지도 첫 화면 중심이자 내 위치를 모를 때 쓰는 곳
export const SEOUL_CITY_HALL: LngLat = [126.9779, 37.5663];

let loading: Promise<typeof Tmapv2> | null = null;

export function loaderUrl(appKey: string): string {
    const params = new URLSearchParams({ version: '1', appKey });
    return `${LOADER_URL}?${params}`;
}

/** Tmap 지도 키가 있는지. 없으면 지도 없이 쓴다. */
export function hasMapKey(appKey = import.meta.env.VITE_TMAP_APP_KEY): boolean {
    return Boolean(appKey);
}

/** 로더가 document.write 로 쓰려던 HTML 에서 script 주소를 꺼낸다. */
export function scriptSources(html: string): string[] {
    return [...html.matchAll(/<script[^>]*\ssrc=['"]([^'"]+)['"]/g)].map(
        (match) => match[1],
    );
}

function appendScript(src: string): Promise<void> {
    return new Promise((resolve, reject) => {
        const script = document.createElement('script');
        script.src = src;
        script.onload = () => resolve();
        script.onerror = () => {
            script.remove();
            reject(new Error(LOAD_FAILED));
        };
        document.head.append(script);
    });
}

/**
 * SDK 를 한 번만 불러오고 Tmapv2 를 돌려준다.
 * 로더 스크립트는 document.write 로 본 SDK 를 붙이는데, 페이지가 뜬 뒤에는 document.write 가 동작하지 않는다.
 * 그래서 로더가 쓰려던 script 를 받아 직접 붙인다. 본 SDK 가 로더 script 주소의 appKey 를 읽으므로 로더 태그는 남겨 둔다.
 */
export function loadTmap(
    appKey = import.meta.env.VITE_TMAP_APP_KEY,
): Promise<typeof Tmapv2> {
    if (!appKey) {
        return Promise.reject(new Error(NO_KEY));
    }
    loading ??= (async () => {
        const written: string[] = [];
        const write = document.write;
        document.write = (...html: string[]) => {
            written.push(...html);
        };
        try {
            await appendScript(loaderUrl(appKey));
        } finally {
            document.write = write;
        }
        for (const src of scriptSources(written.join(''))) {
            await appendScript(src);
        }
        if (!window.Tmapv2?.Map) {
            throw new Error(LOAD_FAILED);
        }
        return window.Tmapv2;
    })().catch((error: unknown) => {
        loading = null;
        throw error;
    });
    return loading;
}

export function toLatLng([lng, lat]: LngLat): Tmapv2.LatLng {
    return new Tmapv2.LatLng(lat, lng);
}
