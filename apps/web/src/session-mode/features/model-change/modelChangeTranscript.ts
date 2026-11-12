import { useCallback, useSyncExternalStore } from "react";
import type { ServerNotification } from "@session/bindings";
import {
  captureCodexOperationScope,
  isCodexOperationScopeCurrent,
  onCodexOperationScopeInvalidated,
  type CodexOperationScope,
} from "@session/services/codexOperationScope";
import {
  isCodexTranscriptDormant,
  onCodexTranscriptReleased,
} from "@session/services/codexTranscriptActivity";

type ModelIdentity = Readonly<{ model: string; provider: string }>;
export type ModelChangeAnnouncement = Readonly<{
  key: string;
  threadId: string;
  afterTurnId: string;
  from: ModelIdentity;
  to: ModelIdentity;
}>;
type Baseline = { identity: ModelIdentity; scope: CodexOperationScope };
const EMPTY: readonly ModelChangeAnnouncement[] = Object.freeze([]);
const baselines = new Map<string, Baseline>();
const announcements = new Map<string, readonly ModelChangeAnnouncement[]>();
const listeners = new Set<() => void>();
const MAX_THREADS = 64;
const MAX_CHANGES_PER_THREAD = 8;
let serial = 0;

function identity(value: { model?: unknown; modelProvider?: unknown }): ModelIdentity | null {
  const { model, modelProvider } = value;
  if (
    typeof model !== "string" || !model || model.length > 1024 ||
    typeof modelProvider !== "string" || !modelProvider || modelProvider.length > 128 ||
    /[\x00-\x1f\x7f]/.test(model + modelProvider)
  ) return null;
  return { model: Array.from(model).join(""), provider: Array.from(modelProvider).join("") };
}
function notify() {
  for (const listener of [...listeners]) listener();
}
function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}
function putBaseline(threadId: string, value: ModelIdentity) {
  baselines.delete(threadId);
  baselines.set(threadId, { identity: value, scope: captureCodexOperationScope() });
  while (baselines.size > MAX_THREADS) baselines.delete(baselines.keys().next().value!);
}

/** Seed only from a current native read or notification, never a persisted preference. */
export function rememberNativeModelBaseline(threadId: string, value: { model?: unknown; modelProvider?: unknown }) {
  const next = identity(value);
  if (!next || !threadId || isCodexTranscriptDormant(threadId)) return;
  putBaseline(threadId, next);
}

/** A settings notification proves the new pair; the old pair must have been
 * observed in this same account/runtime lifetime. The view contains no message
 * bodies and is discarded with the transcript. */
export function recordNativeModelChange(
  threadId: string,
  value: { model?: unknown; modelProvider?: unknown },
  events: readonly ServerNotification[],
) {
  const next = identity(value);
  if (!next || !threadId || isCodexTranscriptDormant(threadId)) return;
  const baseline = baselines.get(threadId);
  putBaseline(threadId, next);
  if (!baseline || !isCodexOperationScopeCurrent(baseline.scope)) return;
  const previous = baseline.identity;
  if (previous.model === next.model && previous.provider === next.provider) return;
  let afterTurnId: string | undefined;
  for (let i = events.length - 1; i >= 0; i--) {
    const event = events[i];
    if (!("threadId" in event.params) || event.params.threadId !== threadId) continue;
    if (event.method === "turn/started" || event.method === "turn/completed")
      afterTurnId = event.params.turn.id;
    else if ("turnId" in event.params && typeof event.params.turnId === "string")
      afterTurnId = event.params.turnId;
    if (afterTurnId) break;
  }
  if (!afterTurnId || afterTurnId.length > 160 || /[\x00-\x1f\x7f]/.test(afterTurnId)) return;
  const entry: ModelChangeAnnouncement = Object.freeze({
    key: `model-change-${++serial}`,
    threadId,
    afterTurnId,
    from: previous,
    to: next,
  });
  const previousEntries = announcements.get(threadId) ?? EMPTY;
  announcements.delete(threadId);
  announcements.set(threadId, Object.freeze([...previousEntries.slice(-(MAX_CHANGES_PER_THREAD - 1)), entry]));
  while (announcements.size > MAX_THREADS) announcements.delete(announcements.keys().next().value!);
  notify();
}

export function clearModelChangeAnnouncements(threadId?: string) {
  if (threadId !== undefined) {
    baselines.delete(threadId);
    if (announcements.delete(threadId)) notify();
    return;
  }
  baselines.clear();
  if (announcements.size) {
    announcements.clear();
    notify();
  }
}
export function getModelChangeAnnouncements(threadId: string) {
  return announcements.get(threadId) ?? EMPTY;
}
export function useModelChangeAnnouncements(threadId: string) {
  const get = useCallback(() => getModelChangeAnnouncements(threadId), [threadId]);
  return useSyncExternalStore(subscribe, get, get);
}

const stopRelease = onCodexTranscriptReleased(clearModelChangeAnnouncements);
const stopScope = onCodexOperationScopeInvalidated(() => clearModelChangeAnnouncements());
if (import.meta.hot) import.meta.hot.dispose(() => {
  stopRelease();
  stopScope();
  clearModelChangeAnnouncements();
});
