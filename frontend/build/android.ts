/**
 * 앱에서는 상대 경로가 WebView 자체로 향하므로 빌드 전에 배포 API 주소를 확인한다.
 * 요청 경로에 /api 가 이미 붙으므로 주소에 경로가 있으면 /api/api 가 되어 거부한다.
 */
export function validateAndroidApiUrl(value: string | undefined): void {
    const message =
        '.env.android의 VITE_API_BASE_URL에 HTTPS 백엔드 주소를 설정하세요.';
    let url: URL;
    try {
        url = new URL(value ?? '');
    } catch {
        throw new Error(message);
    }
    if (
        url.protocol !== 'https:' ||
        url.hostname === 'localhost' ||
        url.pathname !== '/' ||
        url.username ||
        url.password ||
        url.search ||
        url.hash
    ) {
        throw new Error(message);
    }
}
