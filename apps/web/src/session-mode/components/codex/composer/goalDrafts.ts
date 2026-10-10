import { create } from "zustand";
import { persist } from "zustand/middleware";
import { useCallback } from "react";
export type GoalDraft = { enabled: boolean; revision: number };
const EMPTY: GoalDraft = Object.freeze({ enabled: false, revision: 0 });
type GoalDraftState = {
  owners: Record<string, GoalDraft>;
  legacyMigrated: boolean;
};
export const useGoalDraftStore = create<GoalDraftState>()(
  persist<GoalDraftState>(() => ({ owners: {}, legacyMigrated: false }), {
    name: "kanban.session.codex-goal-drafts",
    version: 1,
    migrate: (saved) => {
      const old = saved as {
        owners?: Record<string, GoalDraft | boolean>;
        legacyMigrated?: boolean;
      };
      return {
        legacyMigrated: old.legacyMigrated === true,
        owners: Object.fromEntries(
          Object.entries(old.owners ?? {}).map(([owner, draft]) => [
            owner,
            typeof draft === "boolean"
              ? { enabled: draft, revision: 0 }
              : {
                  enabled: draft.enabled === true,
                  revision:
                    Number.isSafeInteger(draft.revision) && draft.revision >= 0
                      ? draft.revision
                      : 0,
                },
          ]),
        ),
      };
    },
  }),
);
export const goalDrafts = {
  read: (owner: string): GoalDraft =>
    useGoalDraftStore.getState().owners[owner] ?? EMPTY,
  set: (owner: string, enabled: boolean) =>
    useGoalDraftStore.setState((state) => {
      const previous = state.owners[owner] ?? EMPTY;
      return previous.enabled === enabled
        ? state
        : {
            owners: {
              ...state.owners,
              [owner]: { enabled, revision: previous.revision + 1 },
            },
          };
    }),
  complete: (owner: string, snapshot: GoalDraft) => {
    const current = goalDrafts.read(owner);
    if (
      current.revision === snapshot.revision &&
      current.enabled === snapshot.enabled
    )
      goalDrafts.set(owner, false);
  },
  /** New-thread identity follows the same draft move; a pre-existing target keeps its own opt-in. */
  move: (from: string, to: string) => {
    const state = useGoalDraftStore.getState();
    if (from === to) return true;
    const source = state.owners[from];
    if (!source || state.owners[to]) return false;
    const owners = { ...state.owners, [to]: source };
    delete owners[from];
    useGoalDraftStore.setState({ owners });
    return true;
  },
  /** A live legacy flag can be attributed once, only to the captured active draft. */
  migrateLegacy: (owner: string, enabled: boolean) => {
    const state = useGoalDraftStore.getState();
    if (state.legacyMigrated) return;
    useGoalDraftStore.setState({
      legacyMigrated: true,
      owners:
        state.owners[owner] || !enabled
          ? state.owners
          : { ...state.owners, [owner]: { enabled: true, revision: 1 } },
    });
  },
};
export function useGoalDraft(owner: string) {
  const entry = useGoalDraftStore((state) => state.owners[owner]) ?? EMPTY;
  const setEnabled = useCallback(
    (enabled: boolean) => goalDrafts.set(owner, enabled),
    [owner],
  );
  return { ...entry, setEnabled };
}
