import { describe, expect, it } from 'vitest';

import { hasMapKey, loaderUrl, scriptSources } from './tmapMap';

describe('loaderUrl', () => {
    it('버전과 키를 붙인 로더 주소', () => {
        expect(loaderUrl('abc')).toBe(
            'https://apis.openapi.sk.com/tmap/jsv2?version=1&appKey=abc',
        );
    });
});

describe('hasMapKey', () => {
    it('키가 비어 있으면 지도 없이 쓴다', () => {
        expect(hasMapKey('')).toBe(false);
        expect(hasMapKey('abc')).toBe(true);
    });
});

describe('scriptSources', () => {
    it('로더가 document.write 로 쓰려던 script 주소를 순서대로 꺼낸다', () => {
        const html =
            "<script src='https://topopentile2.tmap.co.kr/scriptSDKV2/tmapjs2.min.js?version=20231206'></script>" +
            '<script type="text/javascript" src="https://example.com/b.js"></script>';

        expect(scriptSources(html)).toEqual([
            'https://topopentile2.tmap.co.kr/scriptSDKV2/tmapjs2.min.js?version=20231206',
            'https://example.com/b.js',
        ]);
    });

    it('script 가 없으면 빈 목록', () => {
        expect(scriptSources('<div></div>')).toEqual([]);
    });
});
