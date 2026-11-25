interface ImportMetaEnv {
    readonly VITE_API_BASE_URL?: string;
    readonly VITE_VISION_MOCK?: string;
}

interface ImportMeta {
    readonly env: ImportMetaEnv;
}
