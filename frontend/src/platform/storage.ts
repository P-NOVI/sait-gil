// 기기 안에만 두는 작은 값(접근성 설정 등). 서버로 보내지 않는다.
// 사생활 보호 모드처럼 저장소를 쓸 수 없으면 저장하지 않고 넘어간다.

export function readStored(key: string): unknown {
    try {
        const text = globalThis.localStorage?.getItem(key);
        return text ? (JSON.parse(text) as unknown) : null;
    } catch {
        return null;
    }
}

export function writeStored(key: string, value: unknown): void {
    try {
        globalThis.localStorage?.setItem(key, JSON.stringify(value));
    } catch {
        // 저장하지 못해도 이번 실행 동안은 화면의 값으로 쓴다.
    }
}
