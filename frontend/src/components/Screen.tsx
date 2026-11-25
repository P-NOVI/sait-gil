import type { ReactNode } from 'react';
import { useId } from 'react';

export type ScreenName = 'home' | 'search' | 'route' | 'settings';

type ScreenProps = {
    title: string;
    /** 없으면 뒤로 버튼을 그리지 않는다. */
    onBack?: () => void;
    children: ReactNode;
};

/** 홈이 아닌 화면의 틀: 위에 뒤로 버튼과 제목, 아래에 내용. */
export default function Screen({ title, onBack, children }: ScreenProps) {
    const titleId = useId();
    return (
        <section className="screen" aria-labelledby={titleId}>
            <header className="screen__header">
                {onBack && (
                    <button
                        type="button"
                        className="screen__back"
                        onClick={onBack}
                    >
                        <svg viewBox="0 0 24 24" aria-hidden="true">
                            <path d="M15 5l-7 7 7 7" />
                        </svg>
                        뒤로
                    </button>
                )}
                <h2 id={titleId} className="screen__title">
                    {title}
                </h2>
            </header>
            <div className="screen__body">{children}</div>
        </section>
    );
}
