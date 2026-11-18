import { useCallback, useEffect, useRef, useState } from 'react';

import { isAbort } from '../lib/http';

export type RequestState<T> =
    | { status: 'idle' }
    | { status: 'loading'; previous: T | null }
    | { status: 'success'; data: T }
    | { status: 'error'; message: string };

/**
 * 버튼·음성으로 보내는 요청 하나의 상태. 새로 보내면 이전 요청은 끊는다.
 * 불러오는 동안에도 이전 결과(previous)를 보여 줄 수 있다.
 * 실패하면 화면에 띄울 문장을 onError 에도 넘긴다(끊은 요청은 빼고).
 */
export function useRequest<A extends unknown[], T>(
    request: (signal: AbortSignal, ...args: A) => Promise<T>,
    onError?: (message: string) => void,
): {
    state: RequestState<T>;
    run: (...args: A) => Promise<T | null>;
    reset: () => void;
} {
    const [state, setState] = useState<RequestState<T>>({ status: 'idle' });
    const controller = useRef<AbortController | null>(null);
    const last = useRef<T | null>(null);
    const latestOnError = useRef(onError);

    useEffect(() => {
        latestOnError.current = onError;
    });

    useEffect(() => () => controller.current?.abort(), []);

    const run = useCallback(
        async (...args: A): Promise<T | null> => {
            controller.current?.abort();
            const current = new AbortController();
            controller.current = current;
            setState({ status: 'loading', previous: last.current });
            try {
                const data = await request(current.signal, ...args);
                if (controller.current === current) {
                    last.current = data;
                    setState({ status: 'success', data });
                }
                return data;
            } catch (error) {
                if (!isAbort(error) && controller.current === current) {
                    const message =
                        error instanceof Error ? error.message : String(error);
                    setState({ status: 'error', message });
                    latestOnError.current?.(message);
                }
                return null;
            }
        },
        [request],
    );

    const reset = useCallback(() => {
        controller.current?.abort();
        last.current = null;
        setState({ status: 'idle' });
    }, []);

    return { state, run, reset };
}
