import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { AgentGridCard } from "./AgentGridCard.js";
import { FocusSidebarSessionCard } from "./FocusSidebarSessionCard.js";
import { HiddenSessionsDrawer } from "./HiddenSessionsDrawer.js";

import { NewSessionDialog } from "./NewSessionDialog.js";
import { DiscoveryDialog } from "./DiscoveryDialog.js";

const session = {
  id: "test-entry",
  workspaceId: "default",
  sourceType: "local" as const,
  agentKind: "shell",
  displayName: "中文测试会话",
  connectionState: "online" as const,
  interactionState: "idle" as const,
};
test("grid and sidebar have named native button entrances", () => {
  const grid = renderToStaticMarkup(
    createElement(AgentGridCard, {
      session,
      onDoubleClick() {},
      onDelete() {},
      onReconnect() {},
    }),
  );
  const sidebar = renderToStaticMarkup(
    createElement(FocusSidebarSessionCard, { session, onSwitchFocus() {} }),
  );
  assert.match(grid, /<button[^>]*aria-label="打开会话 中文测试会话"/);
  assert.match(sidebar, /<button[^>]*aria-label="切换到会话 中文测试会话"/);
});
test("hidden sessions declare modal semantics and unhide is not named recovery", () => {
  const html = renderToStaticMarkup(
    createElement(HiddenSessionsDrawer, {
      sessions: [session],
      open: true,
      onClose() {},
      onUnhide() {},
      onDelete() {},
    }),
  );
  assert.match(html, /role="dialog"/);
  assert.match(html, /aria-labelledby=/);
  assert.match(html, /取消隐藏/);
  assert.doesNotMatch(html, />恢复</);
});

test("creation and discovery dialogs have accessible modal titles", () => {
  const create = renderToStaticMarkup(
    createElement(NewSessionDialog, {
      open: true,
      host: { type: "local" },
      sessions: [],
      onClose() {},
      onLaunched() {},
    }),
  );
  const discover = renderToStaticMarkup(
    createElement(DiscoveryDialog, {
      open: true,
      mode: "tmux",
      host: { type: "local" },
      sessions: [],
      onClose() {},
      onAddToGrid() {},
      onFocusSession() {},
    }),
  );
  for (const html of [create, discover]) {
    assert.match(html, /role="dialog"/);
    const id = html.match(/aria-labelledby="([^"]+)"/)?.[1];
    assert.ok(id);
    assert.ok(html.includes(`id="${id}"`));
    assert.match(html, /tabindex="-1"/);
  }
});
