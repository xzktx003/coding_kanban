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

function findElementByType(
  node: ReactNode,
  type: unknown,
): ReactElement<Record<string, unknown>> | null {
  if (Array.isArray(node)) {
    for (const child of node) {
      const match = findElementByType(child, type);
      if (match) {
        return match;
      }
    }
    return null;
  }

  if (!isReactElement(node)) {
    return null;
  }

  if (node.type === type) {
    return node as ReactElement<Record<string, unknown>>;
  }

  return findElementByType(node.props.children, type);
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

  it("restores lazy terminal previews in grid cards when lightweight mode is disabled", () => {
    const element = AgentGridCard({
      session: makeSession(),
      onDoubleClick: () => {},
      onDelete: () => {},
      onReconnect: () => {},
      useLightweightTerminalPreview: false,
    });
    const types = collectElementTypes(element);

    assert.equal(types.includes(TerminalPreview), false);
    assert.equal(types.includes(LazyTerminalView), true);
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

  it("restores lazy terminal previews in focus sidebars when lightweight mode is disabled", () => {
    const element = FocusSidebarSessionCard({
      session: makeSession({ id: "sidebar-session" }),
      onSwitchFocus: () => {},
      useLightweightTerminalPreview: false,
    });
    const types = collectElementTypes(element);

    assert.equal(types.includes(TerminalPreview), false);
    assert.equal(types.includes(LazyTerminalView), true);
    assert.equal(
      findElementByType(element, LazyTerminalView)?.props.wheelPassthrough,
      true,
    );
  });
});
