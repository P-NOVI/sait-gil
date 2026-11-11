import type { ReactNode } from 'react';

type BottomSheetProps = {
    title: string;
    open: boolean;
    onOpenChange: (open: boolean) => void;
    children: ReactNode;
};

/**
 * 화면 아래에서 올라오는 시트. 제목 버튼을 눌러 접고 편다.
 * 배리어프리 시트와 모양은 같지만, 화면낭독기로 쓰기 어려운 끌기 대신 버튼으로만 움직인다.
 */
export default function BottomSheet({
    title,
    open,
    onOpenChange,
    children,
}: BottomSheetProps) {
    return (
        <section
            className="bottom-sheet"
            aria-label={title}
            data-open={open || undefined}
        >
            <button
                type="button"
                className="bottom-sheet__header"
                aria-expanded={open}
                onClick={() => onOpenChange(!open)}
            >
                <span className="bottom-sheet__handle" aria-hidden="true" />
                <span className="bottom-sheet__title">{title}</span>
                <span className="visually-hidden">
                    {open ? '접기' : '펼치기'}
                </span>
            </button>
            {open && <div className="bottom-sheet__body">{children}</div>}
        </section>
    );
}
