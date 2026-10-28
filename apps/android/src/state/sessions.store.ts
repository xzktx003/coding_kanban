import { create } from "zustand";
import type { AgentSessionRecord } from "@agent-orchestrator/shared";
import { listSessions } from "../api/boardApi";
import {
  getAttentionGroup,
  sortSessionsByAttention,
} from "../lib/sessionGroups";

export type SessionsState = {
  sessions: AgentSessionRecord[];
  loading: boolean;
  error: string | null;
  activeSessionId: string | null;
  lastRefreshedAt: number | null;
  load(): Promise<void>;
  setActiveSession(id: string | null): void;
  refresh(): Promise<void>;
};

export const useSessionsStore = create<SessionsState>((set, get) => ({
  sessions: [],
  loading: false,
  error: null,
  activeSessionId: null,
  lastRefreshedAt: null,

  async load() {
    set({ loading: true, error: null });
    try {
      const sessions = await listSessions();
      const activeSessionId =
        get().activeSessionId ??
        sortSessionsByAttention(sessions)[0]?.id ??
        null;
      set({
        sessions,
        loading: false,
        activeSessionId,
        lastRefreshedAt: Date.now(),
      });
    } catch (error) {
      set({
        loading: false,
        error: error instanceof Error ? error.message : "LOAD_FAILED",
      });
    }
  },

  setActiveSession(id) {
    set({ activeSessionId: id });
  },

  async refresh() {
    const wasLoading = get().loading;
    try {
      const sessions = await listSessions();
      const activeSessionId =
        get().activeSessionId &&
        sessions.some((s) => s.id === get().activeSessionId)
          ? get().activeSessionId
          : sortSessionsByAttention(sessions)[0]?.id ?? null;
      set({
        sessions,
        activeSessionId,
        lastRefreshedAt: Date.now(),
        loading: wasLoading,
        error: null,
      });
      return Promise.resolve();
    } catch (error) {
      set({
        error: error instanceof Error ? error.message : "LOAD_FAILED",
      });
      return Promise.resolve();
    }
  },
}));

// Convenience selector used by screens.
export function selectVisibleSessions(state: SessionsState): AgentSessionRecord[] {
  return state.sessions.filter((session) => !session.hidden);
}

export function selectGroupedSessions(
  state: SessionsState,
): Record<string, AgentSessionRecord[]> {
  const visible = selectVisibleSessions(state);
  const grouped: Record<string, AgentSessionRecord[]> = {};
  for (const session of visible) {
    const group = getAttentionGroup(session);
    grouped[group] = grouped[group] ?? [];
    grouped[group].push(session);
  }
  return grouped;
}
