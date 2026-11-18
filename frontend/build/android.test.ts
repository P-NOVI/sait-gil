import { describe, expect, it } from 'vitest';

import { validateAndroidApiUrl } from './android';

describe('Android 빌드 서버 주소', () => {
    it.each([
        undefined,
        '',
        '/api',
        'http://api.example.com',
        'https://localhost',
    ])('%s 는 앱 API 주소로 빌드하지 않는다', (value) => {
        expect(() => validateAndroidApiUrl(value)).toThrow('VITE_API_BASE_URL');
    });

    it.each(['https://api.example.com', 'https://api.example.com/'])(
        'HTTPS 배포 주소 %s 는 사용할 수 있다',
        (value) => {
            expect(() => validateAndroidApiUrl(value)).not.toThrow();
        },
    );

    it.each([
        'https://user:password@api.example.com',
        'https://api.example.com?key=value',
        'https://api.example.com#api',
    ])('인증 정보나 쿼리가 섞인 주소 %s 는 거부한다', (value) => {
        expect(() => validateAndroidApiUrl(value)).toThrow('VITE_API_BASE_URL');
    });
});
