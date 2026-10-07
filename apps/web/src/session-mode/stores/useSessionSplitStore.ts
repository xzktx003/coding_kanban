import { create } from "zustand";
import { persist } from "zustand/middleware";

export type SplitEdge = "left" | "right" | "top" | "bottom" | "center";
export type SessionGroup = {
  type: "group";
  id: string;
  keys: string[];
  selected: string | null;
};
export type SessionSplit = {
  type: "split";
  id: string;
  direction: "horizontal" | "vertical";
  ratio: number;
  first: SessionSplitNode;
  second: SessionSplitNode;
};
export type SessionSplitNode = SessionGroup | SessionSplit;
const group = (keys: string[] = []): SessionGroup => ({
  type: "group",
  id: crypto.randomUUID(),
  keys,
  selected: keys[0] ?? null,
});
export const splitGroups = (node: SessionSplitNode): SessionGroup[] =>
  node.type === "group"
    ? [node]
    : [...splitGroups(node.first), ...splitGroups(node.second)];
const mapGroups = (
  node: SessionSplitNode,
  fn: (g: SessionGroup) => SessionGroup,
): SessionSplitNode =>
  node.type === "group"
    ? fn(node)
    : {
        ...node,
        first: mapGroups(node.first, fn),
        second: mapGroups(node.second, fn),
      };
function prune(node: SessionSplitNode): SessionSplitNode | null {
  if (node.type === "group") return node.keys.length ? node : null;
  const first = prune(node.first),
    second = prune(node.second);
  return first && second ? { ...node, first, second } : (first ?? second);
}
function replace(
  node: SessionSplitNode,
  id: string,
  next: SessionSplitNode,
): SessionSplitNode {
  if (node.id === id) return next;
  return node.type === "group"
    ? node
    : {
        ...node,
        first: replace(node.first, id, next),
        second: replace(node.second, id, next),
      };
}
interface State {
  tree: SessionSplitNode;
  activeGroupId: string;
  reconcile: (keys: string[]) => void;
  focusGroup: (id: string) => void;
  focusKey: (key: string) => void;
  place: (
    key: string,
    targetId: string,
    edge: SplitEdge,
    beforeKey?: string,
  ) => void;
  resize: (id: string, ratio: number) => void;
  reset: () => void;
}
const initial = () => {
  const tree = group();
  return { tree, activeGroupId: tree.id };
};
export const useSessionSplitStore = create<State>()(
  persist(
    (set) => ({
      ...initial(),
      reset: () => set(initial()),
      reconcile: (keys) =>
        set((state) => {
          const allowed = new Set(keys),
            seen = new Set<string>();
          let tree = mapGroups(state.tree, (g) => {
            const remaining = g.keys.filter(
              (k) => allowed.has(k) && !seen.has(k) && Boolean(seen.add(k)),
            );
            return {
              ...g,
              keys: remaining,
              selected: remaining.includes(g.selected ?? "")
                ? g.selected
                : (remaining[0] ?? null),
            };
          });
          const groups = splitGroups(tree);
          const target =
            groups.find((g) => g.id === state.activeGroupId) ?? groups[0];
          const added = keys.filter((k) => !seen.has(k));
          if (added.length)
            tree = mapGroups(tree, (g) =>
              g.id === target.id
                ? {
                    ...g,
                    keys: [...g.keys, ...added],
                    selected: g.selected ?? added[0],
                  }
                : g,
            );
          tree = prune(tree) ?? { ...groups[0], keys: [], selected: null };
          const activeGroupId = splitGroups(tree).some(
            (g) => g.id === state.activeGroupId,
          )
            ? state.activeGroupId
            : splitGroups(tree)[0].id;
          return JSON.stringify(tree) === JSON.stringify(state.tree) &&
            activeGroupId === state.activeGroupId
            ? state
            : { tree, activeGroupId };
        }),
      focusGroup: (id) =>
        set((state) =>
          splitGroups(state.tree).some((g) => g.id === id)
            ? { activeGroupId: id }
            : state,
        ),
      focusKey: (key) =>
        set((state) => {
          const owner = splitGroups(state.tree).find((g) =>
            g.keys.includes(key),
          );
          return !owner
            ? state
            : {
                activeGroupId: owner.id,
                tree: mapGroups(state.tree, (g) =>
                  g.id === owner.id ? { ...g, selected: key } : g,
                ),
              };
        }),
      place: (key, targetId, edge, beforeKey) =>
        set((state) => {
          const groups = splitGroups(state.tree),
            owner = groups.find((g) => g.keys.includes(key)),
            target = groups.find((g) => g.id === targetId);
          if (
            !owner ||
            !target ||
            (owner.id === targetId &&
              owner.keys.length === 1 &&
              edge !== "center")
          )
            return state;
          let tree = mapGroups(state.tree, (g) => {
            const keys = g.keys.filter((k) => k !== key);
            return {
              ...g,
              keys,
              selected: g.selected === key ? (keys[0] ?? null) : g.selected,
            };
          });
          const current = splitGroups(tree).find((g) => g.id === targetId)!;
          let focused: SessionGroup;
          if (edge === "center") {
            const keys = [...current.keys],
              index = beforeKey ? keys.indexOf(beforeKey) : -1;
            keys.splice(index < 0 ? keys.length : index, 0, key);
            focused = { ...current, keys, selected: key };
            tree = replace(tree, targetId, focused);
          } else {
            focused = group([key]);
            const leading = edge === "left" || edge === "top";
            tree = replace(tree, targetId, {
              type: "split",
              id: crypto.randomUUID(),
              direction:
                edge === "left" || edge === "right" ? "horizontal" : "vertical",
              ratio: 50,
              first: leading ? focused : current,
              second: leading ? current : focused,
            });
          }
          return { tree: prune(tree) ?? focused, activeGroupId: focused.id };
        }),
      resize: (id, ratio) =>
        set((state) => {
          const visit = (n: SessionSplitNode): SessionSplitNode =>
            n.type === "group"
              ? n
              : {
                  ...n,
                  ratio:
                    n.id === id && Number.isFinite(ratio)
                      ? Math.max(15, Math.min(85, ratio))
                      : n.ratio,
                  first: visit(n.first),
                  second: visit(n.second),
                };
          return { tree: visit(state.tree) };
        }),
    }),
    {
      name: "kanban.session.split-layout",
      version: 1,
      partialize: (s) => ({ tree: s.tree, activeGroupId: s.activeGroupId }),
    },
  ),
);
