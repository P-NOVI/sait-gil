import { type ReactNode, useId } from 'react';

import Icon from './Icon';

export type ScreenName = 'home' | 'search' | 'route' | 'settings' | 'set-home';

type ScreenProps = {
    title: string;
    /** 뒤로·처음 버튼. 둘 다 없으면(첫 화면·길안내) 그 줄을 그리지 않는다. */
    onBack?: () => void;
    onHome?: () => void;
    /** 맨 아래 상태 한 줄 */
    status?: ReactNode;
    children: ReactNode;
};

/** 모든 화면의 틀: 위에 제목과 뒤로·처음 줄, 가운데 내용, 맨 아래 상태 한 줄 */
export default function Screen({
    title,
    onBack,
    onHome,
    status,
    children,
}: ScreenProps) {
    const titleId = useId();
    return (
        <section className="screen" aria-labelledby={titleId}>
            <h1 id={titleId} className="screen__title">
                {title}
            </h1>
            {(onBack || onHome) && (
                <nav className="screen__nav" aria-label="화면 이동">
                    {onBack && (
                        <button type="button" onClick={onBack}>
                            <Icon name="back" />
                            뒤로
                        </button>
                    )}
                    {onHome && (
                        <button type="button" onClick={onHome}>
                            <Icon name="home" />
                            처음
                        </button>
                    )}
                </nav>
            )}
            <div className="screen__body">{children}</div>
            {status && <footer className="screen__status">{status}</footer>}
        </section>
    );
}
