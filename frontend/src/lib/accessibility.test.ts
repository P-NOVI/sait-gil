import { describe, expect, it } from 'vitest';

import {
    DEFAULT_ACCESSIBILITY,
    normalizeAccessibility,
    scaledPattern,
} from './accessibility';

describe('normalizeAccessibility', () => {
    it('저장한 값이 없으면 기본값', () => {
        expect(normalizeAccessibility(null)).toEqual(DEFAULT_ACCESSIBILITY);
    });

    it('아는 값은 살리고 모르는 값·빠진 값은 기본값으로 채운다', () => {
        expect(
            normalizeAccessibility({
                fontScale: 'xlarge',
                speechSpeed: 'warp',
                highContrast: true,
                voice: 'yes',
            }),
        ).toEqual({
            ...DEFAULT_ACCESSIBILITY,
            fontScale: 'xlarge',
            highContrast: true,
        });
    });

    it('객체에 원래 있는 이름(toString 등)은 값으로 받지 않는다', () => {
        expect(
            normalizeAccessibility({ fontScale: 'toString' }).fontScale,
        ).toBe(DEFAULT_ACCESSIBILITY.fontScale);
    });
});

describe('scaledPattern', () => {
    it('진동 시간만 늘이고 멈춤은 그대로 둔다', () => {
        expect(scaledPattern([200, 100, 200], 'strong')).toEqual([
            280, 100, 280,
        ]);
        expect(scaledPattern([300], 'weak')).toEqual([180]);
    });

    it('진동을 끄면 빈 목록', () => {
        expect(scaledPattern([200, 100, 200], 'off')).toEqual([]);
    });
});
