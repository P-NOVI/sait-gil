import { describe, expect, it } from 'vitest';

import type {
    ClockDirection,
    CrowdLevel,
    VisionFrame,
    VisionLevel,
} from '../platform';
import { CROSSING_FACING, VISION } from '../settings';
import {
    BLOCKED_TEXT,
    CROWDED_TEXT,
    DANGER_TEXT,
    freeDirectionText,
    MOVE_ASIDE_TEXT,
    obstacleAlert,
    obstacleText,
    SIGNAL_CHANGED_TEXT,
    SIGNAL_RED_TEXT,
    SIGNAL_SEEN_TEXT,
    signalReader,
    UNKNOWN_TEXT,
    type VisionCue,
    WAITING_FRONT_TEXT,
    VISION_DENIED_TEXT,
    VISION_FAILED_TEXT,
    VISION_KEYS,
    visionFailureAlert,
    visionReader,
} from './visionAlerts';

function frame(
    level: VisionLevel,
    freeDirections: ClockDirection[] = [12],
): VisionFrame {
    return {
        level,
        nearestPersonM: null,
        freeDirections,
        signal: null,
        signalId: 0,
        obstacles: [],
    };
}

/** frames 를 1초 간격으로 넣고 마지막 결과를 돌려준다. */
function feed(
    frames: readonly VisionFrame[],
    minLevel: CrowdLevel = 'caution',
    read = visionReader(),
): VisionCue | null {
    let cue: VisionCue | null = null;
    frames.forEach((each, index) => {
        cue = read(each, index * 1_000, minLevel);
    });
    return cue;
}

const times = (count: number, each: VisionFrame) =>
    Array.from({ length: count }, () => each);

const text = (cue: VisionCue | null) =>
    cue?.kind === 'alert' ? cue.alert.text : null;

