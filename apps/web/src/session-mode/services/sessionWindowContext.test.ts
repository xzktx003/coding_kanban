import { afterEach, expect, test } from "vitest";
import {
  hasSessionWindowRoute,
  sessionWindowDraftOwner,
  sessionWindowId,
  sessionWindowStorageName,
} from "./sessionWindowContext";
const id = "40bd1159-560e-4977-b808-b32aaf93265c";
afterEach(() => window.history.replaceState(null, "", "/"));
test("ordinary pages retain their existing persistence and draft owner identities", () => {
  window.history.replaceState(null, "", "/?mode=session");
  expect(hasSessionWindowRoute()).toBe(false);
  expect(sessionWindowId()).toBeNull();
  expect(sessionWindowStorageName("layout")).toBe("layout");
  expect(sessionWindowDraftOwner("codex-owner")).toBe("codex-owner");
});
test("a dedicated window isolates local state and drafts while retaining a stable scope across refresh", () => {
  window.history.replaceState(null, "", `/?mode=session&sessionWindow=${id}`);
  expect(hasSessionWindowRoute()).toBe(true);
  expect(sessionWindowId()).toBe(id);
  expect(sessionWindowStorageName("layout")).toBe(`layout.window.${id}`);
  expect(sessionWindowDraftOwner("codex-owner")).toBe(
    JSON.stringify(["window", id, "codex-owner"]),
  );
});
test.each(["bad", `${id}&sessionWindow=${id}`])(
  "an invalid or duplicated route is recognized but never receives a valid namespace: %s",
  (value) => {
    window.history.replaceState(
      null,
      "",
      `/?mode=session&sessionWindow=${value}`,
    );
    expect(hasSessionWindowRoute()).toBe(true);
    expect(sessionWindowId()).toBeNull();
  },
);
