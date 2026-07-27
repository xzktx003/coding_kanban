import assert from "node:assert/strict";
import test from "node:test";

import type {
  AppVersionResponse,
  RestoreManagedSessionsResponse,
} from "@agent-orchestrator/shared";

import { buildServer } from "../app.js";

const version: AppVersionResponse = {
  runtimeId: "runtime-route-test",
  startedAt: "2026-07-27T00:00:00.000Z",
  sourceRevision: "revision-route-test",
  gitAvailable: true,
  gitHead: "0123456789abcdef",
  gitBranch: "feature/hot-update",
};

const restoreResult: RestoreManagedSessionsResponse = {
  restoredIds: ["managed"],
  alreadyConnectedIds: [],
  manualRecoveryIds: ["direct"],
  failed: [],
};

test("GET /api/app-version returns the injected source revision", async () => {
  const { app } = buildServer({
    appVersionService: {
      getVersion: async () => version,
    },
    managedSessionRestorer: {
      restore: async () => restoreResult,
    },
  });

  const response = await app.inject({
    method: "GET",
    url: "/api/app-version",
  });

  assert.equal(response.statusCode, 200);
  assert.deepEqual(response.json(), version);
  await app.close();
});

test("POST /api/agent-sessions/restore-managed returns bounded restore outcomes", async () => {
  const { app } = buildServer({
    appVersionService: {
      getVersion: async () => version,
    },
    managedSessionRestorer: {
      restore: async () => restoreResult,
    },
  });

  const response = await app.inject({
    method: "POST",
    url: "/api/agent-sessions/restore-managed",
  });

  assert.equal(response.statusCode, 200);
  assert.deepEqual(response.json(), restoreResult);
  await app.close();
});

test("session-state write failures do not prevent the backend from starting", async () => {
  const { app } = buildServer({
    appVersionService: {
      getVersion: async () => version,
    },
    managedSessionRestorer: {
      restore: async () => restoreResult,
    },
    sessionStateStore: {
      load: () => null,
      save: () => {
        throw new Error("disk unavailable");
      },
    },
  });

  const response = await app.inject({
    method: "GET",
    url: "/api/health",
  });

  assert.equal(response.statusCode, 200);
  await app.close();
});
