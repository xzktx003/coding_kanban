import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { AgentSessionRecord } from "@agent-orchestrator/shared";

import {
  addSessionGroup,
  assignSessionToGroup,
  deleteSessionGroup,
  getSessionGroupKey,
  groupSessions,
  loadSessionGroups,
  renameSessionGroup,
  saveSessionGroups,
  isSessionGroupCollapsed,
  toggleSessionGroupCollapsed,
  type SessionGroupState,
} from "./session-groups.js";

function makeSession(
  id: string,
  overrides: Partial<AgentSessionRecord> = {},
): AgentSessionRecord {
  return {
    id,
    workspaceId: "default",
    sourceType: "local",
    agentKind: "codex",
    displayName: id,
    connectionState: "online",
    interactionState: "idle",
    ...overrides,
  };
}

function installStorage(initial?: string) {
  const values = new Map<string, string>();
  if (initial !== undefined) {
    values.set("coding-kanban-session-groups-v1", initial);
  }
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value),
    },
  });
  return values;
}

describe("session groups", () => {
  it("prefers stable tmux pane identity over mutable display names", () => {
    const session = makeSession("runtime-id", {
      displayName: "renamed card",
      hostId: "build-host",
      transportRef: {
        runtimeId: "tmux:build-host:renamed-card",
        tmuxPane: "%12",
        tmuxSession: "renamed-card",
      },
    });

    assert.equal(getSessionGroupKey(session), "tmux-pane:build-host:%12");
    assert.equal(getSessionGroupKey(makeSession("plain")), "session:plain");
  });

  it("keeps registry session identity when a process runtime is replaced", () => {
    const before = makeSession("stable-session", {
      transportRef: { runtimeId: "pty:1001" },
    });
    const after = makeSession("stable-session", {
      transportRef: { runtimeId: "pty:2048" },
    });

    assert.equal(getSessionGroupKey(before), "session:stable-session");
    assert.equal(getSessionGroupKey(after), "session:stable-session");
  });

  it("separates remote tmux panes by username and port", () => {
    const base = {
      hostId: "shared-host",
      transportRef: {
        tmuxPane: "%1",
        sshHost: "example.internal",
      },
    } satisfies Partial<AgentSessionRecord>;

    const alice = makeSession("alice", {
      ...base,
      transportRef: {
        ...base.transportRef,
        sshUsername: "alice",
        sshPort: 22,
      },
    });
    const bob = makeSession("bob", {
      ...base,
      transportRef: {
        ...base.transportRef,
        sshUsername: "bob",
        sshPort: 2222,
      },
    });

    assert.equal(
      getSessionGroupKey(alice),
      "tmux-pane:ssh:alice@example.internal:22:%1",
    );
    assert.equal(
      getSessionGroupKey(bob),
      "tmux-pane:ssh:bob@example.internal:2222:%1",
    );
  });

  it("adds, renames, assigns, and deletes groups immutably", () => {
    const initial: SessionGroupState = {
      groups: [],
      assignments: {},
      collapsedGroupIds: [],
    };
    const added = addSessionGroup(initial, { id: "group-1", name: "后端" });
    const assigned = assignSessionToGroup(added, "session:alpha", "group-1");
    const renamed = renameSessionGroup(assigned, "group-1", "核心后端");
    const deleted = deleteSessionGroup(renamed, "group-1");

    assert.deepEqual(initial, {
      groups: [],
      assignments: {},
      collapsedGroupIds: [],
    });
    assert.equal(renamed.groups[0]?.name, "核心后端");
    assert.equal(renamed.assignments["session:alpha"], "group-1");
    assert.deepEqual(deleted, {
      groups: [],
      assignments: {},
      collapsedGroupIds: [],
    });
  });

  it("toggles collapsed groups and removes deleted group collapse state", () => {
    const state: SessionGroupState = {
      groups: [{ id: "group-1", name: "后端" }],
      assignments: {},
      collapsedGroupIds: [],
    };

    const collapsed = toggleSessionGroupCollapsed(state, "group-1");
    assert.equal(isSessionGroupCollapsed(collapsed, "group-1"), true);
    assert.equal(isSessionGroupCollapsed(state, "group-1"), false);

    const expanded = toggleSessionGroupCollapsed(collapsed, "group-1");
    assert.equal(isSessionGroupCollapsed(expanded, "group-1"), false);

    const deleted = deleteSessionGroup(collapsed, "group-1");
    assert.deepEqual(deleted.collapsedGroupIds, []);
  });

  it("tracks kanban group collapse state independently per status column", () => {
    const state: SessionGroupState = {
      groups: [{ id: "group-1", name: "后端" }],
      assignments: {},
      collapsedGroupIds: [],
    };

    const collapsedExecuting = toggleSessionGroupCollapsed(
      state,
      "group-1",
      "executing",
    );

    assert.equal(
      isSessionGroupCollapsed(collapsedExecuting, "group-1", "executing"),
      true,
    );
    assert.equal(
      isSessionGroupCollapsed(collapsedExecuting, "group-1", "response"),
      false,
    );
    assert.equal(isSessionGroupCollapsed(collapsedExecuting, "group-1"), false);

    const deleted = deleteSessionGroup(collapsedExecuting, "group-1");
    assert.deepEqual(deleted.collapsedGroupIds, []);
  });

  it("orders configured groups before the automatic ungrouped section", () => {
    const alpha = makeSession("alpha");
    const beta = makeSession("beta");
    const grouped = groupSessions([alpha, beta], {
      groups: [
        { id: "group-b", name: "后端" },
        { id: "group-f", name: "前端" },
      ],
      assignments: { "session:beta": "group-f" },
      collapsedGroupIds: [],
    });

    assert.deepEqual(
      grouped.map((group) => [group.id, group.sessions.map((item) => item.id)]),
      [
        ["group-b", []],
        ["group-f", ["beta"]],
        ["__ungrouped__", ["alpha"]],
      ],
    );
  });

  it("normalizes corrupt storage and persists valid state", () => {
    const values = installStorage("{not-json");
    assert.deepEqual(loadSessionGroups(), {
      groups: [],
      assignments: {},
      collapsedGroupIds: [],
    });

    const state: SessionGroupState = {
      groups: [{ id: "group-1", name: "前端" }],
      assignments: { "session:alpha": "group-1" },
      collapsedGroupIds: ["group-1"],
    };
    saveSessionGroups(state);

    assert.deepEqual(
      JSON.parse(values.get("coding-kanban-session-groups-v1") ?? "null"),
      state,
    );
    assert.deepEqual(loadSessionGroups(), state);
  });
});
