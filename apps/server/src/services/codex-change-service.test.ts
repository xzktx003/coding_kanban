import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { CodexChangeService } from "./codex-change-service.js";

function line(value: unknown): string {
  return `${JSON.stringify(value)}\n`;
}

test("CodexChangeService attributes apply_patch calls after the latest user task", () => {
  const root = mkdtempSync(join(tmpdir(), "codex-changes-"));
  const sessionsRoot = join(root, "sessions", "2026", "08", "14");
  mkdirSync(sessionsRoot, { recursive: true });
  writeFileSync(
    join(sessionsRoot, "rollout-task-session.jsonl"),
    [
      line({ type: "session_meta", payload: { id: "task-session", cwd: "/workspace/project" } }),
      line({ timestamp: "2026-08-14T01:00:00.000Z", type: "response_item", payload: { type: "message", role: "user", content: [{ text: "旧任务" }] } }),
      line({ timestamp: "2026-08-14T01:00:01.000Z", type: "response_item", payload: { type: "custom_tool_call", name: "apply_patch", call_id: "old", input: "*** Begin Patch\n*** Update File: /workspace/project/old.ts\n-old\n+older\n*** End Patch" } }),
      line({ timestamp: "2026-08-14T02:00:00.000Z", type: "response_item", payload: { type: "message", role: "user", content: [{ text: "实现新功能" }] } }),
      line({ timestamp: "2026-08-14T02:00:01.000Z", type: "response_item", payload: { type: "custom_tool_call", name: "apply_patch", call_id: "new", input: "*** Begin Patch\n*** Update File: /workspace/project/src/new.ts\n-before\n+after\n+extra\n*** End Patch" } }),
    ].join(""),
  );

  try {
    const result = new CodexChangeService({ sessionsRoot: join(root, "sessions") }).read({
      sessionId: "task-session",
      workingDirectory: "/workspace/project",
    });

    assert.equal(result.available, true);
    assert.equal(result.taskTitle, "实现新功能");
    assert.equal(result.changedFiles, 1);
    assert.equal(result.files[0]?.path, "src/new.ts");
    assert.equal(result.files.some((file) => file.path === "old.ts"), false);
    assert.equal(result.addedLines, 2);
    assert.equal(result.deletedLines, 1);
    assert.equal(result.confidence, "medium");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});