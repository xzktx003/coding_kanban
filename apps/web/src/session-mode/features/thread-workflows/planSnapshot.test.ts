import { beforeEach, expect, it } from "vitest";
import {
  savePlanWindowSnapshot,
  readPlanWindowSnapshot,
  planWindowUrl,
  PLAN_WINDOW_STORAGE_PREFIX,
} from "./planSnapshot";
const snapshot = {
  text: "# Captured plan",
  threadId: "original",
  turnId: "turn",
  cwd: "/owner",
  language: "zh-CN",
  rootClassName: "session-mode dark",
  cssVariables: { "--foreground": "#ccc" },
  theme: {
    theme: "dark" as const,
    resolvedTheme: "dark" as const,
    accent: "default" as const,
    starfield: false,
    backgroundImage: null,
  },
};
beforeEach(() => sessionStorage.clear());
it("stores an immutable bounded snapshot and puts only an opaque id in the popup URL", () => {
  const chosen = structuredClone(snapshot);
  const id = savePlanWindowSnapshot(chosen, sessionStorage, 1000);
  chosen.text = "Changed plan";
  chosen.cwd = "/foreign";
  chosen.cssVariables["--foreground"] = "red";
  expect(readPlanWindowSnapshot(id, sessionStorage, 1001)).toMatchObject(
    snapshot,
  );
  const url = new URL(
    planWindowUrl("https://lan.invalid/path?secret=excluded#old", id),
  );
  expect([...url.searchParams.keys()]).toEqual(["mode", "planWindow"]);
  expect(url.pathname).toBe("/path");
  expect(url.searchParams.get("planWindow")).toBe(id);
  expect(url.hash).toBe("");
});
it("missing, invalid, expired or oversized content is an explicit error rather than opening a workbench", () => {
  expect(() => readPlanWindowSnapshot("invalid")).toThrow(/无效/);
  const id = savePlanWindowSnapshot(snapshot, sessionStorage, 1000);
  expect(() =>
    readPlanWindowSnapshot(id, sessionStorage, 1000 + 31 * 60_000),
  ).toThrow(/过期/);
  sessionStorage.removeItem(PLAN_WINDOW_STORAGE_PREFIX + id);
  expect(() => readPlanWindowSnapshot(id, sessionStorage, 1001)).toThrow(
    /不存在/,
  );
  expect(() =>
    savePlanWindowSnapshot({ ...snapshot, text: "x".repeat(1_000_001) }),
  ).toThrow(/过长/);
  sessionStorage.setItem(
    PLAN_WINDOW_STORAGE_PREFIX + id,
    JSON.stringify({
      version: 1,
      createdAt: 1000,
      ...snapshot,
      theme: { resolvedTheme: "foreign" },
    }),
  );
  expect(() => readPlanWindowSnapshot(id, sessionStorage, 1001)).toThrow(
    /无效/,
  );
});
it("rejects snapshots that escape session-mode styling or use an invalid CSS variable container", () => {
  expect(() =>
    savePlanWindowSnapshot({ ...snapshot, rootClassName: "dark" }),
  ).toThrow(/无效/);
  expect(() =>
    savePlanWindowSnapshot({ ...snapshot, cssVariables: [] as never }),
  ).toThrow(/无效/);
});
