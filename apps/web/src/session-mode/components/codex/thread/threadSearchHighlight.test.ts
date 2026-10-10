import { expect, it } from "vitest";
import { findTranscriptMatchRange } from "./threadSearchHighlight";
it("maps the actual nth visible occurrence across Markdown text nodes without changing DOM", () => {
  const root = document.createElement("div");
  root.innerHTML =
    '<div class="codex-assistant-content"><p>match first <strong>ma</strong><em>tch</em> second</p><button>match control</button><span hidden>match hidden</span></div>';
  const before = root.innerHTML,
    range = findTranscriptMatchRange(root, "MATCH", 1);
  expect(range?.toString()).toBe("match");
  expect(range?.startContainer.parentElement?.tagName).toBe("STRONG");
  expect(root.innerHTML).toBe(before);
  expect(findTranscriptMatchRange(root, "match", 2)).toBeNull();
});
it("restricts user matching to the actual message body and rejects invalid indices", () => {
  const root = document.createElement("div");
  root.innerHTML =
    '<div class="codex-user-bubble">same text</div><div class="session-message-actions">same action</div>';
  expect(findTranscriptMatchRange(root, "same", 0)?.toString()).toBe("same");
  expect(findTranscriptMatchRange(root, "same", 1)).toBeNull();
  expect(findTranscriptMatchRange(root, "same", -1)).toBeNull();
});
it("keeps actual DOM offsets when case folding expands a Unicode character", () => {
  const root = document.createElement("div");
  root.innerHTML = '<div class="codex-user-bubble">İ MATCH 中文</div>';
  expect(findTranscriptMatchRange(root, "match", 0)?.toString()).toBe("MATCH");
});
