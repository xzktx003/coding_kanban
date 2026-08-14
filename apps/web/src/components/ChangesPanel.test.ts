import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import type { AgentSessionRecord } from "@agent-orchestrator/shared";

import { ChangesPanel } from "./ChangesPanel.js";

const session: AgentSessionRecord = {
  id: "session-1",
  workspaceId: "default",
  sourceType: "local",
  agentKind: "codex",
  displayName: "Diff task",
  workingDirectory: "/workspace/project",
  connectionState: "online",
  interactionState: "idle",
};

test("ChangesPanel presents task and checkout as separate top-level scopes", () => {
  const html = renderToStaticMarkup(createElement(ChangesPanel, { session }));
  assert.match(html, /本次任务/);
  assert.match(html, /当前工作区/);
  assert.match(html, /变更审查/);
});