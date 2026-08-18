import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { AgentSessionRecord } from "@agent-orchestrator/shared";

import { buildTerminalSessionSwitchGroups } from "./TerminalSessionSwitcher.js";

function makeSession(id: string, displayName: string): AgentSessionRecord {
  return {
    id,
    workspaceId: "default",
    sourceType: "local",
    agentKind: "codex",
    displayName,
    connectionState: "online",
    interactionState: "running",
  };
}

describe("buildTerminalSessionSwitchGroups", () => {
  it("preserves configured group order and appends ungrouped sessions", () => {
    const sessions = [
      makeSession("session-alpha", "Alpha"),
      makeSession("session-beta", "Beta"),
      makeSession("session-gamma", "Gamma"),
      makeSession("session-delta", "Delta"),
    ];
    const groups = buildTerminalSessionSwitchGroups({
      sessions,
      sessionGroups: {
        groups: [
          { id: "group-research", name: "模型与量化" },
          { id: "group-platform", name: "工程与平台" },
          { id: "group-empty", name: "空分组" },
        ],
        assignments: {
          "session:session-alpha": "group-research",
          "session:session-beta": "group-research",
          "session:session-gamma": "group-platform",
        },
        collapsedGroupIds: ["group-research"],
      },
      selectedSessionId: "session-alpha",
      placementBySessionId: new Map([
        ["session-alpha", { monitorIndex: 1 }],
        ["session-gamma", { monitorIndex: 2 }],
      ]),
    });

    assert.deepEqual(
      groups.map((group) => [
        group.id,
        group.name,
        group.items.map((item) => item.session.id),
      ]),
      [
        ["group-research", "模型与量化", ["session-alpha", "session-beta"]],
        ["group-platform", "工程与平台", ["session-gamma"]],
        ["__ungrouped__", "未分组", ["session-delta"]],
      ],
    );
  });

  it("marks the current choice and sessions occupied by another pane", () => {
    const sessions = [
      makeSession("session-alpha", "Alpha"),
      makeSession("session-beta", "Beta"),
    ];
    const [group] = buildTerminalSessionSwitchGroups({
      sessions,
      sessionGroups: { groups: [], assignments: {}, collapsedGroupIds: [] },
      selectedSessionId: "session-alpha",
      placementBySessionId: new Map([
        ["session-alpha", { monitorIndex: 1 }],
        ["session-beta", { monitorIndex: 2 }],
      ]),
    });

    assert.equal(group?.name, "全部会话");
    assert.equal(group?.items[0]?.selected, true);
    assert.equal(group?.items[0]?.occupiedPaneIndex, null);
    assert.equal(group?.items[1]?.selected, false);
    assert.equal(group?.items[1]?.occupiedPaneIndex, 2);
  });

  it("matches session names while preserving their original group", () => {
    const groups = buildTerminalSessionSwitchGroups({
      sessions: [
        makeSession("session-alpha", "Alpha Console"),
        makeSession("session-beta", "Beta Console"),
        makeSession("session-gamma", "Gamma Notes"),
      ],
      sessionGroups: {
        groups: [
          { id: "group-research", name: "模型与量化" },
          { id: "group-platform", name: "工程与平台" },
        ],
        assignments: {
          "session:session-alpha": "group-research",
          "session:session-beta": "group-research",
          "session:session-gamma": "group-platform",
        },
        collapsedGroupIds: [],
      },
      selectedSessionId: null,
      placementBySessionId: new Map(),
      searchQuery: "beta",
    });

    assert.deepEqual(
      groups.map((group) => [
        group.name,
        group.items.map((item) => item.session.displayName),
      ]),
      [["模型与量化", ["Beta Console"]]],
    );
  });

  it("matches a group name and keeps every session in that group", () => {
    const groups = buildTerminalSessionSwitchGroups({
      sessions: [
        makeSession("session-alpha", "Alpha"),
        makeSession("session-beta", "Beta"),
        makeSession("session-gamma", "Gamma"),
      ],
      sessionGroups: {
        groups: [
          { id: "group-research", name: "模型与量化" },
          { id: "group-platform", name: "工程与平台" },
        ],
        assignments: {
          "session:session-alpha": "group-research",
          "session:session-beta": "group-research",
          "session:session-gamma": "group-platform",
        },
        collapsedGroupIds: [],
      },
      selectedSessionId: null,
      placementBySessionId: new Map(),
      searchQuery: "平台",
    });

    assert.deepEqual(
      groups.map((group) => [
        group.name,
        group.items.map((item) => item.session.displayName),
      ]),
      [["工程与平台", ["Gamma"]]],
    );
  });

  it("returns no groups when the search has no match", () => {
    const groups = buildTerminalSessionSwitchGroups({
      sessions: [makeSession("session-alpha", "Alpha")],
      sessionGroups: { groups: [], assignments: {}, collapsedGroupIds: [] },
      selectedSessionId: null,
      placementBySessionId: new Map(),
      searchQuery: "missing",
    });

    assert.deepEqual(groups, []);
  });
});
