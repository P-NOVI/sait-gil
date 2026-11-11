import { useCallback, useEffect, useState } from 'react';

import {
    type AccessibilitySettings,
    FONT_SCALES,
    normalizeAccessibility,
} from '../lib/accessibility';
import { readStored, writeStored } from '../platform';

const STORAGE_KEY = 'sait-gil:accessibility';

/** 접근성 설정. 바꾸면 기기에 저장하고 글자 크기·고대비를 화면 전체에 바로 반영한다. */
export function useAccessibility(): [
    AccessibilitySettings,
    (change: Partial<AccessibilitySettings>) => void,
] {
    const [settings, setSettings] = useState(() =>
        normalizeAccessibility(readStored(STORAGE_KEY)),
    );

    useEffect(() => {
        const root = document.documentElement;
        root.style.setProperty(
            '--font-scale',
            String(FONT_SCALES[settings.fontScale]),
        );
        if (settings.highContrast) {
            root.dataset.contrast = 'high';
        } else {
            delete root.dataset.contrast;
        }
    }, [settings.fontScale, settings.highContrast]);

    const update = useCallback((change: Partial<AccessibilitySettings>) => {
        setSettings((current) => {
            const next = { ...current, ...change };
            writeStored(STORAGE_KEY, next);
            return next;
        });
    }, []);

    return [settings, update];
}
