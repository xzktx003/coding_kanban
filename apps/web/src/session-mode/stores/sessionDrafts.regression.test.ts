import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, expect, test } from "vitest";
import { useInputStore, startInputFacadeSync } from "./useInputStore";
import { useCCInputStore, startCCInputFacadeSync } from "./cc/useCCInputStore";
import { useCodexStore } from "../components/codex/stores";
import { useCCStore } from "./cc";
import { useAgentSettingsStore } from "./useAgentSettingsStore";
import {
  readDraft,
  sessionDraftKey,
  useSessionDraftStore,
} from "./useSessionDraftStore";
import { useAcpStore } from "./useAcpStore";

let stops: Array<() => void> = [];
afterEach(() => stops.forEach((stop) => stop()));
beforeEach(() => {
  localStorage.clear();
  useSessionDraftStore.setState({ drafts: {}, migrated: [] });
  useAcpStore.setState({ active: false });
  useAgentSettingsStore.setState({ selectedAgent: "codex" });
  useCodexStore.setState({ currentThreadId: "draft-a" });
  useCCStore.setState({ activeSessionId: "draft-a" });
  stops = [startInputFacadeSync(), startCCInputFacadeSync()];
});

test("Codex sessions expose separate drafts, including an initially empty session", () => {
  const { result } = renderHook(() => useInputStore());
  act(() => result.current.setInputValue("unfinished A"));
  expect(readDraft(sessionDraftKey("codex", "draft-a")).text).toBe(
    "unfinished A",
  );
  act(() => useCodexStore.getState().setCurrentThreadId("draft-b"));
  expect(result.current.inputValue).toBe("");
  act(() => result.current.setInputValue("unfinished B"));
  act(() => useCodexStore.getState().setCurrentThreadId("draft-a"));
  expect(result.current.inputValue).toBe("unfinished A");
});

test("Claude sessions expose separate drafts and do not inherit Codex input", () => {
  useAgentSettingsStore.setState({ selectedAgent: "cc" });
  const { result } = renderHook(() => useCCInputStore());
  act(() => result.current.setInputValue("Claude A"));
  act(() => useCCStore.getState().setActiveSessionId("draft-b"));
  expect(result.current.inputValue).toBe("");
  act(() => result.current.setInputValue("Claude B"));
  act(() => useCCStore.getState().setActiveSessionId("draft-a"));
  expect(result.current.inputValue).toBe("Claude A");
});

test("drafts survive hydration and session IDs are isolated across agents and new projects", async () => {
  const store = useSessionDraftStore.getState();
  const keys = [
    sessionDraftKey("codex", "same"),
    sessionDraftKey("cc", "same"),
    sessionDraftKey("codex", null, "/a"),
    sessionDraftKey("codex", null, "/b"),
  ];
  keys.forEach((key, i) => store.setText(key, `draft ${i}`));
  const persisted = localStorage.getItem("kanban.session.text-drafts")!;
  useSessionDraftStore.setState({ drafts: {} });
  localStorage.setItem("kanban.session.text-drafts", persisted);
  await useSessionDraftStore.persist.rehydrate();
  expect(keys.map((key) => readDraft(key).text)).toEqual([
    "draft 0",
    "draft 1",
    "draft 2",
    "draft 3",
  ]);
});

test("a late success clears only the captured revision of the originating session", () => {
  const owner = sessionDraftKey("codex", "draft-a");
  const other = sessionDraftKey("codex", "draft-b");
  const store = useSessionDraftStore.getState();
  store.setText(owner, "submitted");
  const snapshot = readDraft(owner);
  store.setText(other, "B is being edited");
  store.clearSubmitted(owner, snapshot);
  expect(readDraft(owner).text).toBe("");
  expect(readDraft(other).text).toBe("B is being edited");
  store.setText(owner, "submitted");
  const previous = readDraft(owner);
  store.setText(owner, "new input during send");
  store.clearSubmitted(owner, previous);
  expect(readDraft(owner).text).toBe("new input during send");
});

test("creating a session transfers the entire source draft while preserving edits during creation", () => {
  const from = sessionDraftKey("cc", null, "/project");
  const to = sessionDraftKey("cc", "created");
  const store = useSessionDraftStore.getState();
  store.setText(from, "submitted");
  const snapshot = readDraft(from);
  store.setText(from, "edits while creating");
  store.move(from, to);
  store.clearSubmitted(to, snapshot);
  expect(readDraft(to).text).toBe("edits while creating");
  expect(readDraft(from).text).toBe("");
});

test("legacy text migrates exactly once and retains its original backup", () => {
  const legacy = JSON.stringify({
    version: 3,
    state: { inputValue: "legacy unfinished" },
  });
  localStorage.setItem("kanban.session.input-storage", legacy);
  const store = useSessionDraftStore.getState();
  store.migrateLegacy("codex", "first");
  store.migrateLegacy("codex", "second");
  expect(readDraft("first").text).toBe("legacy unfinished");
  expect(readDraft("second").text).toBe("");
  expect(localStorage.getItem("kanban.session.input-storage")).toBe(legacy);
});
