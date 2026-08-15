import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import type { AgentSessionRecord, DiffFileChange } from "@agent-orchestrator/shared";

import {
  ChangesPanel,
  CompactChangesFilePicker,
  FullscreenDiffView,
} from "./ChangesPanel.js";

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
  assert.match(html, /文件变更/);
  assert.match(
    html,
    /aria-selected="true" class="active"[^>]*role="tab"[^>]*>\s*当前工作区/,
  );
});

test("compact changes use a collapsed file selector instead of expanded rows", () => {
  const files: DiffFileChange[] = [
    {
      path: "apps/web/src/App.tsx",
      status: "modified",
      addedLines: 12,
      deletedLines: 3,
      patch: "",
      binary: false,
    },
    {
      path: "apps/server/src/app.ts",
      status: "added",
      addedLines: 20,
      deletedLines: 0,
      patch: "",
      binary: false,
    },
  ];
  const html = renderToStaticMarkup(
    createElement(CompactChangesFilePicker, {
      files,
      selectedPath: files[0]!.path,
      onSelectPath: () => {},
    }),
  );

  assert.match(html, /aria-label="选择变更文件"/);
  assert.match(html, /App\.tsx/);
  assert.match(html, /app\.ts/);
  assert.doesNotMatch(html, /changes-file-group/);
});

test("file changes can render in a dedicated fullscreen diff view", () => {
  const file: DiffFileChange = {
    path: "apps/web/src/App.tsx",
    status: "modified",
    addedLines: 1,
    deletedLines: 1,
    patch: "@@ -1,1 +1,1 @@\n-old\n+new",
    binary: false,
  };
  const html = renderToStaticMarkup(
    createElement(FullscreenDiffView, {
      file,
      onClose: () => {},
      onReference: () => {},
    }),
  );

  assert.match(html, /aria-label="全屏文件变更"/);
  assert.match(html, /App\.tsx/);
  assert.match(html, /退出全屏/);
  assert.match(html, /diff-row--deleted/);
  assert.match(html, /diff-row--added/);
});
