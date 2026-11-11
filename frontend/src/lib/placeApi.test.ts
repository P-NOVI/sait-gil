import { describe, expect, it, vi } from 'vitest';

import { findAddress, searchPlaces, spokenAddress } from './placeApi';

function json(status: number, body: unknown) {
    return vi
        .fn<typeof fetch>()
        .mockResolvedValue(new Response(JSON.stringify(body), { status }));
}

function sentUrl(fetcher: ReturnType<typeof json>): URL {
    return new URL(String(fetcher.mock.calls[0][0]), 'http://localhost');
}

const address = {
    full_address: '서울 중구 태평로1가 31',
    road_address: '서울 중구 세종대로 110',
    road_name: '세종대로',
    building_name: '서울특별시청',
};

describe('searchPlaces', () => {
    it('내 위치가 있으면 함께 보내 가까운 순으로 받는다', async () => {
        const fetcher = json(200, { places: [] });

        await searchPlaces('시청', [126.97, 37.56], undefined, fetcher);

        const url = sentUrl(fetcher);
        expect(url.pathname).toBe('/api/places');
        expect(url.searchParams.get('query')).toBe('시청');
        expect(url.searchParams.get('lng')).toBe('126.97');
        expect(url.searchParams.get('lat')).toBe('37.56');
    });

    it('내 위치가 없으면 검색어만 보낸다', async () => {
        const fetcher = json(200, { places: [] });

        await searchPlaces('시청', null, undefined, fetcher);

        expect(sentUrl(fetcher).searchParams.has('lng')).toBe(false);
    });
});

describe('findAddress', () => {
    it('주소가 없는 곳(404)이면 null', async () => {
        const fetcher = json(404, { detail: '주소가 없습니다.' });

        expect(await findAddress([127, 37.5], undefined, fetcher)).toBeNull();
    });

    it('다른 오류는 그대로 던진다', async () => {
        const fetcher = json(502, { detail: '주소 서비스 오류' });

        await expect(
            findAddress([127, 37.5], undefined, fetcher),
        ).rejects.toThrow('주소 서비스 오류');
    });
});

describe('spokenAddress', () => {
    it('건물 이름을 도로명 주소 앞에 붙인다', () => {
        expect(spokenAddress(address)).toBe(
            '서울특별시청, 서울 중구 세종대로 110',
        );
    });

    it('도로명 주소가 없으면 전체 주소를 읽는다', () => {
        expect(
            spokenAddress({ ...address, road_address: '', building_name: '' }),
        ).toBe('서울 중구 태평로1가 31');
    });
});
