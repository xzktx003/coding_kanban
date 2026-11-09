import test from "node:test";
import assert from "node:assert/strict";
import { createDesktopPaneLayout } from "../src/desktop-pane-layout.mjs";

const fixture = (extra = {}) => {
  let sequence = 0;
  return createDesktopPaneLayout({
    idFactory: () => `pane-${++sequence}`,
    ...extra,
  });
};
const groups = (node) =>
  node.type === "group"
    ? [node]
    : [...groups(node.first), ...groups(node.second)];
const keys = (model) =>
  groups(model.getSnapshot().tree).flatMap((group) => group.keys);

test("moving a tab into all four split edges keeps one target and independent selection", () => {
  for (const edge of ["left", "right", "top", "bottom"]) {
    const model = fixture();
    model.open("local:A");
    model.open("remote:A");
    const first = model.getSnapshot().activeGroupId;
    model.place("remote:A", first, edge);
    const state = model.getSnapshot(),
      panes = groups(state.tree);
    assert.equal(panes.length, 2);
    assert.equal(
      state.tree.direction,
      ["left", "right"].includes(edge) ? "horizontal" : "vertical",
    );
    assert.deepEqual(new Set(keys(model)), new Set(["local:A", "remote:A"]));
    const leading = ["left", "top"].includes(edge);
    assert.equal((leading ? panes[0] : panes[1]).selected, "remote:A");
    assert.equal((leading ? panes[1] : panes[0]).selected, "local:A");
    assert.equal(
      panes.find((pane) => pane.id === state.activeGroupId).selected,
      "remote:A",
    );
  }
});

test("splitting the sole tab retains a usable empty group, closing it collapses the branch", () => {
  const model = fixture();
  model.open("A");
  const original = model.getSnapshot().activeGroupId;
  model.place("A", original, "right");
  const panes = groups(model.getSnapshot().tree);
  assert.equal(panes[0].id, original);
  assert.deepEqual(panes[0].keys, []);
  assert.equal(panes[0].keepEmpty, true);
  assert.equal(panes[1].selected, "A");
  model.focusGroup(original);
  assert.equal(model.getSnapshot().activeGroupId, original);
  model.closeEmptyGroup(original);
  assert.equal(model.getSnapshot().tree.type, "group");
  assert.equal(model.getSnapshot().tree.selected, "A");
});

test("tab merging, ordering and closing only change layout and keep snapshots immutable", () => {
  const model = fixture();
  model.open("A");
  model.open("B");
  model.open("C");
  const old = model.getSnapshot(),
    home = old.activeGroupId;
  model.place("B", home, "bottom");
  model.place("B", home, "center", "C");
  assert.deepEqual(keys(model), ["A", "B", "C"]);
  assert.deepEqual(old.tree.keys, ["A", "B", "C"]);
  assert.throws(() => old.tree.keys.push("mutated"), TypeError);
  model.close("B");
  assert.deepEqual(keys(model), ["A", "C"]);
  assert.equal(model.getSnapshot().tree.selected, "C");
  model.close("C");
  model.close("A");
  assert.equal(model.getSnapshot().tree.type, "group");
  assert.equal(model.getSnapshot().tree.selected, null);
  assert.deepEqual(keys(model), []);
});

test("nested resizing is finite and bounded; stale pane actions do not change target", () => {
  const model = fixture();
  model.open("A");
  model.open("B");
  model.open("C");
  const home = model.getSnapshot().activeGroupId;
  model.place("B", home, "right");
  model.place("C", home, "bottom");
  const root = model.getSnapshot().tree;
  model.resize(root.id, 90);
  assert.equal(model.getSnapshot().tree.ratio, 85);
  const current = model.getSnapshot();
  model.resize(root.id, NaN);
  model.focusGroup("stale");
  model.place("missing", home, "left");
  assert.equal(model.getSnapshot(), current);
  assert.equal(
    groups(current.tree).find((pane) => pane.id === current.activeGroupId)
      .selected,
    "C",
  );
});

test("restores its own layout independently and reconciles removed threads without reopening anything", () => {
  const model = fixture();
  model.open("host-a:thread");
  model.open("host-b:thread");
  model.place("host-b:thread", model.getSnapshot().activeGroupId, "left");
  model.resize(model.getSnapshot().tree.id, 38);
  const saved = model.serialize();
  const restored = fixture({ saved });
  assert.deepEqual(restored.getSnapshot().tree, model.getSnapshot().tree);
  assert.equal(
    restored.getSnapshot().activeGroupId,
    model.getSnapshot().activeGroupId,
  );
  restored.reconcile(["host-b:thread"]);
  assert.deepEqual(keys(restored), ["host-b:thread"]);
  assert.deepEqual(
    new Set(keys(model)),
    new Set(["host-a:thread", "host-b:thread"]),
  );
  restored.open("new");
  restored.place("new", restored.getSnapshot().activeGroupId, "bottom");
  const nodes = [];
  const visit = (node) => {
    nodes.push(node.id);
    if (node.type === "split") {
      visit(node.first);
      visit(node.second);
    }
  };
  visit(restored.getSnapshot().tree);
  assert.equal(new Set(nodes).size, nodes.length);
});

