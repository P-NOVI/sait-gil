"""키마다 값을 잠시 들고 있는 캐시."""

import time
from collections.abc import Callable


class KeyedTtlCache[K, T]:
    """키마다 값 하나를 ttl_s 초 동안 들고 있는다."""

    def __init__(
        self, ttl_s: float, clock: Callable[[], float] = time.monotonic
    ) -> None:
        self.ttl_s = ttl_s
        self.clock = clock
        self.entries: dict[K, tuple[float, T]] = {}

    def get(self, key: K) -> T | None:
        entry = self.entries.get(key)
        if entry is None or self.clock() - entry[0] >= self.ttl_s:
            return None
        return entry[1]

    def set(self, key: K, value: T) -> None:
        now = self.clock()
        # 기준 시각이 바뀌면 키도 바뀌어 쌓이기만 하므로, 만료된 것은 치운다.
        self.entries = {
            k: v for k, v in self.entries.items() if now - v[0] < self.ttl_s
        }
        self.entries[key] = (now, value)
