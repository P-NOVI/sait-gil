import type { OnboardingLine } from '../lib/onboarding';
import Screen from './Screen';

type OnboardingScreenProps = {
    line: OnboardingLine;
    /** 묻는 권한 수 */
    total: number;
    /** 음성 안내를 켰으면 앱이 읽으므로 화면낭독기가 같은 문장을 또 읽지 않게 한다. */
    voice: boolean;
};

/** 앱을 처음 열 때 시작 안내 화면: 지금 읽는 문장과 몇 번째 권한을 묻는지 */
export default function OnboardingScreen({
    line,
    total,
    voice,
}: OnboardingScreenProps) {
    return (
        <Screen
            title="시작 안내"
            status={line.step !== null ? `권한 ${line.step} / ${total}` : null}
        >
            <div className="onboarding">
                <p
                    className="onboarding__text"
                    aria-live={voice ? 'off' : 'polite'}
                >
                    {line.text}
                </p>
                {line.step !== null && (
                    <p className="onboarding__hint">
                        권한 창이 뜨면 허용을 누르세요.
                    </p>
                )}
            </div>
        </Screen>
    );
}
