import type { CSSProperties } from 'react';

export type Tab = 'search' | 'route' | 'settings';

const ITEMS: { tab: Tab; label: string; icon: string }[] = [
    {
        tab: 'search',
        label: '검색',
        icon: 'M10.5 4a6.5 6.5 0 1 0 0 13 6.5 6.5 0 0 0 0-13ZM15.2 15.2 20 20',
    },
    {
        tab: 'route',
        label: '길찾기',
        icon: 'M5 19v-6.5A3.5 3.5 0 0 1 8.5 9H19M15 5l4 4-4 4',
    },
    {
        tab: 'settings',
        label: '설정',
        icon: 'M4 7h10M18 7h2M4 17h2M10 17h10M16 4.5v5M8 14.5v5',
    },
];

type MenuBarProps = {
    tab: Tab;
    onSelect: (tab: Tab) => void;
};

/** 화면 아래 메뉴: 검색, 길찾기, 설정. 배리어프리 MenuBar 와 같은 모양이다. */
export default function MenuBar({ tab, onSelect }: MenuBarProps) {
    // 고른 메뉴 뒤 알약이 고른 자리로 미끄러지게 순서를 넘긴다.
    const style = {
        '--menu-count': ITEMS.length,
        '--menu-index': ITEMS.findIndex((item) => item.tab === tab),
    } as CSSProperties;
    return (
        <nav className="menu-bar" aria-label="메뉴" style={style}>
            {ITEMS.map((item) => (
                <button
                    key={item.tab}
                    type="button"
                    className="menu-bar__item"
                    aria-current={item.tab === tab ? 'page' : undefined}
                    onClick={() => onSelect(item.tab)}
                >
                    <svg viewBox="0 0 24 24" aria-hidden="true">
                        <path d={item.icon} />
                    </svg>
                    {item.label}
                </button>
            ))}
        </nav>
    );
}
