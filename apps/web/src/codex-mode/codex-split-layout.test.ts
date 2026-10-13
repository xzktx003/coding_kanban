import { expect, it } from "vitest";
import {
  appendCodexNewWindow,
  closeCodexWindow,
  codexSplitGroups,
  initialCodexWindows,
  openCodexConversation,
  placeCodexWindow,
  readCodexWindows,
  resizeCodexSplit,
  saveCodexWindows,
  type CodexWindowState,
} from "./codex-multiwindow-state";

const firstWindowId = "019aabcd-1234-7890-abcd-0123456789ab";
const conversation = (index: number) => ({
  id: `019aabcd-1234-7890-abcd-${String(index).padStart(12, "0")}`,
  cwd: `/tmp/project-${index % 3}`,
  name: `Conversation ${index}`,
  preview: `Message ${index}`,
  updatedAt: index,
});

it("splits the only tab toward any edge and leaves the original group empty", () => {
  const state = initialCodexWindows(firstWindowId, "/tmp/project");
  const only = state.windows[0]!.id;
  const groupId = state.tree.type === "group" ? state.tree.id : "";
  const placed = placeForTest(state, only, groupId, "right");
  expect(placed.tree.type).toBe("split");
  if (placed.tree.type !== "split") return;
  expect(placed.tree.direction).toBe("horizontal");
  expect(placed.tree.ratio).toBe(50);
  if (placed.tree.first.type !== "group" || placed.tree.second.type !== "group") return;
  expect(placed.tree.first.keepEmpty).toBe(true);
  expect(placed.tree.first.keys).toEqual([]);
  expect(placed.tree.second.keys).toEqual([only]);
  expect(placed.windows).toHaveLength(1);
  expect(placed.activeId).toBe(only);
});

it("nests a vertical split inside an existing horizontal split without duplicating a window", () => {
  let state = openCodexConversation(
    openCodexConversation(initialCodexWindows(firstWindowId, "/tmp/project"), conversation(1)),
    conversation(2),
  );
  const root = state.tree.type === "group" ? state.tree.id : "";
  state = placeForTest(state, conversation(1).id, root, "right");
  const right = codexSplitGroups(state.tree)[1]!;
  state = placeForTest(state, conversation(2).id, right.id, "bottom");
  expect(state.tree.type).toBe("split");
  if (state.tree.type !== "split" || state.tree.second.type !== "split")
    throw new Error("expected nested split");
  expect(state.tree.second.direction).toBe("vertical");
  expect(codexSplitGroups(state.tree).map((group) => group.keys)).toEqual([
    [`new:${firstWindowId}`],
    [conversation(1).id],
    [conversation(2).id],
  ]);
  expect(state.windows).toHaveLength(3);
});

it("clamps a resized pane between 15 and 85 percent", () => {
  let state = appendCodexNewWindow(initialCodexWindows(firstWindowId, "/tmp/project"), conversation(1).id, "/tmp/project");
  const root = state.tree.type === "group" ? state.tree.id : "";
  state = placeForTest(state, `new:${conversation(1).id}`, root, "bottom");
  if (state.tree.type !== "split") throw new Error("expected split");
  state = resizeForTest(state, state.tree.id, 4);
  if (state.tree.type !== "split") throw new Error("expected split");
  expect(state.tree.ratio).toBe(15);
  state = resizeForTest(state, state.tree.id, 140);
  if (state.tree.type !== "split") throw new Error("expected split");
  expect(state.tree.ratio).toBe(85);
});

it("migrates a saved two-column split into one horizontal group per window", () => {
  const storage = window.localStorage;
  storage.clear();
  const second = conversation(2).id;
  storage.setItem("kanban.codex.multiwindow.v1", JSON.stringify({
    version: 1,
    hostKey: firstWindowId,
    layout: "split",
    activeId: second,
    windows: [
      { id: `new:${firstWindowId}`, kind: "new", title: "新聊天", cwd: "/tmp/project" },
      { id: conversation(1).id, kind: "thread", title: "Conversation 1", cwd: "/tmp/project-1", threadId: conversation(1).id },
      { id: second, kind: "thread", title: "Conversation 2", cwd: "/tmp/project-2", threadId: second },
    ],
  }));
  const restored = readCodexWindows(storage, firstWindowId, "/tmp/project");
  expect(restored.windows).toHaveLength(3);
  expect(codexSplitGroups(restored.tree).map((group) => group.keys)).toEqual([
    [`new:${firstWindowId}`],
    [conversation(1).id],
    [second],
  ]);
  expect(restored.tree.type).toBe("split");
  if (restored.tree.type === "split") {
    expect(restored.tree.direction).toBe("horizontal");
    expect(restored.tree.first.type).toBe("split");
    expect(restored.tree.second.type).toBe("group");
  }
  expect(restored.activeGroupId).toBe(codexSplitGroups(restored.tree)[2]?.id);
  storage.clear();
});

it("round trips the free split tree and drops a corrupt tree back to one group", () => {
  const storage = window.localStorage;
  storage.clear();
  let state: CodexWindowState = appendCodexNewWindow(
    initialCodexWindows(firstWindowId, "/tmp/project"),
    conversation(4).id,
    "/tmp/project",
  );
  const root = state.tree.type === "group" ? state.tree.id : "";
  state = placeForTest(state, `new:${conversation(4).id}`, root, "left");
  expect(saveCodexWindows(storage, state, firstWindowId)).toBe(true);
  const restored = readCodexWindows(storage, firstWindowId, "/tmp/project");
  expect(codexSplitGroups(restored.tree).map((group) => group.keys)).toEqual(
    codexSplitGroups(state.tree).map((group) => group.keys),
  );
  storage.setItem("kanban.codex.multiwindow.v2", JSON.stringify({
    version: 2,
    hostKey: firstWindowId,
    activeGroupId: "not-a-group",
    tree: { type: "split", direction: "diagonal" },
    windows: state.windows.map(({ id, kind, title, cwd }) => ({ id, kind, title, cwd })),
  }));
  const fallback = readCodexWindows(storage, firstWindowId, "/tmp/project");
  expect(fallback.tree.type).toBe("group");
  expect(fallback.windows.map((item) => item.id)).toEqual(state.windows.map((item) => item.id));
  storage.clear();
});

it("closes a window inside its group and removes the pane when the group becomes empty", () => {
  let state = openCodexConversation(initialCodexWindows(firstWindowId, "/tmp/project"), conversation(1));
  const root = state.tree.type === "group" ? state.tree.id : "";
  state = placeForTest(state, conversation(1).id, root, "right");
  state = closeCodexWindow(state, conversation(1).id);
  expect(state.tree.type).toBe("group");
  if (state.tree.type !== "group") return;
  expect(state.tree.keys).toEqual([`new:${firstWindowId}`]);
  expect(state.windows).toHaveLength(1);
});

function placeForTest(
  state: CodexWindowState,
  key: string,
  targetId: string,
  edge: "left" | "right" | "top" | "bottom" | "center",
  beforeKey?: string,
): CodexWindowState {
  return placeCodexWindow(state, key, targetId, edge, beforeKey);
}

function resizeForTest(state: CodexWindowState, id: string, ratio: number): CodexWindowState {
  return resizeCodexSplit(state, id, ratio);
}
