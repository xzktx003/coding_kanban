import { describe, expect, it } from "vitest";
import {
  captureResponseSelection,
  contextForDelivery,
  findResponseSelection,
  isCodexDraftOwner,
} from "./selectionAnnotations";

describe("selected response annotations", () => {
  it("captures and restores the exact span across formatted nodes", () => {
    const root = document.createElement("div");
    root.innerHTML = "前缀<strong>甲😀乙</strong><code>代码</code>末尾";
    const range = document.createRange();
    range.setStart(root.querySelector("strong")!.firstChild!, 1);
    range.setEnd(root.querySelector("code")!.firstChild!, 1);
    const selection = captureResponseSelection(root, range);
    expect(selection).toEqual({ text: "😀乙代", start: 3, end: 7 });
    expect(findResponseSelection(root, selection!)?.toString()).toBe("😀乙代");
    root.querySelector("strong")!.textContent = "内容已经改变";
    expect(findResponseSelection(root, selection!)).toBeNull();
  });

  it("does not capture a selection extending outside its message", () => {
    const parent = document.createElement("div");
    parent.innerHTML = "<p>消息一</p><p>消息二</p>";
    const range = document.createRange();
    range.setStart(parent.firstElementChild!.firstChild!, 0);
    range.setEnd(parent.lastElementChild!.firstChild!, 2);
    expect(
      captureResponseSelection(parent.firstElementChild!, range),
    ).toBeNull();
  });

  it("recognizes a Codex draft in its own detached window without accepting another window", () => {
    const original = window.location.href;
    const id = "550e8400-e29b-41d4-a716-446655440000";
    const codex = JSON.stringify(["codex", "", "session", "thread-a"]);
    try {
      expect(isCodexDraftOwner(codex)).toBe(true);
      window.history.replaceState({}, "", `?sessionWindow=${id}`);
      expect(isCodexDraftOwner(codex)).toBe(false);
      expect(isCodexDraftOwner(JSON.stringify(["window", id, codex]))).toBe(
        true,
      );
      expect(
        isCodexDraftOwner(JSON.stringify(["window", "other", codex])),
      ).toBe(false);
      expect(
        isCodexDraftOwner(
          JSON.stringify([
            "window",
            id,
            JSON.stringify(["cc", "", "session", "a"]),
          ]),
        ),
      ).toBe(false);
    } finally {
      window.history.replaceState({}, "", original);
    }
  });

  it("handles a selection starting at an element boundary", () => {
    const root = document.createElement("div");
    root.innerHTML = "前缀<strong>甲</strong><code>乙</code>";
    const range = document.createRange();
    range.setStart(root, 1);
    range.setEnd(root, 3);
    expect(captureResponseSelection(root, range)).toEqual({
      text: "甲乙",
      start: 2,
      end: 4,
    });
  });

  it("freezes selected text and its comment in the existing queue protocol", () => {
    const draft = {
      id: "ref-1",
      kind: "quote" as const,
      name: "选中的文本",
      text: "原文 `代码`\n下一行",
      sourceThreadId: "thread-a",
      sourceItemId: "item-a",
      responseSelection: { start: 2, end: 11 },
      annotation: "请解释这两行\n保留原始换行",
    };
    const delivered = contextForDelivery(draft);
    expect(delivered).toEqual({
      id: "ref-1",
      kind: "quote",
      name: "选中的文本",
      text: "所选文本：\n原文 `代码`\n下一行\n\n用户评论：\n请解释这两行\n保留原始换行",
      sourceThreadId: "thread-a",
      sourceItemId: "item-a",
    });
    expect(draft.text).toBe("原文 `代码`\n下一行");
    expect(draft.annotation).toBe("请解释这两行\n保留原始换行");
  });
});
