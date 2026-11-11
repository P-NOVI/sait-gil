interface ImportMetaEnv {
    readonly VITE_API_BASE_URL?: string;
    readonly VITE_TMAP_APP_KEY?: string;
}

interface ImportMeta {
    readonly env: ImportMetaEnv;
}
