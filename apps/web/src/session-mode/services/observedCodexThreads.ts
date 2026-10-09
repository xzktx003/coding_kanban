import { useCodexStore } from "../components/codex/stores/useCodexStore";
import { useSubagentStore } from "../features/subagents/store";
import { openedCodexIds } from "./openedSessions";

/** Transcript ownership follows display/observation, never native execution ownership. */
export function isObservedCodexThread(id: string): boolean {
  const roots = new Set(openedCodexIds());
  const current = useCodexStore.getState().currentThreadId;
  if (current) roots.add(current);
  const nodes = useSubagentStore.getState().nodes;
  const seen = new Set<string>();
  let next: string | undefined = id;
  while (next && !seen.has(next)) {
    if (roots.has(next)) return true;
    seen.add(next);
    next = nodes[next]?.parentId;
  }
  return false;
}
