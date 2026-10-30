import { beforeEach, expect, it } from "vitest";
import {
  beginConnectionCheck,
  connectionCheckFailed,
  connectionCheckSucceeded,
  connectionDiagnosticSnapshot,
  SessionSyncError,
  useSessionConnectionDiagnostics,
} from "./sessionConnectionDiagnostics";

beforeEach(() =>
  useSessionConnectionDiagnostics.setState(
    useSessionConnectionDiagnostics.getInitialState(),
    true,
  ),
);

it("keeps the last failure after recovery with fixed storage rather than an event log", () => {
  for (let i = 0; i < 100; i++) {
    beginConnectionCheck("tabs");
    connectionCheckFailed("tabs", new SessionSyncError("http", 503));
    connectionCheckSucceeded("tabs");
  }
  const record = connectionDiagnosticSnapshot().channels.tabs;
  expect(record.failure).toBeNull();
  expect(record).toMatchObject({
    totalFailures: 100,
    lastFailure: { kind: "http", status: 503, attempts: 1 },
  });
  expect(JSON.stringify(connectionDiagnosticSnapshot()).length).toBeLessThan(
    4096,
  );
});
