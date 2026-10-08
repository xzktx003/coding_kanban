import { beforeEach, expect, it } from "vitest";
import { useSessionSplitStore, splitGroups } from "./useSessionSplitStore";
beforeEach(() => useSessionSplitStore.getState().reset());
it("splits right then down into a nested three-pane layout without duplicating sessions", () => {
  const s = useSessionSplitStore.getState();
  s.reconcile(["codex:a", "codex:b", "codex:c"]);
  const first = splitGroups(useSessionSplitStore.getState().tree)[0].id;
  s.place("codex:b", first, "right");
  s.place("codex:c", first, "bottom");
  const groups = splitGroups(useSessionSplitStore.getState().tree);
  expect(groups.map((g) => g.keys)).toEqual([
    ["codex:a"],
    ["codex:c"],
    ["codex:b"],
  ]);
  expect(useSessionSplitStore.getState().tree.type).toBe("split");
  expect(new Set(groups.flatMap((g) => g.keys)).size).toBe(3);
});
it("moving the last tab into another group collapses the empty branch", () => {
  const s = useSessionSplitStore.getState();
  s.reconcile(["a", "b"]);
  const root = splitGroups(useSessionSplitStore.getState().tree)[0].id;
  s.place("b", root, "right");
  s.place("b", root, "center");
  expect(splitGroups(useSessionSplitStore.getState().tree)).toHaveLength(1);
  expect(splitGroups(useSessionSplitStore.getState().tree)[0].keys).toEqual([
    "a",
    "b",
  ]);
});
it("assigns new sessions to the focused group and focuses existing sessions where they live", () => {
  const s = useSessionSplitStore.getState();
  s.reconcile(["a", "b"]);
  const root = splitGroups(useSessionSplitStore.getState().tree)[0].id;
  s.place("b", root, "right");
  s.reconcile(["a", "b", "c"]);
  expect(splitGroups(useSessionSplitStore.getState().tree)[1].keys).toEqual([
    "b",
    "c",
  ]);
  s.focusKey("a");
  expect(useSessionSplitStore.getState().activeGroupId).toBe(root);
});
it("splits the sole tab into a saved empty group and preserves ratios and group selection on reload", async () => {
  const s = useSessionSplitStore.getState();
  s.reconcile(["a"]);
  const root = splitGroups(useSessionSplitStore.getState().tree)[0].id;
  s.place("a", root, "right");
  expect(splitGroups(useSessionSplitStore.getState().tree).map(g => g.keys)).toEqual([[], ["a"]]);
  s.reconcile(["a"]);
  expect(splitGroups(useSessionSplitStore.getState().tree)).toHaveLength(2);
  const tree = useSessionSplitStore.getState().tree;
  s.resize(tree.id, 35);
  const saved = localStorage.getItem("kanban.session.split-layout")!;
  s.reset();
  localStorage.setItem("kanban.session.split-layout", saved);
  await useSessionSplitStore.persist.rehydrate();
  expect(useSessionSplitStore.getState().tree).toMatchObject({
    type: "split",
    ratio: 35,
  });
  expect(splitGroups(useSessionSplitStore.getState().tree).map(g => g.keys)).toEqual([[], ["a"]]);
});

it("an explicitly empty group accepts a new session and later closes normally", () => {
  const s = useSessionSplitStore.getState();
  s.reconcile(["a"]);
  const root = splitGroups(useSessionSplitStore.getState().tree)[0].id;
  s.place("a", root, "right");
  s.focusGroup(root);
  s.reconcile(["a", "b"]);
  expect(splitGroups(useSessionSplitStore.getState().tree).map(g => g.keys)).toEqual([["b"], ["a"]]);
  s.reconcile(["a"]);
  expect(splitGroups(useSessionSplitStore.getState().tree).map(g => g.keys)).toEqual([["a"]]);
});

it("closes only an empty window group and leaves the existing Agent and layout intact", () => {
  const s = useSessionSplitStore.getState();
  s.reconcile(["a"]);
  const groupId = useSessionSplitStore.getState().tree.id;
  s.place("a", groupId, "right");
  const filled = splitGroups(useSessionSplitStore.getState().tree).find(group => group.keys.length)!;
  s.closeEmptyGroup(filled.id);
  expect(splitGroups(useSessionSplitStore.getState().tree)).toHaveLength(2);
  s.closeEmptyGroup(groupId);
  expect(splitGroups(useSessionSplitStore.getState().tree).map(group => group.keys)).toEqual([["a"]]);
  expect(useSessionSplitStore.getState().activeGroupId).toBe(filled.id);
});

it("clears the empty-window marker when an existing tab moves into that window", () => {
  const s = useSessionSplitStore.getState();
  s.reconcile(["a"]);
  const root = useSessionSplitStore.getState().tree.id;
  s.place("a", root, "right");
  s.reconcile(["a", "b"]);
  s.place("a", root, "center");
  s.reconcile(["b"]);
  expect(splitGroups(useSessionSplitStore.getState().tree).map(group => group.keys)).toEqual([["b"]]);
});
it("remote removals prune groups but do not add sessions back", () => {
  const s = useSessionSplitStore.getState();
  s.reconcile(["a", "b"]);
  const root = splitGroups(useSessionSplitStore.getState().tree)[0].id;
  s.place("b", root, "right");
  s.reconcile(["a"]);
  s.reconcile(["a"]);
  expect(
    splitGroups(useSessionSplitStore.getState().tree).flatMap((g) => g.keys),
  ).toEqual(["a"]);
});
