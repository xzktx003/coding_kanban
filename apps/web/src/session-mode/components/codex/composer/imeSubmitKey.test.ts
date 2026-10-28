import { describe, expect, it } from "vitest";

import { shouldSubmitOnEnter } from "./imeSubmitKey";

describe("Enter submission during input-method composition", () => {
  it("submits a finished line but never a composing one", () => {
    expect(shouldSubmitOnEnter({ key: "Enter", isComposing: false })).toBe(true);
    // Chinese, Japanese and Korean input use Enter to accept the highlighted
    // candidate. Submitting there would act on half-typed text.
    expect(shouldSubmitOnEnter({ key: "Enter", isComposing: true })).toBe(false);
  });

  it("treats the legacy composition keyCode as composing", () => {
    // Some IMEs report the composition Enter as keyCode 229 with isComposing
    // already cleared, which is what the official composer also guards on.
    expect(
      shouldSubmitOnEnter({ key: "Enter", isComposing: false, keyCode: 229 }),
    ).toBe(false);
  });

  it("ignores keys that are not Enter", () => {
    expect(shouldSubmitOnEnter({ key: "a", isComposing: false })).toBe(false);
    expect(shouldSubmitOnEnter({ key: "Escape", isComposing: false })).toBe(
      false,
    );
  });

  it("does not submit a newline-continuing Enter", () => {
    // Shift+Enter inserts a line break instead of sending.
    expect(
      shouldSubmitOnEnter({ key: "Enter", isComposing: false, shiftKey: true }),
    ).toBe(false);
  });
});
