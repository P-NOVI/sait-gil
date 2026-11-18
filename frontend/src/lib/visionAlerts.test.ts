import { describe, expect, it } from 'vitest';

import type {
    ClockDirection,
    CrowdLevel,
    VisionFrame,
    VisionLevel,
} from '../platform';
import { VISION } from '../settings';
import {
    BLOCKED_TEXT,
    CROWDED_TEXT,
    DANGER_TEXT,
    freeDirectionText,
    MOVE_ASIDE_TEXT,
    UNKNOWN_TEXT,
    type VisionCue,
    visionReader,
} from './visionAlerts';

function frame(
    level: VisionLevel,
    freeDirections: ClockDirection[] = [12],
): VisionFrame {
    return { level, nearestPersonM: null, freeDirections };
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

    it('모든 방향이 막혔으면 멈춰 기다리라고 한다', () => {
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

    it('위험은 더 적은 프레임으로 바로 멈추라고 한다', () => {
        const cue = feed(times(VISION.dangerFrames, frame('danger')));

        expect(cue).toMatchObject({
            kind: 'alert',
            alert: { level: 'danger', text: DANGER_TEXT },
        });
    });

    it('위험이 이어지면 가장자리로 비키라고 한다', () => {
        const count = VISION.sustainedDangerMs / 1_000 + VISION.dangerFrames;

        expect(text(feed(times(count, frame('danger'))))).toBe(MOVE_ASIDE_TEXT);
    });

    it('민감도가 낮아도 위험은 알린다', () => {
        const cue = feed(times(VISION.dangerFrames, frame('danger')), 'danger');

        expect(text(cue)).toBe(DANGER_TEXT);
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

    it('여유는 알리지 않는다', () => {
        expect(feed(times(VISION.confirmFrames, frame('clear')))).toBeNull();
    });
});
