import { expect, it } from "vitest";
import {
  appendCodexNewWindow,
  closeCodexWindow,
  initialCodexWindows,
  openCodexConversation,
  readCodexWindows,
  saveCodexWindows,
  CODEX_MULTIWINDOW_KEY,
  type CodexWindowState,
} from "./codex-multiwindow-state";

const firstWindowId = "019aabcd-1234-7890-abcd-0123456789ab";
const makeConversation = (index: number) => ({
  id: `019aabcd-1234-7890-abcd-${String(index).padStart(12, "0")}`,
  cwd: `/tmp/project-${index % 3}`,
  name: `Conversation ${index}`,
  preview: `Message ${index}`,
  updatedAt: index,
});

it("starts with one native window and opens unlimited distinct conversations into the active group", () => {
  let state = initialCodexWindows(firstWindowId, "/tmp/project");
  expect(state.windows).toHaveLength(1);
  expect(state.tree.type).toBe("group");
  for (let index = 1; index <= 12; index++)
    state = openCodexConversation(state, makeConversation(index));
  expect(state.windows).toHaveLength(13);
  expect(state.activeId).toBe(makeConversation(12).id);
  if (state.tree.type !== "group") throw new Error("expected one group");
  expect(state.tree.keys).toHaveLength(13);
  expect(state.tree.selected).toBe(makeConversation(12).id);
  state = openCodexConversation(state, makeConversation(3));
  expect(state.windows).toHaveLength(13);
  expect(state.activeId).toBe(makeConversation(3).id);
  const afterClose = closeCodexWindow(state, makeConversation(3).id);
  expect(afterClose.windows).toHaveLength(12);
  expect(afterClose.windows.find((item) => item.id === makeConversation(1).id)).toBeTruthy();
});

it("round trips open windows while rejecting injected or corrupt persisted identities", () => {
  const storage = window.localStorage;
  storage.clear();
  let state: CodexWindowState = initialCodexWindows(firstWindowId, "/tmp/project");
  state = openCodexConversation(state, makeConversation(1));
  expect(saveCodexWindows(storage, state, firstWindowId)).toBe(true);
  expect(readCodexWindows(storage, firstWindowId, "/tmp/project")).toEqual(state);
  storage.setItem("kanban.codex.multiwindow.v2", JSON.stringify({
    version: 2,
    hostKey: firstWindowId,
    tree: { type: "group" },
    activeId: "../../etc/passwd",
    windows: [{ id: "../../etc/passwd", kind: "thread", title: "bad", cwd: "/tmp", threadId: "../../etc/passwd" }],
  }));
  expect(readCodexWindows(storage, firstWindowId, "/tmp/project").windows).toHaveLength(1);
  storage.clear();
});

it("keeps successive new chats beyond the two startup editors across refresh", () => {
  const storage = window.localStorage;
  storage.clear();
  let state = initialCodexWindows(firstWindowId, "/tmp/project");
  for (let index = 1; index <= 12; index++)
    state = appendCodexNewWindow(state, makeConversation(index).id, "/tmp/project");
  expect(state.windows).toHaveLength(13);
  expect(saveCodexWindows(storage, state, firstWindowId)).toBe(true);
  expect(readCodexWindows(storage, firstWindowId, "/tmp/project").windows).toHaveLength(13);
  storage.clear();
});

it("drops stale blank native windows when a replacement host has new startup identities", () => {
  const storage = window.localStorage;
  storage.clear();
  let state = appendCodexNewWindow(initialCodexWindows(firstWindowId, "/tmp/project"), makeConversation(1).id, "/tmp/project");
  state = openCodexConversation(state, makeConversation(2));
  expect(saveCodexWindows(storage, state, firstWindowId)).toBe(true);
  const replacementId = "019aabcd-1234-7890-abcd-0123456789ff";
  const restored = readCodexWindows(storage, replacementId, "/tmp/project");
  expect(restored.windows.map((item) => item.id)).toEqual([`new:${replacementId}`, makeConversation(2).id]);
  expect(restored.tree.type).toBe("group");
  storage.clear();
});

