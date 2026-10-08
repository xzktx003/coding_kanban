import { expect, it } from "vitest";
import { submitIntent } from "./submitIntent";
const plain = { shiftKey: false, ctrlKey: false, metaKey: false };
it("uses modifier+shift for the opposite follow-up and preserves newline and IME", () => {
  expect(submitIntent(plain, "text", "enter")).toBe("default");
  expect(
    submitIntent({ ...plain, shiftKey: true }, "text", "enter"),
  ).toBeNull();
  expect(
    submitIntent({ ...plain, ctrlKey: true, shiftKey: true }, "text", "enter"),
  ).toBe("opposite");
  expect(
    submitIntent(
      { ...plain, metaKey: true, shiftKey: true },
      "text",
      "cmdAlways",
    ),
  ).toBe("opposite");
  expect(
    submitIntent(
      { ...plain, ctrlKey: true, shiftKey: true, isComposing: true },
      "text",
      "enter",
    ),
  ).toBeNull();
});
it("honors multiline and modifier-only submission preferences", () => {
  expect(submitIntent(plain, "one\ntwo", "cmdIfMultiline")).toBeNull();
  expect(submitIntent(plain, "one", "cmdIfMultiline")).toBe("default");
  expect(submitIntent(plain, "one", "cmdAlways")).toBeNull();
  expect(
    submitIntent({ ...plain, ctrlKey: true }, "one\ntwo", "cmdIfMultiline"),
  ).toBe("default");
});
