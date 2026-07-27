import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import type {
  AgentSessionRecord,
  ListAgentSessionsResponse,
} from "@agent-orchestrator/shared";

import { AgentSessionRegistry } from "./agent-session-registry.js";
import { FileSessionStateStore } from "./session-state-store.js";

function buildSession(
  id: string,
  overrides: Partial<AgentSessionRecord> = {},
): AgentSessionRecord {
  return {
    id,
    workspaceId: "default",
    hostId: "local",
    sourceType: "local",
    agentKind: "copilot",
    displayName: id,
    workingDirectory: "/workspace",
    connectionState: "online",
    interactionState: "running",
    controlMode: "control",
    transportRef: {
      processId: 12345,
      runtimeId: "pty:12345",
      tmuxSession: `tmux-${id}`,
    },
    ...overrides,
  };
}

function buildSnapshot(): ListAgentSessionsResponse {
  return {
    items: [
      buildSession("managed", {
        hidden: true,
        tags: ["hot-update"],
      }),
      buildSession("direct", {
        transportRef: {
          processId: 45678,
          runtimeId: "pty:45678",
        },
      }),
    ],
    activeAgentSessionId: "managed",
    updatedAt: "2026-07-27T00:00:00.000Z",
  };
}

test("file store persists stable metadata without ephemeral process references", () => {
  const directory = mkdtempSync(join(tmpdir(), "coding-kanban-sessions-"));
  const filePath = join(directory, "state", "sessions.json");

  try {
    const store = new FileSessionStateStore(filePath);
    store.save(buildSnapshot());

    const raw = readFileSync(filePath, "utf8");
    assert.doesNotMatch(raw, /12345|45678|pty:/);

    const loaded = store.load();
    assert.equal(loaded?.activeAgentSessionId, "managed");
    assert.deepEqual(
      loaded?.items.map((session) => session.id),
      ["managed", "direct"],
    );
    assert.equal(loaded?.items[0]?.hidden, true);
    assert.deepEqual(loaded?.items[0]?.tags, ["hot-update"]);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("file store ignores malformed and unsupported state files", () => {
  const directory = mkdtempSync(join(tmpdir(), "coding-kanban-sessions-"));
  const filePath = join(directory, "sessions.json");
  const store = new FileSessionStateStore(filePath);

  try {
    writeFileSync(filePath, "not json");
    assert.equal(store.load(), null);

    writeFileSync(filePath, JSON.stringify({ version: 999, snapshot: {} }));
    assert.equal(store.load(), null);

    const duplicated = buildSnapshot();
    writeFileSync(
      filePath,
      JSON.stringify({
        ...duplicated,
        items: [duplicated.items[0], duplicated.items[0]],
      }),
    );
    assert.equal(store.load(), null);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("file store skips writes when only the volatile snapshot timestamp changes", () => {
  const directory = mkdtempSync(join(tmpdir(), "coding-kanban-sessions-"));
  const filePath = join(directory, "sessions.json");
  const store = new FileSessionStateStore(filePath);

  try {
    const initial = buildSnapshot();
    store.save(initial);
    const firstContent = readFileSync(filePath, "utf8");

    store.save({
      ...initial,
      updatedAt: "2026-07-27T00:01:00.000Z",
    });

    assert.equal(readFileSync(filePath, "utf8"), firstContent);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("file store skips writes when only runtime connection state changes", () => {
  const directory = mkdtempSync(join(tmpdir(), "coding-kanban-sessions-"));
  const filePath = join(directory, "sessions.json");
  const store = new FileSessionStateStore(filePath);

  try {
    const initial = buildSnapshot();
    store.save(initial);
    const firstContent = readFileSync(filePath, "utf8");

    store.save({
      ...initial,
      items: initial.items.map((session) => ({
        ...session,
        connectionState: "offline",
        interactionState: session.transportRef?.tmuxSession
          ? "detached"
          : "exited",
      })),
      updatedAt: "2026-07-27T00:01:00.000Z",
    });

    assert.equal(readFileSync(filePath, "utf8"), firstContent);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("file store still writes when persisted session metadata changes", () => {
  const directory = mkdtempSync(join(tmpdir(), "coding-kanban-sessions-"));
  const filePath = join(directory, "sessions.json");
  const store = new FileSessionStateStore(filePath);

  try {
    const initial = buildSnapshot();
    store.save(initial);
    const firstContent = readFileSync(filePath, "utf8");

    store.save({
      ...initial,
      items: initial.items.map((session) =>
        session.id === "managed"
          ? { ...session, displayName: "renamed managed session" }
          : session,
      ),
      updatedAt: "2026-07-27T00:01:00.000Z",
    });

    assert.notEqual(readFileSync(filePath, "utf8"), firstContent);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("registry restores stable ids and marks tmux/direct sessions with the correct recovery boundary", () => {
  const registry = new AgentSessionRegistry();

  registry.restore(buildSnapshot());

  const restored = registry.list();
  assert.equal(restored.activeAgentSessionId, "managed");
  assert.deepEqual(
    restored.items.map((session) => session.id),
    ["direct", "managed"],
  );

  const managed = registry.get("managed");
  assert.equal(managed.connectionState, "offline");
  assert.equal(managed.interactionState, "detached");
  assert.equal(managed.transportRef?.processId, undefined);
  assert.equal(managed.transportRef?.runtimeId, undefined);
  assert.match(managed.outputPreview ?? "", /等待恢复 tmux/);

  const direct = registry.get("direct");
  assert.equal(direct.connectionState, "offline");
  assert.equal(direct.interactionState, "exited");
  assert.match(direct.outputPreview ?? "", /需要手动恢复/);
});