describe('visionReader', () => {
    it('같은 단계가 확인 프레임만큼 이어져야 알린다', () => {
        const crowded = frame('crowded', [11]);

        expect(feed(times(VISION.confirmFrames - 1, crowded))).toBeNull();
        expect(text(feed(times(VISION.confirmFrames, crowded)))).toBe(
            freeDirectionText(11),
        );
    });

    it('한 프레임 튄 단계는 알리지 않는다', () => {
        const cue = feed([frame('clear'), frame('clear'), frame('crowded')]);

        expect(cue).toBeNull();
    });

    it('빈 방향이 바뀌고 있으면 속도만 줄이라고 한다', () => {
        const cue = feed([
            frame('crowded', [11]),
            frame('crowded', [1]),
            frame('crowded', [11]),
        ]);

        expect(text(cue)).toBe(CROWDED_TEXT);
    });

    it('모든 방향이 막혔으면 붐빈다고만 한다', () => {
        const cue = feed(times(VISION.confirmFrames, frame('crowded', [])));

        expect(text(cue)).toBe(BLOCKED_TEXT);
    });

    it('모두 막힘은 혼잡 알림과 다른 key 라 바로 이어 읽을 수 있다', () => {
        const read = visionReader();
        const first = feed(
            times(VISION.confirmFrames, frame('crowded', [11])),
            'caution',
            read,
        );
        const blocked = feed(
            times(VISION.confirmFrames, frame('crowded', [])),
            'caution',
            read,
        );

        expect(first?.kind === 'alert' && first.alert.key).not.toBe(
            blocked?.kind === 'alert' && blocked.alert.key,
        );
    });

    it('혼잡 알림은 혼잡 단계로 중재에 넘긴다', () => {
        const cue = feed(times(VISION.confirmFrames, frame('crowded')));

        expect(cue).toMatchObject({ kind: 'alert', alert: { level: 'crowd' } });
    });

    it('위험은 더 적은 프레임으로 바로 알린다', () => {
        const cue = feed(times(VISION.dangerFrames, frame('danger')));

        expect(cue).toMatchObject({
            kind: 'alert',
            alert: { level: 'danger', text: DANGER_TEXT },
        });
    });

    it('위험은 한 프레임만 보여도 바로 알린다', () => {
        const cue = feed([frame('clear'), frame('crowded'), frame('danger')]);

        expect(text(cue)).toBe(DANGER_TEXT);
    });

    it('위험이 이어지면 가장자리로 비키라고 한다', () => {
        const count = VISION.sustainedDangerMs / 1_000 + VISION.dangerFrames;

        expect(text(feed(times(count, frame('danger'))))).toBe(MOVE_ASIDE_TEXT);
    });

    it('민감도가 낮아도 위험은 알린다', () => {
        const cue = feed(times(VISION.dangerFrames, frame('danger')), 'danger');

        expect(text(cue)).toBe(DANGER_TEXT);
    });

    it('사람 안내에는 멈추라는 말이 없다', () => {
        [DANGER_TEXT, MOVE_ASIDE_TEXT, BLOCKED_TEXT, CROWDED_TEXT].forEach(
            (each) => {
                expect(each).not.toContain('멈추');
                expect(each).not.toContain('기다리');
            },
        );
    });

    describe('신호를 기다리며 서 있을 때', () => {
        /** waiting 으로 frames 를 넣고 알림 문구를 모두 모은다. */
        function waitingTexts(
            frames: readonly VisionFrame[],
            read = visionReader(),
        ) {
            return frames.map((each, index) =>
                text(read(each, index * 1_000, 'caution', true)),
            );
        }

        it('앞에 사람이 서면 붐빔·위험 대신 앞에 사람이 있다고 한 번만 알린다', () => {
            const crowded = times(
                VISION.confirmFrames + 5,
                frame('crowded', []),
            );

            const told = waitingTexts(crowded).filter((each) => each !== null);

            expect(told).toEqual([WAITING_FRONT_TEXT]);
        });

        it('위험 단계여도 비켜 서라고 하지 않는다', () => {
            const danger = times(
                VISION.sustainedDangerMs / 1_000 + VISION.confirmFrames + 2,
                frame('danger'),
            );

            const told = waitingTexts(danger).filter((each) => each !== null);

            expect(told).toEqual([WAITING_FRONT_TEXT]);
        });

        it('사람이 사라졌다 다시 서면 다시 알린다', () => {
            const frames = [
                ...times(VISION.confirmFrames, frame('crowded')),
                ...times(VISION.confirmFrames, frame('clear')),
                ...times(VISION.confirmFrames, frame('crowded')),
            ];

            const told = waitingTexts(frames).filter((each) => each !== null);

            expect(told).toEqual([WAITING_FRONT_TEXT, WAITING_FRONT_TEXT]);
        });

        it('한 프레임 튀는 사람은 알리지 않는다', () => {
            const frames = [frame('clear'), frame('crowded'), frame('clear')];

            expect(waitingTexts(frames)).toEqual([null, null, null]);
        });

        it('다시 걷기 시작하면 평소처럼 알린다', () => {
            const read = visionReader();
            waitingTexts(times(VISION.confirmFrames, frame('crowded')), read);

            const walking = feed(
                times(VISION.confirmFrames, frame('crowded')),
                'caution',
                read,
            );

            expect(text(walking)).toBe(freeDirectionText(12));
        });
    });

    it('민감도보다 낮은 단계는 알리지 않는다', () => {
        const cue = feed(
            times(VISION.confirmFrames, frame('crowded')),
            'danger',
        );

        expect(cue).toBeNull();
    });

    it('주의는 들어설 때 한 번만 진동한다', () => {
        const read = visionReader();
        const caution = times(VISION.confirmFrames, frame('caution'));

        expect(feed(caution, 'caution', read)).toEqual({ kind: 'buzz' });
        expect(feed([frame('caution')], 'caution', read)).toBeNull();
    });

    it('주의 중 한 프레임 튀어도 다시 진동하지 않는다', () => {
        const read = visionReader();
        feed(times(VISION.confirmFrames, frame('caution')), 'caution', read);

        const cue = feed(
            [frame('clear'), ...times(VISION.confirmFrames, frame('caution'))],
            'caution',
            read,
        );

        expect(cue).toBeNull();
    });

    it('기본 민감도에서는 주의에 진동하지 않는다', () => {
        const cue = feed(
            times(VISION.confirmFrames, frame('caution')),
            'crowded',
        );

        expect(cue).toBeNull();
    });

    it('판단 불가는 쿨다운 없이 한 번만 읽도록 넘긴다', () => {
        const cue = feed(
            times(VISION.confirmFrames, frame('unknown')),
            'danger',
        );

        expect(cue).toMatchObject({
            kind: 'alert',
            alert: { text: UNKNOWN_TEXT, cooldownMs: Infinity },
        });
    });

    it('판단 불가가 이어지는 동안은 같은 알림이고, 인식이 돌아온 뒤 다시 판단 불가면 새 알림이다', () => {
        const read = visionReader();
        const unknown = times(VISION.confirmFrames, frame('unknown'));
        const clear = times(VISION.confirmFrames, frame('clear'));
        const keyOf = (cue: VisionCue | null) =>
            cue?.kind === 'alert' ? cue.alert.key : null;

        const first = keyOf(feed(unknown, 'danger', read));
        const still = keyOf(feed(unknown, 'danger', read));
        feed(clear, 'danger', read);
        const again = keyOf(feed(unknown, 'danger', read));

        expect(first).not.toBeNull();
        expect(still).toBe(first);
        expect(again).not.toBeNull();
        expect(again).not.toBe(first);
    });

    it('여유는 알리지 않는다', () => {
        expect(feed(times(VISION.confirmFrames, frame('clear')))).toBeNull();
    });
});

