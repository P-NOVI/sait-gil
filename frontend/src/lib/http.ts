// 백엔드 호출. 주소는 apiUrl() 로 만들고, 실패하면 사용자에게 보일 문장을 담은 ApiError 를 던진다.

import { apiUrl } from './api';

export class ApiError extends Error {
    readonly status: number;

    constructor(status: number, message: string) {
        super(message);
        this.name = 'ApiError';
        this.status = status;
    }
}

const NETWORK_ERROR =
    '서버에 연결하지 못했습니다. 인터넷 연결을 확인하고 다시 시도하세요.';
const SERVER_ERROR = '서버에서 문제가 생겼습니다. 잠시 뒤 다시 시도하세요.';

/** FastAPI 오류 응답의 detail. 검증 오류(422)처럼 문장이 아니면 null */
async function errorDetail(response: Response): Promise<string | null> {
    try {
        const body: unknown = await response.json();
        if (
            body instanceof Object &&
            'detail' in body &&
            typeof body.detail === 'string'
        ) {
            return body.detail;
        }
    } catch {
        // JSON 이 아니면 기본 문장을 쓴다.
    }
    return null;
}

export async function requestJson<T>(
    path: string,
    init: RequestInit = {},
    fetcher: typeof fetch = fetch,
): Promise<T> {
    let response: Response;
    try {
        response = await fetcher(apiUrl(path), {
            ...init,
            headers: { Accept: 'application/json', ...init.headers },
        });
    } catch (error) {
        if (error instanceof DOMException && error.name === 'AbortError') {
            throw error;
        }
        throw new ApiError(0, NETWORK_ERROR);
    }
    if (!response.ok) {
        const detail = await errorDetail(response);
        throw new ApiError(response.status, detail ?? SERVER_ERROR);
    }
    return (await response.json()) as T;
}

export function postJson<T>(
    path: string,
    body: unknown,
    init: RequestInit = {},
    fetcher: typeof fetch = fetch,
): Promise<T> {
    return requestJson<T>(
        path,
        {
            ...init,
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
        },
        fetcher,
    );
}

/** 사용자가 새 요청으로 이전 요청을 끊었을 때. 화면에 오류로 보이지 않는다. */
export function isAbort(error: unknown): boolean {
    return error instanceof DOMException && error.name === 'AbortError';
}