it("restores a sent default new chat by its real thread identity", () => {
  const storage = window.localStorage;
  storage.clear();
  const threadId = makeConversation(9).id;
  const initial = initialCodexWindows(firstWindowId, "/tmp/project");
  const sent: CodexWindowState = { ...initial, windows: [{ ...initial.windows[0]!, threadId }] };
  expect(saveCodexWindows(storage, sent, firstWindowId)).toBe(true);
  const restored = readCodexWindows(storage, firstWindowId, "/tmp/project");
  expect(restored.windows).toEqual([{ id: threadId, kind: "thread", threadId, title: "新聊天", cwd: "/tmp/project", state: "opening" }]);
  expect(restored.activeId).toBe(threadId);
  storage.clear();
});

it("keeps the sent new chat selected when its group also contains older followed history", () => {
  const storage = window.localStorage; storage.clear();
  const older = makeConversation(1), sentId = makeConversation(9).id;
  const state = openCodexConversation(initialCodexWindows(firstWindowId, "/tmp/project"), older);
  const newId = `new:${firstWindowId}`;
  const sent = { ...state, activeId: newId, tree: { ...state.tree, selected: newId }, windows: state.windows.map(item => item.id === newId ? { ...item, threadId: sentId } : item) } as CodexWindowState;
  saveCodexWindows(storage, sent, firstWindowId);
  const restored = readCodexWindows(storage, firstWindowId, "/tmp/project");
  expect(restored.activeId).toBe(sentId);
  expect(restored.tree).toMatchObject({ type: "group", selected: sentId, keys: [sentId, older.id] });
  storage.clear();
});

it("remaps a sent new chat's split-group identity even when its thread metadata was already restored", () => {
  const storage = window.localStorage; storage.clear();
  const older = makeConversation(1), sentId = makeConversation(9).id, newId = `new:${firstWindowId}`;
  storage.setItem(CODEX_MULTIWINDOW_KEY, JSON.stringify({ version: 2, hostKey: firstWindowId, activeId: newId, activeGroupId: 'right',
    tree: { type: 'split', id: 'split', direction: 'horizontal', ratio: 37, first: { type: 'group', id: 'left', keys: [older.id], selected: older.id }, second: { type: 'group', id: 'right', keys: [newId, sentId], selected: newId } },
    windows: [{ id: sentId, kind: 'thread', threadId: sentId, cwd: '/tmp/project', title: 'Sent' }, { id: older.id, kind: 'thread', threadId: older.id, cwd: '/tmp/project', title: 'Older' }, { id: newId, kind: 'new', threadId: sentId, cwd: '/tmp/project', title: 'Sent new' }] }));
  const restored = readCodexWindows(storage, firstWindowId, "/tmp/project");
  expect(restored.windows.map(item => item.id)).toEqual([sentId, older.id]);
  expect(restored.activeId).toBe(sentId);
  expect(restored.activeGroupId).toBe('right');
  expect(restored.tree).toMatchObject({ type: 'split', ratio: 37, first: { id: 'left', selected: older.id }, second: { id: 'right', keys: [sentId], selected: sentId } });
  storage.clear();
});

it("rejects two converted records claiming the same original new-window identity", () => {
  const storage = window.localStorage; storage.clear();
  const newId = `new:${firstWindowId}`;
  storage.setItem(CODEX_MULTIWINDOW_KEY, JSON.stringify({ version: 2, hostKey: firstWindowId, activeId: newId, activeGroupId: 'g',
    tree: { type: 'group', id: 'g', keys: [newId], selected: newId },
    windows: [1, 2].map(index => ({ id: newId, kind: 'new', threadId: makeConversation(index).id, cwd: '/tmp/project', title: 'Ambiguous new chat' })) }));
  expect(readCodexWindows(storage, firstWindowId, '/tmp/project').windows).toEqual(initialCodexWindows(firstWindowId, '/tmp/project').windows);
  storage.clear();
});
