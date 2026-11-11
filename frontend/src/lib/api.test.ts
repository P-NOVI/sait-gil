import { describe, expect, it } from 'vitest';
import { apiUrl } from './api';

describe('apiUrl', () => {
    it('기본 주소가 없으면 같은 도메인 경로를 돌려준다', () => {
        expect(apiUrl('/api/route', '')).toBe('/api/route');
    });

    it('기본 주소 끝의 / 와 경로 앞의 / 를 하나로 합친다', () => {
        expect(apiUrl('api/route', 'https://api.example.com/')).toBe(
            'https://api.example.com/api/route',
        );
    });
});
