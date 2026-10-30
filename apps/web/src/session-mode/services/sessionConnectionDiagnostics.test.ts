import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
  beginConnectionCheck,
  connectionDiagnosticSnapshot,
  connectionCheckFailed,
  connectionCheckSucceeded,
  readSharedSnapshot,
  SessionSyncError,
  syncRetryDelay,
  useSessionConnectionDiagnostics,
} from "./sessionConnectionDiagnostics";
beforeEach(() => {
  vi.useFakeTimers();
  useSessionConnectionDiagnostics.setState(
    useSessionConnectionDiagnostics.getInitialState(),
    true,
  );
});
afterEach(() => vi.useRealTimers());

it("exports only the four fixed diagnostic records without unexpected payload fields", () => {
  beginConnectionCheck("tabs", "write", 2);
  connectionCheckFailed("tabs", new SessionSyncError("http", 503));
  useSessionConnectionDiagnostics.setState((state) => ({
    tabs: {
      ...state.tabs,
      secretBody: "must never export",
    } as typeof state.tabs,
  }));
  const snapshot = connectionDiagnosticSnapshot();
  expect(Object.keys(snapshot.channels).sort()).toEqual([
    "events",
    "health",
    "projects",
    "tabs",
  ]);
  expect(snapshot.channels.tabs.pending).toBe(2);
  expect(snapshot.channels.tabs.failure?.status).toBe(503);
  expect(JSON.stringify(snapshot)).not.toContain("must never export");
});

it("records bounded channel metadata and clears failure only on that channel's success", () => {
  beginConnectionCheck("tabs");
  connectionCheckFailed("tabs", new SessionSyncError("http", 503));
  beginConnectionCheck("projects");
  connectionCheckSucceeded("projects");
  expect(useSessionConnectionDiagnostics.getState().tabs.failure?.status).toBe(
    503,
  );
  expect(
    useSessionConnectionDiagnostics.getState().projects.failure,
  ).toBeNull();
  for (let i = 0; i < 100; i++) {
    beginConnectionCheck("tabs");
    connectionCheckFailed("tabs", new TypeError("sensitive transport text"));
  }
  expect(Object.keys(useSessionConnectionDiagnostics.getState())).toEqual([
    "health",
    "tabs",
    "projects",
    "events",
  ]);
  expect(
    JSON.stringify(useSessionConnectionDiagnostics.getState()),
  ).not.toContain("sensitive");
  connectionCheckSucceeded("tabs");
  expect(useSessionConnectionDiagnostics.getState().tabs.failure).toBeNull();
});

it("bounds and aborts a hung transport even when it ignores cancellation", async () => {
  let signal!: AbortSignal;
  const promise = readSharedSnapshot(
    "/fixture",
    {},
    new AbortController().signal,
    ((_url, init) => {
      signal = init!.signal!;
      return new Promise(() => {});
    }) as typeof fetch,
  );
  const rejected = expect(promise).rejects.toMatchObject({
    name: "TimeoutError",
  });
  await vi.advanceTimersByTimeAsync(10001);
  await rejected;
  expect(signal.aborted).toBe(true);
});

it("respects bounded Retry-After and increases automatic backoff while preserving explicit retry admission", () => {
  expect(syncRetryDelay(1)).toBe(5000);
  expect(syncRetryDelay(2, undefined, () => 0.5)).toBe(10500);
  expect(syncRetryDelay(100, undefined, () => 0.9)).toBe(30000);
  expect(syncRetryDelay(1, new SessionSyncError("http", 429, 20000))).toBe(
    20000,
  );
});
