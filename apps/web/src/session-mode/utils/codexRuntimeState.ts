import type { CodexStore, TurnTiming } from '../components/codex/stores/types';

type Source = Pick<CodexStore, 'currentThreadId' | 'currentTurnId' | 'threadStatusMap' | 'turnTimingMap' | 'threads'>;
/** All interaction gates and status surfaces read the same reconciled facts. */
export function codexRuntimeState(state: Source, id: string | null | undefined) {
  const status = id ? state.threadStatusMap[id] ?? state.threads.find(t => t.id === id)?.status : undefined;
  const timing = id ? state.turnTimingMap[id] : undefined;
  const failed = status?.type === 'systemError' || timing?.status === 'failed';
  const finished = !!timing && timing.status !== 'inProgress';
  const running = !!id && !failed && !finished &&
    (timing?.status === 'inProgress' || status?.type === 'active' || (state.currentThreadId === id && !!state.currentTurnId));
  const turnId = running ? timing?.turnId ?? (state.currentThreadId === id ? state.currentTurnId : null) : null;
  const pending = running && status?.type === 'active' && status.activeFlags.length > 0;
  const known = !!timing || (!!status && status.type !== 'notLoaded');
  return { running, turnId, failed, finished, pending, known, canSteer: running && !!turnId, canStop: running && !!turnId };
}

/** A duplicate/replayed start cannot revive a terminal or chronologically newer turn. */
export function acceptTurnStart(existing: TurnTiming | undefined, turn: { id: string; startedAt?: number | null }) {
  if (!existing) return true;
  if (existing.turnId === turn.id) return existing.status === 'inProgress';
  return typeof turn.startedAt !== 'number' || existing.startedAtMs <= turn.startedAt * 1000;
}
