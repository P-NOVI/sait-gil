// 권한을 묻는 플러그인 시작(걸음 센서·카메라 등)을 차례로 보낸다.
// Android 는 권한 창이 이미 떠 있을 때 다른 권한을 또 물으면 뒤의 요청을 취소로 돌려주므로, 한 번에 하나씩만 묻는다.

let pending: Promise<void> = Promise.resolve();

/** 앞선 요청이 끝난 뒤 operation 을 부른다. 앞선 요청이 실패해도 이어서 부른다. */
export function inPermissionOrder<T>(operation: () => Promise<T>): Promise<T> {
    const run = pending.then(operation);
    pending = run.then(
        () => undefined,
        () => undefined,
    );
    return run;
}
