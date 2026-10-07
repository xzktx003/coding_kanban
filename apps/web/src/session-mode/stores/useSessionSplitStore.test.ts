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
it("rejects self splitting the sole tab and preserves ratios and group selection on reload", async () => {
  const s = useSessionSplitStore.getState();
  s.reconcile(["a"]);
  const root = splitGroups(useSessionSplitStore.getState().tree)[0].id;
  s.place("a", root, "right");
  expect(splitGroups(useSessionSplitStore.getState().tree)).toHaveLength(1);
  s.reconcile(["a", "b"]);
  s.place("b", root, "right");
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
