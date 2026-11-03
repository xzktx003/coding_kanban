import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { IDBFactory } from "fake-indexeddb";
import type { AnnotatedContext } from "./selectionAnnotations";

let drafts: typeof import("./drafts");
let storage: typeof import("./draftStorage");
beforeEach(async () => {
  localStorage.clear();
  vi.stubGlobal("indexedDB", new IDBFactory());
  vi.resetModules();
  drafts = await import("./drafts");
  storage = await import("./draftStorage");
});
afterEach(async () => {
  await Promise.allSettled(
    Object.keys(drafts.useComposerDraftStore.getState().drafts).map((owner) =>
      drafts.composerDrafts.flush(owner),
    ),
  );
  drafts.takeContextDraftHandoff().releaseListener();
  vi.unstubAllGlobals();
});

it("preserves a later comment edit and keeps another session independent", async () => {
  const { composerDrafts } = drafts;
  const context: AnnotatedContext = {
    id: "selection-a",
    kind: "quote",
    name: "选中的文本",
    text: "正文",
    annotation: "原评论",
    sourceThreadId: "a",
    sourceItemId: "one",
    responseSelection: { start: 0, end: 2 },
  };
  composerDrafts.add("a", context);
  composerDrafts.add("b", {
    id: "selection-b",
    kind: "quote",
    name: "选中的文本",
    text: "另一会话",
  });
  const captured = composerDrafts.capture("a");
  composerDrafts.replace("a", context.id, {
    ...context,
    annotation: "提交之后的新评论",
  } as AnnotatedContext);
  composerDrafts.clearSubmitted("a", captured.contexts, captured.versions);
  expect(
    (composerDrafts.read("a").contexts[0] as AnnotatedContext).annotation,
  ).toBe("提交之后的新评论");
  expect(composerDrafts.read("b").contexts[0].text).toBe("另一会话");
  await Promise.all([composerDrafts.flush("a"), composerDrafts.flush("b")]);
  expect(
    (
      (await storage.contextDraftStorage.load("a")).contexts[0]
        .value as AnnotatedContext
    ).annotation,
  ).toBe("提交之后的新评论");
  expect(
    (await storage.contextDraftStorage.load("b")).contexts[0].value.text,
  ).toBe("另一会话");
});
