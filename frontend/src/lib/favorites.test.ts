import { describe, expect, it } from 'vitest';

import { normalizeHome } from './favorites';

describe('normalizeHome', () => {
    it('올바른 값은 거리를 비워 돌려준다', () => {
        expect(
            normalizeHome({
                name: '우리집',
                address: '서울 어딘가',
                position: [127.0, 37.5],
                distance_m: 300,
            }),
        ).toEqual({
            name: '우리집',
            address: '서울 어딘가',
            position: [127.0, 37.5],
            distance_m: null,
        });
    });

    it('주소가 없으면 빈 문자열로 둔다', () => {
        expect(
            normalizeHome({ name: '집', position: [127.0, 37.5] })?.address,
        ).toBe('');
    });

    it.each([
        ['null', null],
        ['문자열', '집'],
        ['이름 없음', { position: [127.0, 37.5] }],
        ['빈 이름', { name: '', position: [127.0, 37.5] }],
        ['좌표 없음', { name: '집' }],
        ['좌표 길이 오류', { name: '집', position: [127.0] }],
        ['좌표가 숫자 아님', { name: '집', position: ['a', 'b'] }],
        ['좌표가 NaN', { name: '집', position: [Number.NaN, 37.5] }],
    ])('쓸 수 없는 값(%s)은 null', (_label, raw) => {
        expect(normalizeHome(raw)).toBeNull();
    });
});
