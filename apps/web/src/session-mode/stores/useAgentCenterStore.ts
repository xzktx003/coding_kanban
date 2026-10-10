import { create } from "zustand";
import { persist } from "zustand/middleware";
import {
  acknowledgeTabOperations,
  latestTabRevision,
  latestTabSnapshot,
  observeTabSnapshot,
  readTabOperations,
  saveTabOperation,
} from "../services/sessionTabJournal";

import {
  applySessionTabAction,
  type FollowedSession,
  type SessionTabAction,
  type SessionTabOperation,
  type SharedSessionTabs,
} from "@agent-orchestrator/shared";

export type AgentCenterCard = FollowedSession;
export const sharedCardMetadata = (card: AgentCenterCard): AgentCenterCard => ({
  kind: card.kind,
  id: card.id,
  ...(card.cwd !== undefined ? { cwd: card.cwd } : {}),
  ...(card.worktreePath !== undefined
    ? { worktreePath: card.worktreePath }
    : {}),
  ...(card.preview !== undefined
    ? { preview: card.preview.slice(0, 512) }
    : {}),
});

export const agentCardKey = (card: Pick<AgentCenterCard, "kind" | "id">) =>
  `${card.kind}:${card.id}`;
export function selectedAgentCard(
  state: Pick<
    AgentCenterState,
    "cards" | "currentAgentCardId" | "currentAgentCardKind"
  > & { detachedCard?: AgentCenterCard | null },
) {
  return (
    state.cards.find(
      (card) =>
        card.id === state.currentAgentCardId &&
        (!state.currentAgentCardKind ||
          card.kind === state.currentAgentCardKind),
    ) ??
    (state.detachedCard?.id === state.currentAgentCardId &&
    state.detachedCard?.kind === state.currentAgentCardKind
      ? state.detachedCard
      : undefined)
  );
}

// Multi-agent view layout mode: grid of cards, compact list (header only), or solo active card.
export type AgentCardsViewMode = "grid" | "list" | "solo";

// User-adjusted size for a solo card in grid mode (Ghostty-style manual resize).
// width is omitted until the user drags the right edge, letting the card fall back
// to the layout's natural flex-basis; height always has a value (defaults to h-72).
export interface AgentCardSize {
  width?: number;
  height: number;
}

interface AgentCenterState {
  detachedCard: AgentCenterCard | null;
  syncClientId: string;
  nextTabSequence: number;
  pendingTabOperations: SessionTabOperation[];
  sharedTabsInitialized: boolean;
  tabSyncError: string | null;
  acceptSharedTabs: (
    snapshot: SharedSessionTabs,
    acknowledgedSequence?: number,
    acknowledgedIds?: string[],
  ) => boolean;
  refreshTabOperations: () => void;
  cards: AgentCenterCard[];
  addAgentCard: (
    card: AgentCenterCard,
    options?: { activate?: boolean },
  ) => boolean;
  removeCard: (card: AgentCenterCard) => void;
  moveCard: (card: AgentCenterCard, target: AgentCenterCard) => void;
  /** Precise insertion, unlike moveCard's historical move-to-index behavior. */
  reorderCard: (key: string, beforeKey: string | null) => void;
  updateCard: (card: AgentCenterCard) => void;
  currentAgentCardId: string | null;
  currentAgentCardKind: AgentCenterCard["kind"] | null;
  setCurrentAgentCardId: (
    id: string | null,
    kind?: AgentCenterCard["kind"],
  ) => void;
  cardsViewMode: AgentCardsViewMode;
  setCardsViewMode: (mode: AgentCardsViewMode) => void;
  cardSizeMap: Record<string, AgentCardSize>;
  setCardSize: (cardId: string, size: AgentCardSize) => void;
}

function enqueue(state: AgentCenterState, action: SessionTabAction) {
  if (action.type === "add" || action.type === "update")
    action = { ...action, card: sharedCardMetadata(action.card) };
  return {
    nextTabSequence: state.nextTabSequence + 1,
    pendingTabOperations: [
      ...state.pendingTabOperations,
      saveTabOperation(action, state.nextTabSequence),
    ],
  };
}

