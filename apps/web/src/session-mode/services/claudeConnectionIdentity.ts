import { create } from "zustand";
import { buildUrl } from "../hooks/runtime";

export interface ClaudeConnectionIdentity {
  endpoint: string;
  runtimeInstance: string;
  sessionId: string;
  eventSessionId: string;
  nativeSessionId: string | null;
  cwd: string;
  connected: boolean;
  running: boolean;
  error?: string;
}
export const useClaudeConnectionStore = create<{
  owners: Record<string, ClaudeConnectionIdentity>;
  errors: Record<string, string>;
}>(() => ({ owners: {}, errors: {} }));
const sequences = new Map<string, number>();
export function claudeConnectionOwner(id: string) {
  const owner = useClaudeConnectionStore.getState().owners[id];
  return owner?.endpoint === buildUrl("/api/cc/session-snapshot")
    ? owner
    : undefined;
}
export function claudeSessionMatchesEvent(id: string, eventId: string) {
  const owner = claudeConnectionOwner(id);
  return (
    id === eventId ||
    owner?.eventSessionId === eventId ||
    owner?.nativeSessionId === eventId
  );
}
export function claudeEventSequence(id: string) {
  return sequences.get(id) ?? 0;
}
export function noteClaudeEvent(id: string) {
  sequences.set(id, (sequences.get(id) ?? 0) + 1);
  if (sequences.size > 256) sequences.delete(sequences.keys().next().value!);
}