describe('visionFailureAlert', () => {
    it('권한 거부는 설정에서 허용하라고 알린다', () => {
        expect(visionFailureAlert('denied')).toEqual({
            key: VISION_KEYS.failure,
            level: 'route',
            text: VISION_DENIED_TEXT,
            cooldownMs: 0,
        });
    });

    it('더 묻지 않는 권한 거부도 설정에서 허용하라고 알린다', () => {
        expect(visionFailureAlert('blocked').text).toBe(VISION_DENIED_TEXT);
    });

    it('그 밖의 실패는 카메라를 켜지 못했다고 알린다', () => {
        expect(visionFailureAlert('failed').text).toBe(VISION_FAILED_TEXT);
    });
});

describe('obstacleAlert', () => {
    it('기둥·장애물·계단은 방향을 경로 등급으로 알린다', () => {
        expect(obstacleAlert({ kind: 'pole', direction: 12 })).toEqual({
            key: `${VISION_KEYS.obstacle}-pole`,
            level: 'route',
            text: '12시 방향에 기둥이 있습니다.',
            cooldownMs: 0,
        });
        expect(obstacleText({ kind: 'obstacle', direction: 11 })).toBe(
            '11시 방향에 장애물이 있습니다.',
        );
        expect(obstacleText({ kind: 'stairs', direction: 1 })).toBe(
            '1시 방향에 계단이 있습니다.',
        );
    });

    it('차·이륜차는 짧게 조심하라고 위험 등급으로 알린다', () => {
        expect(obstacleAlert({ kind: 'car', direction: 1 })).toEqual({
            key: `${VISION_KEYS.obstacle}-car`,
            level: 'danger',
            text: '1시 차 조심.',
            cooldownMs: 0,
        });
        expect(obstacleText({ kind: 'two_wheeler', direction: 11 })).toBe(
            '11시 이륜차 조심.',
        );
    });

    it('서 있는 차·이륜차는 장애물처럼 경로 등급으로 알린다', () => {
        expect(
            obstacleAlert({ kind: 'car', direction: 12, still: true }),
        ).toEqual({
            key: `${VISION_KEYS.obstacle}-car`,
            level: 'route',
            text: '12시 방향에 차가 있습니다.',
            cooldownMs: 0,
        });
        expect(
            obstacleText({ kind: 'two_wheeler', direction: 1, still: true }),
        ).toBe('1시 방향에 이륜차가 있습니다.');
    });

    it('클래스마다 따로 쿨다운을 받도록 이름이 다르다', () => {
        expect(obstacleAlert({ kind: 'pole', direction: 12 }).key).not.toBe(
            obstacleAlert({ kind: 'stairs', direction: 12 }).key,
        );
    });
});

