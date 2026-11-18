import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
    appId: 'com.pnovi.saitgil',
    appName: '사잇길',
    webDir: 'dist',
    // 백엔드 CORS 에 허용하는 Android Origin 은 https://localhost 이다.
    server: { hostname: 'localhost', androidScheme: 'https' },
};

export default config;