test("rejects malformed, duplicated and oversized saved layouts without invoking observers", () => {
  const model = fixture();
  model.open("A");
  const saved = JSON.parse(model.serialize());
  const broken = [
    { ...saved, activeGroupId: "missing" },
    { ...saved, tree: { ...saved.tree, keys: ["A", "A"] } },
    { ...saved, tree: { ...saved.tree, selected: "other" } },
    { ...saved, tree: { ...saved.tree, command: "ignored-command" } },
  ];
  for (const value of broken)
    assert.throws(() => fixture({ saved: JSON.stringify(value) }), {
      code: "DESKTOP_LAYOUT_INVALID_SAVED_STATE",
    });
  assert.throws(() => fixture({ saved: " ".repeat(32769) }), {
    code: "DESKTOP_LAYOUT_INVALID_SAVED_STATE",
  });
});

test("publishes only real changes, and a late unsubscribe does not remove another observer", () => {
  const model = fixture(),
    seen = [],
    other = [];
  const off = model.subscribe(() => seen.push(model.getSnapshot()));
  model.subscribe(() => other.push(model.getSnapshot()));
  model.open("A");
  model.open("A");
  off();
  off();
  model.open("B");
  assert.equal(seen.length, 1);
  assert.equal(other.length, 2);
  assert.equal(other[0].revision + 1, other[1].revision);
});

test("repeated empty reconciliation and dropping a tab in its current position preserve the snapshot", () => {
  const model = fixture(),
    empty = model.getSnapshot();
  model.reconcile([]);
  model.closeEmptyGroup(empty.activeGroupId);
  assert.equal(model.getSnapshot(), empty);
  model.open("A");
  const opened = model.getSnapshot();
  model.place("A", opened.activeGroupId, "center");
  model.reconcile(["A"]);
  assert.equal(model.getSnapshot(), opened);
});

test("layout budget failures preserve current windows, selection and observer state", () => {
  const model = fixture();
  for (let index = 0; index < 128; index++) model.open(`thread-${index}`);
  const before = model.getSnapshot();
  let notifications = 0;
  model.subscribe(() => notifications++);
  assert.throws(() => model.open("one-too-many"), {
    code: "DESKTOP_LAYOUT_LIMIT",
  });
  assert.equal(model.getSnapshot(), before);
  assert.equal(notifications, 0);
  assert.equal(keys(model).length, 128);
});

test("merging groups is one presentation update and preserves the active input selection", () => {
  for (const activeSource of [true, false]) {
    const model = fixture();
    model.open("A"); model.open("B"); model.open("C");
    const target = model.getSnapshot().activeGroupId;
    model.place("B", target, "right");
    const source = model.getSnapshot().activeGroupId;
    model.place("C", source, "center");
    if (!activeSource) model.focus("A");
    const before = model.getSnapshot(); let updates = 0;
    model.subscribe(() => updates++);
    assert.equal(model.mergeGroups(source, target), true);
    const after = model.getSnapshot();
    assert.equal(after.tree.type, "group");
    assert.deepEqual(after.tree.keys, ["A", "B", "C"]);
    assert.equal(after.tree.selected, activeSource ? "C" : "A");
    assert.equal(after.activeGroupId, target);
    assert.equal(after.revision, before.revision + 1);
    assert.equal(updates, 1);
    assert.equal(before.tree.type, "split");
    assert.equal(model.mergeGroups(source, target), false);
    assert.equal(model.mergeGroups(target, target), false);
    assert.equal(model.getSnapshot(), after);
  }
});

test("merging inactive groups never changes a third pane's selected target", () => {
  const model = fixture();
  model.open("A"); model.open("B"); model.open("C");
  const target = model.getSnapshot().activeGroupId;
  model.place("B", target, "right");
  const source = model.getSnapshot().activeGroupId;
  model.place("C", source, "bottom");
  const third = model.getSnapshot().activeGroupId;
  model.mergeGroups(source, target);
  assert.equal(model.getSnapshot().activeGroupId, third);
  assert.equal(groups(model.getSnapshot().tree).find(pane => pane.id === third).selected, "C");
  assert.deepEqual(new Set(keys(model)), new Set(["A", "B", "C"]));
});


test("closing a group removes all of its tabs atomically and collapses nested splits",()=>{
 const model=fixture();model.open("A");model.open("B");const first=model.getSnapshot().activeGroupId;
 model.place("B",first,"right");const closing=model.getSnapshot().activeGroupId;model.open("C",closing);
 const old=model.getSnapshot();let notifications=0;model.subscribe(()=>notifications++);
 assert.equal(model.closeGroup(closing),true);assert.equal(notifications,1);
 assert.deepEqual(keys(model),["A"]);assert.equal(model.getSnapshot().tree.type,"group");assert.equal(model.getSnapshot().activeGroupId,first);
 assert.deepEqual(groups(old.tree).find(x=>x.id===closing).keys,["B","C"]);
 const retained=model.getSnapshot();assert.equal(model.closeGroup(closing),false);assert.equal(model.getSnapshot(),retained);
 assert.equal(model.closeGroup(first),true);assert.equal(notifications,2);assert.equal(model.getSnapshot().tree.type,"group");assert.deepEqual(keys(model),[]);assert.equal(model.getSnapshot().tree.selected,null);
 const saved=model.serialize();assert.deepEqual(fixture({saved}).getSnapshot().tree,model.getSnapshot().tree);
});