export const useAgentCenterStore = create<AgentCenterState>()(
  persist(
    (set) => ({
      cards: [],
      detachedCard: null,
      syncClientId: crypto.randomUUID(),
      nextTabSequence: 1,
      pendingTabOperations: [],
      sharedTabsInitialized: false,
      tabSyncError: null,
      refreshTabOperations: () =>
        set((state) => {
          const pending = [
            ...state.pendingTabOperations.filter((op) => !op.id),
            ...readTabOperations(),
          ];
          if (
            JSON.stringify(pending) ===
            JSON.stringify(state.pendingTabOperations)
          )
            return state;
          return {
            pendingTabOperations: pending,
            cards: pending.reduce(
              (cards, op) => applySessionTabAction(cards, op.action),
              state.cards,
            ),
          };
        }),
      acceptSharedTabs: (
        snapshot,
        acknowledgedSequence = 0,
        acknowledgedIds = [],
      ) => {
        const fresh = snapshot.revision >= latestTabRevision();
        if (fresh) observeTabSnapshot(snapshot);
        set((state) => {
          acknowledgeTabOperations(acknowledgedIds);
          const pending = [
            ...state.pendingTabOperations.filter(
              (op) => !op.id && op.seq > acknowledgedSequence,
            ),
            ...readTabOperations(),
          ];
          if (!fresh)
            return {
              pendingTabOperations: pending,
              tabSyncError: null,
            };
          const cards = pending.reduce(
            (current, op) => applySessionTabAction(current, op.action),
            snapshot.cards,
          );
          const active = selectedAgentCard(state);
          const detachedCard =
            active &&
            !cards.some((c) => agentCardKey(c) === agentCardKey(active))
              ? active
              : null;
          const next = {
            cards:
              JSON.stringify(cards) === JSON.stringify(state.cards)
                ? state.cards
                : cards,
            pendingTabOperations:
              JSON.stringify(pending) ===
              JSON.stringify(state.pendingTabOperations)
                ? state.pendingTabOperations
                : pending,
            sharedTabsInitialized: snapshot.initialized,
            nextTabSequence: Math.max(
              state.nextTabSequence,
              acknowledgedSequence + 1,
            ),
            detachedCard,
            tabSyncError: null,
          };
          // Polling unchanged data must not rerender every subscribed transcript.
          return Object.entries(next).every(
            ([key, value]) => state[key as keyof typeof state] === value,
          )
            ? state
            : next;
        });
        return fresh;
      },

      // Returns true if the card was added/updated.
      addAgentCard: (card, { activate = true } = {}) => {
        let added = false;
        set((state) => {
          const idx = state.cards.findIndex(
            (c) => c.kind === card.kind && c.id === card.id,
          );
          // Update existing card metadata without dropping a saved worktree path.
          if (idx !== -1) {
            const next = [...state.cards];
            next[idx] = {
              ...next[idx],
              ...card,
              worktreePath: card.worktreePath ?? next[idx].worktreePath,
            } as AgentCenterCard;
            added = true;
            return {
              ...(JSON.stringify(next[idx]) !== JSON.stringify(state.cards[idx])
                ? enqueue(state, { type: "add", card: next[idx] })
                : {}),
              cards: next,
              ...(activate
                ? {
                    detachedCard: null,
                    currentAgentCardId: card.id,
                    currentAgentCardKind: card.kind,
                  }
                : {}),
            };
          }
          added = true;
          return {
            ...enqueue(state, { type: "add", card }),
            cards: [...state.cards, card],
            ...(activate
              ? {
                  detachedCard: null,
                  currentAgentCardId: card.id,
                  currentAgentCardKind: card.kind,
                }
              : {}),
          };
        });
        return added;
      },

      removeCard: (card) =>
        set((state) => {
          const index = state.cards.findIndex(
            (c) => agentCardKey(c) === agentCardKey(card),
          );
          if (index < 0) {
            if (
              state.detachedCard &&
              agentCardKey(state.detachedCard) === agentCardKey(card)
            )
              return {
                detachedCard: null,
                currentAgentCardId: null,
                currentAgentCardKind: null,
              };
            return state;
          }
          const active = selectedAgentCard(state);
          const cards = state.cards.filter(
            (c) => agentCardKey(c) !== agentCardKey(card),
          );
          if (!active || agentCardKey(active) !== agentCardKey(card))
            return {
              cards,
              ...enqueue(state, { type: "remove", key: agentCardKey(card) }),
            };
          const next = cards[index] ?? cards[index - 1];
          return {
            ...enqueue(state, { type: "remove", key: agentCardKey(card) }),
            detachedCard: null,
            cards,
            currentAgentCardId: next?.id ?? null,
            currentAgentCardKind: next?.kind ?? null,
          };
        }),

      moveCard: (card, target) =>
        set((state) => {
          const from = state.cards.findIndex(
            (c) => agentCardKey(c) === agentCardKey(card),
          );
          const to = state.cards.findIndex(
            (c) => agentCardKey(c) === agentCardKey(target),
          );
          if (from < 0 || to < 0 || from === to) return state;
          const cards = [...state.cards];
          const [moved] = cards.splice(from, 1);
          cards.splice(to, 0, moved);
          return {
            cards,
            ...enqueue(state, {
              type: "move",
              key: agentCardKey(card),
              beforeKey: cards[to + 1] ? agentCardKey(cards[to + 1]) : null,
            }),
          };
        }),

      reorderCard: (key, beforeKey) => set((state) => {
        if (!state.cards.some(card => agentCardKey(card) === key) ||
            (beforeKey !== null && !state.cards.some(card => agentCardKey(card) === beforeKey))) return state;
        const action: SessionTabAction = { type: 'move', key, beforeKey };
        const cards = applySessionTabAction(state.cards, action);
        if (cards.every((card, index) => card === state.cards[index])) return state;
        return { cards, ...enqueue(state, action) };
      }),

      updateCard: (card) =>
        set((state) => ({
          ...enqueue(state, { type: "update", card }),
          cards: state.cards.map((existing) =>
            existing.kind === card.kind && existing.id === card.id
              ? ({ ...existing, ...card } as AgentCenterCard)
              : existing,
          ),
        })),

      currentAgentCardId: null,
      currentAgentCardKind: null,
      setCurrentAgentCardId: (id, kind) =>
        set((state) => ({
          detachedCard:
            state.detachedCard?.id === id &&
            (!kind || state.detachedCard.kind === kind)
              ? state.detachedCard
              : null,
          currentAgentCardId: id,
          currentAgentCardKind: id
            ? (kind ??
              state.cards.find(
                (c) => c.id === id && c.kind === state.currentAgentCardKind,
              )?.kind ??
              state.cards.find((c) => c.id === id)?.kind ??
              null)
            : null,
        })),

      cardsViewMode: "solo",
      setCardsViewMode: (mode) => set({ cardsViewMode: mode }),

      cardSizeMap: {},
      setCardSize: (cardId, size) =>
        set((state) => ({
          cardSizeMap: { ...state.cardSizeMap, [cardId]: size },
        })),
    }),
    {
      name: "kanban.session.agent-center-store",
      version: 5,
      migrate: (
        persistedState: unknown,
      ): Pick<
        AgentCenterState,
        | "cards"
        | "currentAgentCardId"
        | "currentAgentCardKind"
        | "cardsViewMode"
        | "cardSizeMap"
      > => {
        const old = persistedState as Partial<AgentCenterState> | undefined;
        // Legacy cards accumulated through browsing. Start an intentional tab set;
        // the mounted workspace retains its current conversation during migration.
        return {
          cards: [],
          currentAgentCardId: null,
          currentAgentCardKind: null,
          cardsViewMode:
            old?.cardsViewMode === "grid" || old?.cardsViewMode === "list"
              ? old.cardsViewMode
              : "solo",
          cardSizeMap: old?.cardSizeMap ?? {},
        };
      },
      partialize: (state) => ({
        cards: state.cards,
        currentAgentCardId: state.currentAgentCardId,
        currentAgentCardKind: state.currentAgentCardKind,
        cardsViewMode: state.cardsViewMode,
        cardSizeMap: state.cardSizeMap,
        // A remotely closed reading target is temporary, never a restorable tab.
        syncClientId: state.syncClientId,
        nextTabSequence: state.nextTabSequence,
        // New actions live under independent keys, not this shared cache blob.
        pendingTabOperations: state.pendingTabOperations.filter((op) => !op.id),
        sharedTabsInitialized: state.sharedTabsInitialized,
      }),
      merge: (persisted, current) => {
        const state = {
          ...current,
          ...(persisted as Partial<AgentCenterState>),
          detachedCard: null,
        };
        try {
          const snapshot = latestTabSnapshot();
          const pending = [
            ...state.pendingTabOperations.filter((op) => !op.id),
            ...readTabOperations(),
          ];
          return {
            ...state,
            pendingTabOperations: pending,
            cards: pending.reduce(
              (cards, op) => applySessionTabAction(cards, op.action),
              snapshot?.cards ?? state.cards,
            ),
            sharedTabsInitialized:
              snapshot?.initialized ?? state.sharedTabsInitialized,
          };
        } catch {
          return {
            ...state,
            tabSyncError: "本机标签同步记录无法读取，请检查浏览器存储",
          };
        }
      },
    },
  ),
);
