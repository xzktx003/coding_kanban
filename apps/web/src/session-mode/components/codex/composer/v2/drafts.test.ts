import { beforeEach, expect, it, vi } from "vitest";
import { composerDrafts, useComposerDraftStore } from "./drafts";
beforeEach(() => {
  localStorage.clear();
  useComposerDraftStore.setState({ drafts: {}, error: null });
});
it("keeps the in-memory context when persistence fails and explicitly retries", () => {
  const write = vi
    .spyOn(Storage.prototype, "setItem")
    .mockImplementation(() => {
      throw new Error("quota");
    });
  composerDrafts.add("a", {
    id: "saved",
    kind: "paste",
    name: "logs",
    text: "do not lose",
  });
  expect(useComposerDraftStore.getState().error).toContain("未保存");
  expect(composerDrafts.read("a").contexts[0].text).toBe("do not lose");
  write.mockRestore();
  composerDrafts.retryStorage();
  expect(useComposerDraftStore.getState().error).toBeNull();
  expect(
    JSON.parse(localStorage.getItem("kanban.session.composer-v2")!).a
      .contexts[0].text,
  ).toBe("do not lose");
});
it("clears only submitted contexts and isolates a later draft in another session", () => {
  composerDrafts.add("a", {
    id: "old",
    kind: "paste",
    name: "日志",
    text: "original",
  });
  const sent = composerDrafts.read("a").contexts;
  composerDrafts.add("a", {
    id: "new",
    kind: "quote",
    name: "引用",
    text: "later",
  });
  composerDrafts.add("b", {
    id: "other",
    kind: "paste",
    name: "其他",
    text: "other session",
  });
  composerDrafts.clearSubmitted("a", sent);
  expect(composerDrafts.read("a").contexts.map((x) => x.id)).toEqual(["new"]);
  expect(composerDrafts.read("b").contexts[0].text).toBe("other session");
});
it("moves new-session context and drawing drafts without erasing an existing destination", () => {
  composerDrafts.add("new", {
    id: "source",
    kind: "file",
    name: "f",
    text: "snapshot",
    path: "/f",
  });
  composerDrafts.add("thread", {
    id: "target",
    kind: "paste",
    name: "t",
    text: "existing",
  });
  composerDrafts.move("new", "thread");
  expect(composerDrafts.read("thread").contexts.map((x) => x.id)).toEqual([
    "target",
    "source",
  ]);
  expect(composerDrafts.read("new").contexts).toHaveLength(0);
});
it("undo restores a removed context only to its original owner and position", () => {
  composerDrafts.add("a", {
    id: "one",
    kind: "paste",
    name: "one",
    text: "one",
  });
  composerDrafts.add("a", {
    id: "two",
    kind: "paste",
    name: "two",
    text: "two",
  });
  const undo = composerDrafts.remove("a", "one");
  undo();
  undo();
  expect(composerDrafts.read("a").contexts.map((x) => x.id)).toEqual([
    "one",
    "two",
  ]);
  expect(composerDrafts.read("b").contexts).toHaveLength(0);
  expect(
    JSON.parse(localStorage.getItem("kanban.session.composer-v2")!).a.contexts,
  ).toHaveLength(2);
});
