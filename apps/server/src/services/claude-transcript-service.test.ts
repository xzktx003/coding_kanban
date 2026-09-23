import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  ClaudeTranscriptService,
  encodeClaudeProjectDirectory,
} from "./claude-transcript-service.js";

test("Claude transcript uses the pane directory when the indexed session file is gone", async () => {
  const root = mkdtempSync(join(tmpdir(), "claude-transcript-"));
  const cwd = "/workspace/session_agent";
  const projects = join(root, "projects", encodeClaudeProjectDirectory(cwd));
  const sessions = join(root, "sessions");
  mkdirSync(projects, { recursive: true });
  mkdirSync(sessions, { recursive: true });
  writeFileSync(
    join(sessions, "100.json"),
    JSON.stringify({
      sessionId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      cwd,
      tmux: "session_agent:@9.%9",
      updatedAt: 10,
    }),
  );
  const liveId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
  writeFileSync(
    join(projects, `${liveId}.jsonl`),
    [
      JSON.stringify({
        type: "user",
        uuid: "user-1",
        timestamp: "2026-09-23T01:00:00.000Z",
        sessionId: liveId,
        cwd,
        message: { role: "user", content: "看一下记录" },
      }),
      JSON.stringify({
        type: "assistant",
        uuid: "assistant-1",
        timestamp: "2026-09-23T01:00:01.000Z",
        sessionId: liveId,
        cwd,
        message: {
          role: "assistant",
          content: [
            { type: "thinking", thinking: "hidden" },
            { type: "text", text: "记录在这里" },
          ],
          stop_reason: null,
        },
      }),
    ].join("\n") + "\n",
  );

  const service = new ClaudeTranscriptService({
    projectsRoot: join(root, "projects"),
    sessionsRoot: sessions,
  });
  const page = await service.read({
    tmuxSession: "session_agent",
    tmuxPane: "%9",
    workingDirectory: "/somewhere/stale",
  });

  assert.equal(page.available, true);
  assert.equal(page.agentKind, "claude");
  assert.equal(page.sessionId, liveId);
  assert.equal(page.matchedBy, "working-directory");
  assert.deepEqual(
    page.entries.map((entry) => entry.text),
    ["看一下记录", "记录在这里"],
  );
});

test("Claude transcript pages the full conversation newest-first with an older cursor", async () => {
  const root = mkdtempSync(join(tmpdir(), "claude-transcript-pages-"));
  const cwd = "/workspace/paged";
  const project = join(root, "projects", encodeClaudeProjectDirectory(cwd));
  const sessionId = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
  mkdirSync(project, { recursive: true });
  writeFileSync(
    join(project, `${sessionId}.jsonl`),
    [
      {
        type: "user",
        uuid: "user-1",
        timestamp: "2026-09-23T01:00:00.000Z",
        sessionId,
        cwd,
        message: { content: "第一个问题" },
      },
      {
        type: "assistant",
        uuid: "assistant-1",
        timestamp: "2026-09-23T01:00:01.000Z",
        sessionId,
        cwd,
        message: { content: [{ type: "text", text: "第一条回答" }] },
      },
      {
        type: "user",
        uuid: "user-2",
        timestamp: "2026-09-23T01:00:02.000Z",
        sessionId,
        cwd,
        message: { content: "第二个问题" },
      },
    ]
      .map((record) => JSON.stringify(record))
      .join("\n") + "\n",
  );

  const service = new ClaudeTranscriptService({
    projectsRoot: join(root, "projects"),
    sessionsRoot: join(root, "sessions"),
  });
  const latest = await service.read({ sessionId, limit: 2 });

  assert.equal(latest.available, true);
  assert.deepEqual(
    latest.entries.map((entry) => entry.text),
    ["第一条回答", "第二个问题"],
  );
  assert.equal(latest.hasMore, true);
  assert.ok(latest.nextCursor);

  const older = await service.read({
    sessionId,
    cursor: latest.nextCursor ?? undefined,
    limit: 2,
  });
  assert.deepEqual(
    older.entries.map((entry) => entry.text),
    ["第一个问题"],
  );
  assert.equal(older.hasMore, false);
});

