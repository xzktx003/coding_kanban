import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { fmtElapsed } from '@session/components/agent/utils';
import type { TurnTiming } from '@session/components/codex/stores/useCodexStore';

/** "Working… 0:12" while the turn runs, then "Worked 0:34" from turn.durationMs. */
export function WorkingIndicator({
  turnTiming,
  retryNotice,
  hasLiveMessage = false,
}: {
  turnTiming: TurnTiming | undefined;
  retryNotice?: string;
  hasLiveMessage?: boolean;
}) {
  const { t } = useTranslation('thread');
  // Re-render only; elapsed is derived from startedAtMs, never stored.
  const [, setTick] = useState(0);
  const inProgress = turnTiming?.status === 'inProgress';

  useEffect(() => {
    if (!inProgress) return;

    const intervalId = setInterval(() => {
      setTick((t) => t + 1);
    }, 200);

    return () => clearInterval(intervalId);
  }, [inProgress]);

  const elapsed = inProgress && turnTiming && Number.isFinite(turnTiming.startedAtMs) &&
    turnTiming.startedAtMs >= 0
      ? Math.max(0, Date.now() - turnTiming.startedAtMs)
      : null;

  if (!turnTiming) return null;

  if (inProgress) {
    return (
      <div className="text-sm text-muted-foreground animate-pulse">
        {t('working')}{elapsed !== null ? ` ${fmtElapsed(elapsed)}` : ''}
        {retryNotice && (
          <span className="text-yellow-600 dark:text-yellow-400"> · {retryNotice}</span>
        )}
        {elapsed !== null &&
          elapsed >= 30_000 &&
          !retryNotice &&
          !hasLiveMessage && (
            <div className="mt-1 text-xs">{t('waitingForOutput')}</div>
          )}
      </div>
    );
  }

  if (typeof turnTiming.durationMs !== 'number' || !Number.isFinite(turnTiming.durationMs) || turnTiming.durationMs < 0) return null;

  return (
    <div className="text-xs text-muted-foreground/60">
      {t('worked')} {fmtElapsed(turnTiming.durationMs)}
    </div>
  );
}
