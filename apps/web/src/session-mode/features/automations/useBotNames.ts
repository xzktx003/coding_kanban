import { useEffect, useMemo } from 'react';
import { listBots } from '@session/services/apiAdapt/bots';
import { useBotUiStore } from '@session/stores/useBotUiStore';

/** Bot names by id. Loads the bots once if the Bot tab has not filled the store yet. */
export function useBotNames(): Record<string, string> {
  const bots = useBotUiStore((state) => state.bots);
  const setBots = useBotUiStore((state) => state.setBots);
  const empty = bots.length === 0;

  useEffect(() => {
    if (!empty) return;
    listBots()
      .then(setBots)
      .catch(() => {});
  }, [empty, setBots]);

  return useMemo(() => Object.fromEntries(bots.map((bot) => [bot.id, bot.name])), [bots]);
}
