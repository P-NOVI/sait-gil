export function apiUrl(
    path: string,
    base = import.meta.env.VITE_API_BASE_URL ?? '',
): string {
    const trimmedBase = base.replace(/\/+$/, '');
    const normalizedPath = path.startsWith('/') ? path : `/${path}`;
    return `${trimmedBase}${normalizedPath}`;
}
