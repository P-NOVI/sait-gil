// 카메라 인식을 켜고 끄는 상태. 켜지 못한 뒤 다시 켤 때 카메라를 다시 켜 볼지 정한다.
// React 와 떼어 두어 훅 없이 테스트한다.

import type { VisionFailure } from '../platform';

export type VisionControl = {
    /** 카메라 인식을 켜 두었는지 */
    enabled: boolean;
    /** 카메라를 켜지 못한 이유. 켜져 있거나 다시 켜는 중이면 null */
    failure: VisionFailure | null;
    /** 카메라를 다시 켜 본 횟수. 바뀌면 카메라를 다시 켠다 */
    attempt: number;
};

export type VisionControlAction =
    /** 사용자가 켜거나 끈다(안내 시작 때 대답, 버튼, 말) */
    | { type: 'set'; enabled: boolean }
    /** 카메라를 켜지 못했다 */
    | { type: 'failed'; failure: VisionFailure }
    /** 카메라 연결을 끊었다(끄기, 안내 종료, 다시 켜기 전) */
    | { type: 'stopped' };

export const INITIAL_VISION_CONTROL: VisionControl = {
    enabled: true,
    failure: null,
    attempt: 0,
};

export function visionControl(
    state: VisionControl,
    action: VisionControlAction,
): VisionControl {
    switch (action.type) {
        case 'set':
            if (!action.enabled) {
                return { ...state, enabled: false, failure: null };
            }
            // 켜지 못한 상태에서 다시 켜 달라고 하면 카메라를 다시 켜 본다.
            if (state.failure !== null) {
                return {
                    enabled: true,
                    failure: null,
                    attempt: state.attempt + 1,
                };
            }
            return state.enabled ? state : { ...state, enabled: true };
        case 'failed':
            return { ...state, failure: action.failure };
        case 'stopped':
            return state.failure === null ? state : { ...state, failure: null };
    }
}
