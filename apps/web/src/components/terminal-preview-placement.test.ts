import { describe, it } from "node:test";
import assert from "node:assert/strict";
import type { ReactElement, ReactNode } from "react";

import type { AgentSessionRecord } from "@agent-orchestrator/shared";

import { AgentGridCard } from "./AgentGridCard.js";
import { FocusSidebarSessionCard } from "./FocusSidebarSessionCard.js";
import { LazyTerminalView } from "./LazyTerminalView.js";
import { TerminalPreview } from "./TerminalPreview.js";

function makeSession(
  overrides: Partial<AgentSessionRecord> = {},
): AgentSessionRecord {
  return {
    id: "session-default",
    workspaceId: "default",
    sourceType: "local",
    agentKind: "codex",
    displayName: "Default Session",
    workingDirectory: "/data01/home/xuzk/workspace/coding_kanban",
    connectionState: "online",
    interactionState: "running",
    outputPreview: "ready",
    ...overrides,
  };
}

function isReactElement(node: ReactNode): node is ReactElement<{
  children?: ReactNode;
}> {
  return Boolean(
    node && typeof node === "object" && "type" in node && "props" in node,
  );
}

function collectElementTypes(
  node: ReactNode,
  types: unknown[] = [],
): unknown[] {
  if (Array.isArray(node)) {
    for (const child of node) {
      collectElementTypes(child, types);
    }
    return types;
  }

  if (!isReactElement(node)) {
    return types;
  }

  types.push(node.type);
  collectElementTypes(node.props.children, types);
  return types;
}

describe("terminal preview placement", () => {
  it("uses lightweight preview by default in grid cards", () => {
    const element = AgentGridCard({
      session: makeSession(),
      onDoubleClick: () => {},
      onDelete: () => {},
      onReconnect: () => {},
    });
    const types = collectElementTypes(element);

    assert.equal(types.includes(TerminalPreview), true);
    assert.equal(types.includes(LazyTerminalView), false);
  });

  it("uses lightweight preview by default in focus sidebars", () => {
    const element = FocusSidebarSessionCard({
      session: makeSession({ id: "sidebar-session" }),
      onSwitchFocus: () => {},
    });
    const types = collectElementTypes(element);

    assert.equal(types.includes(TerminalPreview), true);
    assert.equal(types.includes(LazyTerminalView), false);
  });
});
