import { beforeEach, expect, it, vi } from "vitest";
import {
  numberNavigationIntent,
  numberNavigationTarget,
  resetSessionShortcuts,
  saveNumberNavigationTarget,
  saveSessionShortcut,
} from "./sessionKeyboardShortcuts";
import {
  canSelectSessionTab,
  registerSessionTabSelect,
  sessionTabSelect,
} from "@session/stores/sessionTabSelect";
beforeEach(() => {
  localStorage.clear();
  resetSessionShortcuts();
});
const key = (code = "Digit2", extra: KeyboardEventInit = {}) =>
  new KeyboardEvent("keydown", {
    key: "@",
    code,
    ctrlKey: true,
    shiftKey: true,
    ...extra,
  });
it("uses browser-compatible number modifiers, swaps chat/tab targets durably, and rejects editing/navigation conflicts", () => {
  expect(numberNavigationIntent(key())).toEqual({ index: 1, target: "tabs" });
  expect(numberNavigationIntent(key("Digit2", { altKey: true }))).toEqual({
    index: 1,
    target: "chats",
  });
  expect(saveNumberNavigationTarget("chats")).toBeNull();
  expect(
    JSON.parse(localStorage.getItem("session-keyboard-shortcuts-v1")!).bindings
      .numberTarget,
  ).toBe("chats");
  expect(numberNavigationIntent(key())).toEqual({ index: 1, target: "chats" });
  expect(numberNavigationIntent(key("Digit2", { altKey: true }))).toEqual({
    index: 1,
    target: "tabs",
  });
  expect(saveSessionShortcut("search", "Mod+Shift+Digit2")).toContain("数字键");
  for (const event of [
    key("Digit2", { shiftKey: false }),
    key("Digit0"),
    key("Digit2", { isComposing: true }),
    key("Digit2", { repeat: true }),
    key("Digit2", { metaKey: true }),
  ])
    expect(numberNavigationIntent(event)).toBeNull();
  expect(resetSessionShortcuts()).toBeNull();
  expect(numberNavigationTarget()).toBe("tabs");
});
it("failed preference persistence leaves the previous target unchanged", () => {
  const fail = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
    throw new Error("quota");
  });
  try {
    expect(saveNumberNavigationTarget("chats")).toContain("无法保存");
  } finally {
    fail.mockRestore();
  }
  expect(numberNavigationTarget()).toBe("tabs");
});
it("closing a temporary navigation owner restores the still-mounted tab selector", () => {
  const first = vi.fn(),
    temporary = vi.fn(),
    card = { kind: "codex" as const, id: "same" };
  const stop = registerSessionTabSelect(first),
    stopTemporary = registerSessionTabSelect(temporary);
  try {
    sessionTabSelect(card);
    expect(temporary).toHaveBeenCalledWith(card);
    stopTemporary();
    expect(canSelectSessionTab()).toBe(true);
    sessionTabSelect(card);
    expect(first).toHaveBeenCalledExactlyOnceWith(card);
  } finally {
    stopTemporary();
    stop();
  }
});