describe('signalReader', () => {
    const signalText = (
        read: ReturnType<typeof signalReader>,
        signal: Parameters<ReturnType<typeof signalReader>>[0],
        atCrosswalk = true,
    ) => read(signal, atCrosswalk)?.text ?? null;

    it('횡단보도 근처가 아니면 알리지 않는다', () => {
        const read = signalReader();

        expect(read('red', false)).toBeNull();
        expect(read('other', false)).toBeNull();
    });

    it('처음 보인 신호등이 빨간불인지 알린다', () => {
        expect(signalText(signalReader(), 'red')).toBe(SIGNAL_RED_TEXT);
        expect(signalText(signalReader(), 'other')).toBe(SIGNAL_SEEN_TEXT);
    });

    it('경로 등급으로 쿨다운 없이 알린다', () => {
        expect(signalReader()('red', true)).toEqual({
            key: VISION_KEYS.signal,
            level: 'route',
            text: SIGNAL_RED_TEXT,
            cooldownMs: 0,
        });
    });

    it('같은 상태는 다시 읽지 않고 빨간불에서 바뀌면 알린다', () => {
        const read = signalReader();

        expect(signalText(read, 'red')).toBe(SIGNAL_RED_TEXT);
        expect(signalText(read, 'red')).toBeNull();
        expect(signalText(read, 'other')).toBe(SIGNAL_CHANGED_TEXT);
        expect(signalText(read, 'other')).toBeNull();
        expect(signalText(read, 'red')).toBe(SIGNAL_RED_TEXT);
    });

    it('잠깐 안 보였다 같은 상태로 다시 보이면 읽지 않는다', () => {
        const read = signalReader();

        expect(signalText(read, 'red')).toBe(SIGNAL_RED_TEXT);
        expect(signalText(read, null)).toBeNull();
        expect(signalText(read, 'red')).toBeNull();
    });

    it('횡단보도를 벗어났다 다음 횡단보도에서는 처음부터 알린다', () => {
        const read = signalReader();

        expect(signalText(read, 'red')).toBe(SIGNAL_RED_TEXT);
        expect(signalText(read, 'red', false)).toBeNull();
        expect(signalText(read, 'red')).toBe(SIGNAL_RED_TEXT);
    });

    it('옆 방향을 보면 읽지 않는다', () => {
        expect(signalReader()('red', true, { facing: false })).toBeNull();
    });

    it('다른 신호등을 고르면 바뀌었다고 하지 않고 처음부터 알린다', () => {
        // 따라가던 빨간불을 놓치고 옆 신호등(초록)을 골라도 "빨간불이 바뀌었습니다"라고 읽지 않는다.
        const read = signalReader();

        expect(read('red', true, { signalId: 1 })?.text).toBe(SIGNAL_RED_TEXT);
        expect(read('other', true, { signalId: 2 })?.text).toBe(
            SIGNAL_SEEN_TEXT,
        );
    });

    it('옆을 보는 동안 다른 신호등을 고르면 돌아와서 처음부터 알린다', () => {
        const read = signalReader();
        const back = 1_000 + CROSSING_FACING.settleMs;

        expect(read('red', true, { signalId: 1, nowMs: 0 })?.text).toBe(
            SIGNAL_RED_TEXT,
        );
        expect(
            read('other', true, { facing: false, signalId: 2, nowMs: 1_000 }),
        ).toBeNull();
        expect(read('other', true, { signalId: 2, nowMs: back })?.text).toBe(
            SIGNAL_SEEN_TEXT,
        );
    });

    it('방향이 잠깐 벗어났다 돌아와도 같은 신호등이면 바뀐 것을 알린다', () => {
        // 빨간불을 기다리다 나침반이 튄 사이 초록불로 바뀌어도 "빨간불이 바뀌었습니다"를 놓치지 않는다.
        const read = signalReader();
        const back = 1_000 + CROSSING_FACING.settleMs;

        expect(read('red', true, { signalId: 1, nowMs: 0 })?.text).toBe(
            SIGNAL_RED_TEXT,
        );
        expect(
            read('other', true, { facing: false, signalId: 1, nowMs: 1_000 }),
        ).toBeNull();
        expect(read('other', true, { signalId: 1, nowMs: back })?.text).toBe(
            SIGNAL_CHANGED_TEXT,
        );
    });

    it('방향 경계를 오가도 빨간불을 되풀이하지 않는다', () => {
        const read = signalReader();
        const back = 100 + CROSSING_FACING.settleMs;

        expect(read('red', true, { nowMs: 0 })?.text).toBe(SIGNAL_RED_TEXT);
        expect(read('red', true, { facing: false, nowMs: 100 })).toBeNull();
        expect(read('red', true, { nowMs: back })).toBeNull();
    });

    it('옆을 보다 돌아선 직후 settleMs 동안은 읽지 않는다', () => {
        // 플러그인에 잠깐 남은 옆 신호등 상태를 첫 말로 읽지 않는다.
        const read = signalReader();
        const settle = CROSSING_FACING.settleMs;

        expect(read('other', true, { facing: false, nowMs: 0 })).toBeNull();
        expect(read('other', true, { nowMs: settle - 1 })).toBeNull();
        expect(read('red', true, { nowMs: settle })?.text).toBe(
            SIGNAL_RED_TEXT,
        );
    });
});
