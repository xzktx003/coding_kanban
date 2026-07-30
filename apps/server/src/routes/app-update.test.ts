import assert from "node:assert/strict";
import test from "node:test";

import type {
  AppVersionResponse,
  GitAutoUpdateStatus,
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

const autoUpdateStatus: GitAutoUpdateStatus = {
  enabled: true,
  intervalMinutes: 10,
  phase: "conflict",
  branch: "v1.3.0",
  remoteHead: "fedcba9876543210",
  lastCheckedAt: "2026-07-30T03:00:00.000Z",
  lastUpdatedAt: null,
  conflictReason: "local-changes",
  message: "本地未提交修改会被远程版本覆盖",
};

test("GET /api/app-version returns the injected source revision", async () => {
  const { app } = buildServer({
    appVersionService: {
      getVersion: async () => version,
    },
    gitAutoUpdateService: {
      getStatus: () => autoUpdateStatus,
      checkNow: async () => autoUpdateStatus,
      applyUpdate: async () => autoUpdateStatus,
      start: () => {},
      stop: () => {},
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
  assert.deepEqual(response.json(), {
    ...version,
    autoUpdate: autoUpdateStatus,
  });
  await app.close();
});

test("POST /api/app-update/check triggers a bounded manual retry", async () => {
  let checks = 0;
  const { app } = buildServer({
    appVersionService: {
      getVersion: async () => version,
    },
    gitAutoUpdateService: {
      getStatus: () => autoUpdateStatus,
      checkNow: async () => {
        checks += 1;
        return autoUpdateStatus;
      },
      applyUpdate: async () => autoUpdateStatus,
      start: () => {},
      stop: () => {},
    },
    managedSessionRestorer: {
      restore: async () => restoreResult,
    },
  });

  const response = await app.inject({
    method: "POST",
    url: "/api/app-update/check",
  });

  assert.equal(response.statusCode, 200);
  assert.deepEqual(response.json(), autoUpdateStatus);
  assert.equal(checks, 1);
  await app.close();
});

test("POST /api/app-update/apply performs the user-confirmed pull", async () => {
  let applies = 0;
  const { app } = buildServer({
    appVersionService: {
      getVersion: async () => version,
    },
    gitAutoUpdateService: {
      getStatus: () => autoUpdateStatus,
      checkNow: async () => autoUpdateStatus,
      applyUpdate: async () => {
        applies += 1;
        return autoUpdateStatus;
      },
      start: () => {},
      stop: () => {},
    },
    managedSessionRestorer: {
      restore: async () => restoreResult,
    },
  });

  const response = await app.inject({
    method: "POST",
    url: "/api/app-update/apply",
  });

  assert.equal(response.statusCode, 200);
  assert.equal(applies, 1);
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
