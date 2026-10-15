import { expect, it } from "vitest";
import {
  CODEX_WINDOW_THREADS_KEY,
  persistCodexWindowThread,
  readCodexWindowThreads,
  shouldRestoreCodexWindowThread,
  validateCodexWindowIds,
} from "./codex-window-restore";

const windowIds = [
  "019aabcd-5678-7890-abcd-0123456789ab",
  "019aabcd-5678-7890-abcd-0123456789ac",
];
const firstThread = "019aabcd-1234-7890-abcd-0123456789ab";
const secondThread = "019aabcd-1234-7890-abcd-0123456789ac";

it("persists only validated thread IDs for the two captured new-chat windows", () => {
  const storage = window.localStorage;
  storage.removeItem(CODEX_WINDOW_THREADS_KEY);
  expect(
    persistCodexWindowThread(storage, windowIds, windowIds[0]!, firstThread),
  ).toBe(true);
  expect(
    persistCodexWindowThread(storage, windowIds, windowIds[1]!, secondThread),
  ).toBe(true);
  expect(readCodexWindowThreads(storage, windowIds)).toEqual(
    new Map([
      [windowIds[0]!, firstThread],
      [windowIds[1]!, secondThread],
    ]),
  );
  expect(
    persistCodexWindowThread(
      storage,
      windowIds,
      "019aabcd-0000-7890-abcd-0123456789ab",
      firstThread,
    ),
  ).toBe(false);
  expect(
    persistCodexWindowThread(
      storage,
      windowIds,
      windowIds[0]!,
      "../local/other",
    ),
  ).toBe(false);
});

it("fails closed on corrupt storage and restores only a blank original window", () => {
  const storage = window.localStorage;
  storage.setItem(CODEX_WINDOW_THREADS_KEY, "not-json");
  expect(readCodexWindowThreads(storage, windowIds)).toEqual(new Map());
  const common = {
    windowId: windowIds[0]!,
    windowIds,
    savedThreadId: firstThread,
  };
  expect(
    shouldRestoreCodexWindowThread({
      ...common,
      currentThreadId: null,
      hasComposer: true,
      composerEmpty: true,
    }),
  ).toBe(true);
  expect(
    shouldRestoreCodexWindowThread({
      ...common,
      currentThreadId: firstThread,
      hasComposer: true,
      composerEmpty: true,
    }),
  ).toBe(false);
  expect(
    shouldRestoreCodexWindowThread({
      ...common,
      currentThreadId: secondThread,
      hasComposer: true,
      composerEmpty: true,
    }),
  ).toBe(false);
  expect(
    shouldRestoreCodexWindowThread({
      ...common,
      currentThreadId: null,
      hasComposer: true,
      composerEmpty: false,
    }),
  ).toBe(false);
  expect(
    shouldRestoreCodexWindowThread({
      ...common,
      windowId: secondThread,
      currentThreadId: null,
      hasComposer: true,
      composerEmpty: true,
    }),
  ).toBe(false);
});

it("accepts one or two distinct startup window ids and rejects every other shape", () => {
  const only = [windowIds[0]!];
  expect(validateCodexWindowIds(only)).toEqual(only);
  expect(validateCodexWindowIds(windowIds)).toEqual(windowIds);
  expect(validateCodexWindowIds([])).toBeUndefined();
  expect(validateCodexWindowIds([windowIds[0], windowIds[0]])).toBeUndefined();
  expect(validateCodexWindowIds([...windowIds, firstThread])).toBeUndefined();
  expect(validateCodexWindowIds(["not-a-uuid"])).toBeUndefined();
});
