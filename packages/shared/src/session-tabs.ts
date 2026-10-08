/** Only this collection is shared. Selection, drafts, scrolling and layout are device-local. */
export interface FollowedSession {
  kind: "codex" | "cc";
  id: string;
  preview?: string;
  worktreePath?: string;
  cwd?: string | null;
}
export type SessionTabAction =
  | { type: "add"; card: FollowedSession }
  | { type: "update"; card: FollowedSession }
  | { type: "remove"; key: string }
  | { type: "move"; key: string; beforeKey: string | null };
export interface SessionTabOperation {
  /** Stable per-action retry identity; never shared with another page's action. */
  id?: string;
  seq: number;
  action: SessionTabAction;
}
export interface SharedSessionTabs {
  initialized: boolean;
  revision: number;
  cards: FollowedSession[];
}
export interface SessionTabsRequest {
  clientId: string;
  operations: SessionTabOperation[];
  seed?: FollowedSession[];
}
export const followedSessionKey = (
  card: Pick<FollowedSession, "kind" | "id">,
) => `${card.kind}:${card.id}`;
export function applySessionTabAction(
  cards: FollowedSession[],
  action: SessionTabAction,
): FollowedSession[] {
  if (action.type === "add" || action.type === "update") {
    const index = cards.findIndex(
      (c) => followedSessionKey(c) === followedSessionKey(action.card),
    );
    if (index < 0)
      return action.type === "add" ? [...cards, action.card] : cards;
    const result = [...cards];
    result[index] = {
      ...cards[index],
      ...action.card,
      worktreePath: action.card.worktreePath ?? cards[index].worktreePath,
    };
    return result;
  }
  const index = cards.findIndex((c) => followedSessionKey(c) === action.key);
  if (index < 0) return cards;
  if (action.type === "remove") return cards.filter((_, i) => i !== index);
  if (action.beforeKey === action.key) return cards;
  const result = cards.filter((_, i) => i !== index);
  const target =
    action.beforeKey === null
      ? -1
      : result.findIndex((c) => followedSessionKey(c) === action.beforeKey);
  result.splice(target < 0 ? result.length : target, 0, cards[index]);
  return result;
}
