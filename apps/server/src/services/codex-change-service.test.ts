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
      line({
        type: "session_meta",
        payload: { id: "task-session", cwd: "/workspace/project" },
      }),
      line({
        timestamp: "2026-08-14T01:00:00.000Z",
        type: "response_item",
        payload: {
          type: "message",
          role: "user",
          content: [{ text: "旧任务" }],
        },
      }),
      line({
        timestamp: "2026-08-14T01:00:01.000Z",
        type: "response_item",
        payload: {
          type: "custom_tool_call",
          name: "apply_patch",
          call_id: "old",
          input:
            "*** Begin Patch\n*** Update File: /workspace/project/old.ts\n-old\n+older\n*** End Patch",
        },
      }),
      line({
        timestamp: "2026-08-14T02:00:00.000Z",
        type: "response_item",
        payload: {
          type: "message",
          role: "user",
          content: [{ text: "实现新功能" }],
        },
      }),
      line({
        timestamp: "2026-08-14T02:00:01.000Z",
        type: "response_item",
        payload: {
          type: "custom_tool_call",
          name: "apply_patch",
          call_id: "new",
          input:
            "*** Begin Patch\n*** Update File: /workspace/project/src/new.ts\n-before\n+after\n+extra\n*** End Patch",
        },
      }),
    ].join(""),
  );

  try {
    const result = new CodexChangeService({
      sessionsRoot: join(root, "sessions"),
    }).read({
      sessionId: "task-session",
      workingDirectory: "/workspace/project",
    });

    assert.equal(result.available, true);
    assert.equal(result.taskTitle, "实现新功能");
    assert.equal(result.changedFiles, 1);
    assert.equal(result.files[0]?.path, "src/new.ts");
    assert.equal(
      result.files.some((file) => file.path === "old.ts"),
      false,
    );
    assert.equal(result.addedLines, 2);
    assert.equal(result.deletedLines, 1);
    assert.equal(result.confidence, "medium");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("CodexChangeService maps native FileChange events from the latest Codex turn", () => {
  const root = mkdtempSync(join(tmpdir(), "codex-native-changes-"));
  const sessionsRoot = join(root, "sessions", "2026", "08", "19");
  mkdirSync(sessionsRoot, { recursive: true });
  writeFileSync(
    join(sessionsRoot, "rollout-native-session.jsonl"),
    [
      line({
        type: "session_meta",
        payload: { id: "native-session", cwd: "/workspace/project" },
      }),
      line({
        timestamp: "2026-08-19T01:00:00.000Z",
        type: "event_msg",
        payload: { type: "task_started", turn_id: "turn-old" },
      }),
      line({
        timestamp: "2026-08-19T01:00:01.000Z",
        type: "response_item",
        payload: {
          type: "message",
          role: "user",
          content: [{ text: "旧任务" }],
        },
      }),
      line({
        timestamp: "2026-08-19T01:00:02.000Z",
        type: "event_msg",
        payload: {
          type: "item_completed",
          turn_id: "turn-old",
          item: {
            type: "FileChange",
            changes: {
              "/workspace/project/old.ts": {
                type: "update",
                unified_diff: "@@ -1 +1 @@\n-old\n+older",
              },
            },
          },
        },
      }),
      line({
        timestamp: "2026-08-19T02:00:00.000Z",
        type: "event_msg",
        payload: { type: "task_started", turn_id: "turn-new" },
      }),
      line({
        timestamp: "2026-08-19T02:00:01.000Z",
        type: "response_item",
        payload: {
          type: "message",
          role: "user",
          content: [{ text: "映射 Codex 原生 diff" }],
        },
      }),
      line({
        timestamp: "2026-08-19T02:00:02.000Z",
        type: "event_msg",
        payload: {
          type: "item_completed",
          turn_id: "turn-new",
          item: {
            type: "FileChange",
            changes: {
              "/workspace/project/src/new.ts": {
                type: "update",
                unified_diff: "@@ -1 +1,2 @@\n-before\n+after\n+extra",
                move_path: null,
              },
              "/workspace/project/src/added.ts": {
                type: "add",
                content: "one\ntwo\n",
              },
              "/workspace/project/src/deleted.ts": {
                type: "delete",
                content: "gone\n",
              },
            },
          },
        },
      }),
    ].join(""),
  );

  try {
    const result = new CodexChangeService({
      sessionsRoot: join(root, "sessions"),
    }).read({
      sessionId: "native-session",
      workingDirectory: "/workspace/project",
    });

    assert.equal(result.available, true);
    assert.equal(result.matchedBy, "session-id");
    assert.equal(result.taskTitle, "映射 Codex 原生 diff");
    assert.equal(result.changedFiles, 3);
    assert.equal(result.addedLines, 4);
    assert.equal(result.deletedLines, 2);
    assert.deepEqual(
      result.files.map((file) => [file.path, file.status]),
      [
        ["src/added.ts", "added"],
        ["src/deleted.ts", "deleted"],
        ["src/new.ts", "modified"],
      ],
    );
    assert.equal(
      result.files.find((file) => file.path === "src/new.ts")?.patch,
      "@@ -1 +1,2 @@\n-before\n+after\n+extra",
    );
    assert.equal(
      result.files.some((file) => file.path === "old.ts"),
      false,
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