test("Claude latest completion follows the final assistant response past tool use", async () => {
  const root = mkdtempSync(join(tmpdir(), "claude-transcript-completion-"));
  const cwd = "/workspace/completion";
  const project = join(root, "projects", encodeClaudeProjectDirectory(cwd));
  const sessionId = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
  mkdirSync(project, { recursive: true });
  writeFileSync(
    join(project, `${sessionId}.jsonl`),
    [
      {
        type: "user",
        uuid: "user-1",
        timestamp: "2026-09-23T02:00:00.000Z",
        sessionId,
        cwd,
        message: { content: "修好这个问题" },
      },
      {
        type: "assistant",
        uuid: "assistant-tool",
        timestamp: "2026-09-23T02:00:01.000Z",
        sessionId,
        cwd,
        message: {
          content: [
            { type: "text", text: "先检查一下。" },
            {
              type: "tool_use",
              id: "tool-1",
              name: "Read",
              input: { file: "app.ts" },
            },
          ],
          stop_reason: "tool_use",
        },
      },
      {
        type: "assistant",
        uuid: "assistant-final",
        timestamp: "2026-09-23T02:00:02.000Z",
        sessionId,
        cwd,
        message: {
          id: "message-final",
          content: [{ type: "text", text: "问题已经修复。" }],
          stop_reason: "end_turn",
        },
      },
    ]
      .map((record) => JSON.stringify(record))
      .join("\n") + "\n",
  );

  const service = new ClaudeTranscriptService({
    projectsRoot: join(root, "projects"),
    sessionsRoot: join(root, "sessions"),
  });
  const completion = await service.readLatestCompletion({ sessionId });

  assert.deepEqual(completion, {
    completionId: "message-final",
    sessionId,
    content: "问题已经修复。",
    completedAt: "2026-09-23T02:00:02.000Z",
    userQuestion: "修好这个问题",
  });
});

test("Claude completion reader does not treat tool calls or unfinished assistant output as complete", async () => {
  const root = mkdtempSync(join(tmpdir(), "claude-transcript-incomplete-"));
  const cwd = "/workspace/incomplete";
  const project = join(root, "projects", encodeClaudeProjectDirectory(cwd));
  const sessionId = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";
  mkdirSync(project, { recursive: true });
  writeFileSync(
    join(project, `${sessionId}.jsonl`),
    [
      {
        type: "assistant",
        uuid: "assistant-tool",
        timestamp: "2026-09-23T03:00:00.000Z",
        sessionId,
        cwd,
        message: {
          content: [
            { type: "tool_use", id: "tool-1", name: "Bash", input: "true" },
          ],
          stop_reason: "tool_use",
        },
      },
      {
        type: "assistant",
        uuid: "assistant-streaming",
        timestamp: "2026-09-23T03:00:01.000Z",
        sessionId,
        cwd,
        message: {
          content: [{ type: "text", text: "still writing" }],
          stop_reason: null,
        },
      },
    ]
      .map((record) => JSON.stringify(record))
      .join("\n") + "\n",
  );

  const service = new ClaudeTranscriptService({
    projectsRoot: join(root, "projects"),
    sessionsRoot: join(root, "sessions"),
  });

  assert.equal(await service.readLatestCompletion({ sessionId }), null);
});

test("remote Claude transcript reads the registered host history", async () => {
  const cwd = "/workspace/remote";
  const sessionId = "ffffffff-ffff-4fff-8fff-ffffffffffff";
  const remotePath = `/home/demo/.claude/projects/${encodeClaudeProjectDirectory(cwd)}/${sessionId}.jsonl`;
  const file = Buffer.from(
    `${JSON.stringify({
      type: "user",
      uuid: "remote-user",
      timestamp: "2026-09-23T05:00:00.000Z",
      sessionId,
      cwd,
      message: { content: "远端问题" },
    })}\n${JSON.stringify({
      type: "assistant",
      uuid: "remote-assistant",
      timestamp: "2026-09-23T05:00:01.000Z",
      sessionId,
      cwd,
      message: { content: [{ type: "text", text: "远端完成" }] },
    })}\n`,
  );
  const service = new ClaudeTranscriptService({
    remoteFileAccess: {
      async resolveRemotePath(_target, inputPath) {
        return inputPath.replace(/^~/, "/home/demo");
      },
      async listRecursive(_target, inputPath) {
        if (inputPath === "/home/demo/.claude/sessions") {
          return [];
        }
        if (
          inputPath ===
          `/home/demo/.claude/projects/${encodeClaudeProjectDirectory(cwd)}`
        ) {
          return [
            {
              path: remotePath,
              size: file.length,
              modifiedAt: "2026-09-23T05:00:01.000Z",
            },
          ];
        }
        return [];
      },
      async readRange(_target, path, offset, length) {
        assert.equal(path, remotePath);
        return {
          path,
          size: file.length,
          buffer: file.subarray(offset, offset + length),
        };
      },
    },
  });

  const page = await service.readRemote({
    sshTarget: { host: "remote.example", port: 22 },
    workingDirectory: cwd,
  });

  assert.equal(page.available, true);
  assert.equal(page.agentKind, "claude");
  assert.equal(page.sessionId, sessionId);
  assert.deepEqual(
    page.entries.map((entry) => entry.text),
    ["远端问题", "远端完成"],
  );
});
