import { describe, expect, it, vi } from 'vitest';

import { ApiError, isAbort, postJson, requestJson } from './http';

function respond(status: number, body: unknown) {
    return vi
        .fn<typeof fetch>()
        .mockResolvedValue(new Response(JSON.stringify(body), { status }));
}

async function failure(promise: Promise<unknown>): Promise<unknown> {
    return promise.then(
        () => {
            throw new Error('실패해야 합니다.');
        },
        (error: unknown) => error,
    );
}

describe('requestJson', () => {
    it('성공하면 JSON 본문을 돌려준다', async () => {
        const fetcher = respond(200, { ok: true });

        expect(await requestJson('/api/x', {}, fetcher)).toEqual({ ok: true });
        expect(fetcher.mock.calls[0][0]).toMatch(/\/api\/x$/);
    });

    it('오류 응답의 detail 문장을 그대로 보인다', async () => {
        const fetcher = respond(404, { detail: '경로를 찾지 못했습니다.' });

        const error = await failure(requestJson('/api/x', {}, fetcher));

        expect(error).toBeInstanceOf(ApiError);
        expect(error).toMatchObject({
            status: 404,
            message: '경로를 찾지 못했습니다.',
        });
    });

    it('detail 이 문장이 아니면(422 검증 오류) 기본 문장을 쓴다', async () => {
        const fetcher = respond(422, { detail: [{ msg: 'bad' }] });

        const error = await failure(requestJson('/api/x', {}, fetcher));

        expect(error).toMatchObject({ status: 422 });
        expect((error as ApiError).message).toContain('서버에서 문제');
    });

    it('연결하지 못하면 status 0 으로 알린다', async () => {
        const fetcher = vi
            .fn<typeof fetch>()
            .mockRejectedValue(new TypeError('Failed to fetch'));

        const error = await failure(requestJson('/api/x', {}, fetcher));

        expect(error).toMatchObject({ status: 0 });
        expect((error as ApiError).message).toContain('인터넷 연결');
    });

    it('끊은 요청은 ApiError 로 바꾸지 않는다', async () => {
        const fetcher = vi
            .fn<typeof fetch>()
            .mockRejectedValue(new DOMException('aborted', 'AbortError'));

        const error = await failure(requestJson('/api/x', {}, fetcher));

        expect(isAbort(error)).toBe(true);
    });
});

describe('postJson', () => {
    it('본문을 JSON 으로 보낸다', async () => {
        const fetcher = respond(200, {});

        await postJson('/api/routes', { a: 1 }, {}, fetcher);

        const init = fetcher.mock.calls[0][1];
        expect(init?.method).toBe('POST');
        expect(init?.body).toBe('{"a":1}');
        expect(init?.headers).toMatchObject({
            'Content-Type': 'application/json',
        });
    });
});
