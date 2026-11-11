interface ImportMetaEnv {
    readonly VITE_API_BASE_URL?: string;
    readonly VITE_MODEL_URL?: string;
}

interface ImportMeta {
    readonly env: ImportMetaEnv;
}
