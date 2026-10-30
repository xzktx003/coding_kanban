import {
  capturePluginScope,
  isPluginScopeCurrent,
} from "@session/features/plugins/pluginScope";
import { pluginInstalled } from "@session/services/apiAdapt/codex";
import { codexService } from "@session/services/codexService";

type PendingKey = {
  cwd: string | null;
  revision: number;
  scopeRevision: number;
  scope: ReturnType<typeof capturePluginScope>;
};
type CandidateResults = [
  PromiseSettledResult<Awaited<ReturnType<typeof pluginInstalled>>>,
  PromiseSettledResult<Awaited<ReturnType<typeof codexService.listSkills>>>,
];

// This index shares concurrent reads, never completed candidates. Stalled reads
// cannot grow the index without bound; eviction does not cancel any consumer.
const maxPendingReads = 32;
const pending = new Map<PendingKey, Promise<CandidateResults>>();

export function loadMentionCandidates(
  key: PendingKey,
): Promise<CandidateResults> {
  for (const [other, promise] of pending) {
    if (
      other.cwd === key.cwd &&
      other.revision === key.revision &&
      other.scopeRevision === key.scopeRevision &&
      // Both captures must still match the complete live scope, including
      // account revocations, runtime, endpoint and device authorization. Reuse
      // the captured scopes rather than serialize another key with credentials.
      isPluginScopeCurrent(key.scope) &&
      isPluginScopeCurrent(other.scope)
    )
      return promise;
  }

  const promise = Promise.allSettled([
    pluginInstalled({ cwds: key.cwd ? [key.cwd] : [] }),
    codexService.listSkills(key.cwd),
  ]);
  if (pending.size >= maxPendingReads)
    pending.delete(pending.keys().next().value!);
  pending.set(key, promise);
  void promise.finally(() => {
    if (pending.get(key) === promise) pending.delete(key);
  });
  return promise;
}

if (import.meta.hot) import.meta.hot.dispose(() => pending.clear());
