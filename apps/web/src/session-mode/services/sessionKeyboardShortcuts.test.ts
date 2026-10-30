import { beforeEach, expect, it, vi } from "vitest";
import {
  matchesSessionShortcut,
  resetSessionShortcuts,
  saveSessionShortcut,
  shortcutBinding,
} from "./sessionKeyboardShortcuts";
beforeEach(() => {
  localStorage.clear();
  resetSessionShortcuts();
});
it("checks conflicts and browser/editor reserved keys before changing a saved command", () => {
  expect(saveSessionShortcut("search", "Mod+Comma")).toContain("设置");
  expect(saveSessionShortcut("search", "Mod+KeyZ")).toContain("浏览器");
  expect(saveSessionShortcut("search", "Mod+Alt+KeyY")).toBeNull();
  expect(
    matchesSessionShortcut(
      new KeyboardEvent("keydown", {
        key: "y",
        code: "KeyY",
        ctrlKey: true,
        altKey: true,
      }),
      "search",
    ),
  ).toBe(true);
  expect(
    matchesSessionShortcut(
      new KeyboardEvent("keydown", {
        key: "y",
        code: "KeyY",
        ctrlKey: true,
        altKey: true,
        isComposing: true,
      }),
      "search",
    ),
  ).toBe(false);
});
it("keeps the old binding when storage cannot save the new choice", () => {
  const old = shortcutBinding("search");
  const failure = vi
    .spyOn(Storage.prototype, "setItem")
    .mockImplementation(() => {
      throw new Error("unavailable");
    });
  try {
    expect(saveSessionShortcut("search", "Mod+Alt+KeyY")).toContain("无法保存");
  } finally {
    failure.mockRestore();
  }
  expect(shortcutBinding("search")).toBe(old);
});
