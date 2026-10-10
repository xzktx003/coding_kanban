import { expect, it } from "vitest";
import { threadFindKeyIntent } from "./threadFindKeys";
const key = (fields: object) => ({
  key: "f",
  ctrlKey: true,
  metaKey: false,
  altKey: false,
  shiftKey: false,
  isComposing: false,
  defaultPrevented: false,
  ...fields,
});
it("handles explicit find and next/previous shortcuts only with their required modifiers", () => {
  expect(threadFindKeyIntent(key({}))).toBe("open");
  expect(threadFindKeyIntent(key({ ctrlKey: false, metaKey: true }))).toBe(
    "open",
  );
  expect(threadFindKeyIntent(key({ key: "g" }))).toBe(1);
  expect(threadFindKeyIntent(key({ key: "g", shiftKey: true }))).toBe(-1);
  expect(threadFindKeyIntent(key({ key: "F3", ctrlKey: false }))).toBe(1);
  expect(threadFindKeyIntent(key({ ctrlKey: false }))).toBeNull();
  expect(threadFindKeyIntent(key({ shiftKey: true }))).toBeNull();
});
it("does not consume IME, already handled keys or unrelated host shortcuts", () => {
  for (const fields of [
    { isComposing: true },
    { defaultPrevented: true },
    { altKey: true },
    { key: "p" },
  ])
    expect(threadFindKeyIntent(key(fields))).toBeNull();
});
