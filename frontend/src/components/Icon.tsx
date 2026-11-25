// 버튼에 붙이는 선 아이콘. 글자와 같은 색으로 그리고 화면낭독기는 읽지 않는다.

const PATHS = {
    search: 'M10.5 4a6.5 6.5 0 1 0 0 13 6.5 6.5 0 0 0 0-13ZM15.2 15.2 20 20',
    mic: 'M12 3a3 3 0 0 0-3 3v6a3 3 0 0 0 6 0V6a3 3 0 0 0-3-3ZM5.5 11a6.5 6.5 0 0 0 13 0M12 17.5V21',
    home: 'M4 11l8-7 8 7M6 9.5V20h4.5v-5h3v5H18V9.5',
    back: 'M15 5l-7 7 7 7',
    next: 'M9 5l7 7-7 7',
    check: 'M5 12.5l4.5 4.5L19 7.5',
} as const;

export type IconName = keyof typeof PATHS;

export default function Icon({ name }: { name: IconName }) {
    return (
        <svg className="icon" viewBox="0 0 24 24" aria-hidden="true">
            <path d={PATHS[name]} />
        </svg>
    );
}
