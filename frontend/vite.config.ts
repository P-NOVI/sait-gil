import react from '@vitejs/plugin-react';
import { defineConfig, loadEnv } from 'vite';
import { validateAndroidApiUrl } from './build/android.ts';

const DEFAULT_API_PROXY_TARGET = 'http://127.0.0.1:8000';

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
    // VITE_ 로 시작하지 않는 값도 읽는다. 이 값은 브라우저로 나가지 않는다.
    const env = loadEnv(mode, process.cwd(), '');
    if (mode === 'android') {
        validateAndroidApiUrl(env.VITE_API_BASE_URL);
    }
    // 화면과 같은 주소(localhost:5173)의 /api 요청을 백엔드로 넘긴다.
    const proxy = {
        '/api': env.API_PROXY_TARGET || DEFAULT_API_PROXY_TARGET,
    };
    return {
        plugins: [react()],
        // 개발 주소를 5173 으로 고정한다. 이미 쓰이면 다른 포트로 넘어가지 않고 실패한다.
        // /api 는 위 proxy 로 같은 주소에서 부르므로 백엔드 CORS 설정이 필요 없다.
        server: { port: 5173, strictPort: true, proxy },
        preview: { proxy },
    };
});
