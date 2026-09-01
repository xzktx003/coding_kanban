import assert from "node:assert/strict";
import {
  mkdtempSync,
  mkdirSync,
  rmSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  CodexTranscriptService,
  summarizeCodexTranscript,
} from "./codex-transcript-service.js";

function line(value: unknown): string {
  return `${JSON.stringify(value)}\n`;
}

test("summarizeCodexTranscript extracts the latest user and assistant messages without an LLM", () => {
  const summary = summarizeCodexTranscript([
    {
      id: "user-1",
      timestamp: "",
      kind: "user",
      title: "你",
      text: "先检查项目",
      collapsedByDefault: false,
    },
    {
      id: "assistant-1",
      timestamp: "",
      kind: "assistant",
      title: "Codex",
      text: "项目检查完成，发现了一个问题。\n\n请确认是否继续。",
      collapsedByDefault: false,
    },
    {
      id: "user-2",
      timestamp: "",
      kind: "user",
      title: "你",
      text: "修复这个问题并运行测试",
      collapsedByDefault: false,
    },
  ]);

  assert.deepEqual(summary, {
    lastUserMessageSummary: "修复这个问题并运行测试",
    lastAgentMessageSummary: "项目检查完成，发现了一个问题。 请确认是否继续。",
  });
});

test("CodexTranscriptService selects the newest session with the same working directory", () => {
  const root = mkdtempSync(join(tmpdir(), "codex-transcript-"));
  const sessionsRoot = join(root, "sessions", "2026", "08", "13");
  mkdirSync(sessionsRoot, { recursive: true });

  const createSession = (
    name: string,
    id: string,
    cwd: string,
    timestamp: string,
    message: string,
  ) => {
    const path = join(sessionsRoot, name);
    writeFileSync(
      path,
      [
        line({
          timestamp,
          type: "session_meta",
          payload: { id, cwd },
        }),
        line({
          timestamp,
          type: "response_item",
          payload: {
            type: "message",
            id: `${id}-message`,
            role: "assistant",
            content: [{ type: "output_text", text: message }],
          },
        }),
      ].join(""),
    );
    return path;
  };

  const older = createSession(
    "rollout-old.jsonl",
    "old-session",
    "/workspace/project",
    "2026-08-13T01:00:00.000Z",
    "old",
  );
  const newer = createSession(
    "rollout-new.jsonl",
    "new-session",
    "/workspace/project",
    "2026-08-13T02:00:00.000Z",
    "new",
  );
  createSession(
    "rollout-other.jsonl",
    "other-session",
    "/workspace/other",
    "2026-08-13T03:00:00.000Z",
    "other",
  );
  const now = Date.now() / 1000;
  // Selection uses file activity, matching how an active Codex JSONL grows.
  utimesSync(older, now - 20, now - 20);
  utimesSync(newer, now - 10, now - 10);

  try {
    const response = new CodexTranscriptService({
      sessionsRoot: join(root, "sessions"),
    }).read({ workingDirectory: "/workspace/project" });

    assert.equal(response.available, true);
    assert.equal(response.sessionId, "new-session");
    assert.equal(response.matchedBy, "working-directory");
    assert.equal(response.entries.at(-1)?.text, "new");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("CodexTranscriptService reads the latest task_complete event as one exact turn completion", () => {
  const root = mkdtempSync(join(tmpdir(), "codex-turn-completion-"));
  const sessionsRoot = join(root, "sessions", "2026", "09", "01");
  const sessionId = "turn-completion-session";
  mkdirSync(sessionsRoot, { recursive: true });
  writeFileSync(
    join(sessionsRoot, `rollout-${sessionId}.jsonl`),
    [
      line({
        timestamp: "2026-09-01T10:00:00.000Z",
        type: "session_meta",
        payload: { id: sessionId, cwd: "/workspace/turn-completion" },
      }),
      line({
        timestamp: "2026-09-01T10:00:05.000Z",
        type: "event_msg",
        payload: {
          type: "task_complete",
          turn_id: "turn-one",
          last_agent_message: "第一条完整回答",
        },
      }),
      line({
        timestamp: "2026-09-01T10:00:06.000Z",
        type: "event_msg",
        payload: { type: "task_started", turn_id: "turn-two" },
      }),
      line({
        timestamp: "2026-09-01T10:00:08.000Z",
        type: "event_msg",
        payload: {
          type: "task_complete",
          turn_id: "turn-two",
          last_agent_message: "第二条完整回答\n\n保留换行与缩进",
        },
      }),
    ].join(""),
  );

  try {
    const completion = new CodexTranscriptService({
      sessionsRoot: join(root, "sessions"),
    }).readLatestCompletion({ sessionId });

    assert.deepEqual(completion, {
      completionId: "turn-two",
      content: "第二条完整回答\n\n保留换行与缩进",
      completedAt: "2026-09-01T10:00:08.000Z",
    });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("CodexTranscriptService reads transcript pages backward from a byte cursor", () => {
  const root = mkdtempSync(join(tmpdir(), "codex-transcript-page-"));
  const sessionsRoot = join(root, "sessions", "2026", "08", "21");
  const sessionId = "paged-session";
  const path = join(sessionsRoot, `rollout-${sessionId}.jsonl`);
  mkdirSync(sessionsRoot, { recursive: true });
  writeFileSync(
    path,
    [
      line({
        timestamp: "2026-08-21T00:00:00.000Z",
        type: "session_meta",
        payload: { id: sessionId, cwd: "/workspace/paged" },
      }),
      ...Array.from({ length: 75 }, (_, index) =>
        line({
          timestamp: `2026-08-21T00:00:${String(index).padStart(2, "0")}.000Z`,
          type: "response_item",
          payload: {
            type: "message",
            id: `message-${index + 1}`,
            role: "assistant",
            content: [
              {
                type: "output_text",
                text:
                  index === 39
                    ? `message ${index + 1} ${"x".repeat(70 * 1024)}`
                    : `message ${index + 1}`,
              },
            ],
          },
        }),
      ),
    ].join(""),
  );

  try {
    const service = new CodexTranscriptService({
      sessionsRoot: join(root, "sessions"),
    });
    const newest = service.read({ sessionId, limit: 30 });
    const middle = service.read({
      sessionId,
      limit: 30,
      cursor: newest.nextCursor ?? undefined,
    });
    const oldest = service.read({
      sessionId,
      limit: 30,
      cursor: middle.nextCursor ?? undefined,
    });

    assert.deepEqual(
      newest.entries.map((entry) => entry.id),
      Array.from({ length: 30 }, (_, index) => `message-${index + 46}`),
    );
    assert.equal(newest.hasMore, true);
    assert.match(newest.nextCursor ?? "", /^\d+$/);
    assert.deepEqual(
      middle.entries.map((entry) => entry.id),
      Array.from({ length: 30 }, (_, index) => `message-${index + 16}`),
    );
    assert.equal(middle.hasMore, true);
    assert.equal(middle.entries[24]?.text.startsWith("message 40 "), true);
    assert.deepEqual(
      oldest.entries.map((entry) => entry.id),
      Array.from({ length: 15 }, (_, index) => `message-${index + 1}`),
    );
    assert.equal(oldest.hasMore, false);
    assert.equal(oldest.nextCursor, null);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("CodexTranscriptService keeps exec calls hidden while filling a page", () => {
  const root = mkdtempSync(join(tmpdir(), "codex-transcript-exec-page-"));
  const sessionsRoot = join(root, "sessions", "2026", "08", "21");
  const sessionId = "exec-page-session";
  mkdirSync(sessionsRoot, { recursive: true });
  writeFileSync(
    join(sessionsRoot, `rollout-${sessionId}.jsonl`),
    [
      line({
        timestamp: "2026-08-21T00:00:00.000Z",
        type: "session_meta",
        payload: { id: sessionId, cwd: "/workspace/exec-page" },
      }),
      ...Array.from({ length: 29 }, (_, index) =>
        line({
          timestamp: "2026-08-21T00:00:01.000Z",
          type: "response_item",
          payload: {
            type: "message",
            id: `message-${index + 1}`,
            role: "assistant",
            content: [{ type: "output_text", text: `message ${index + 1}` }],
          },
        }),
      ),
      line({
        timestamp: "2026-08-21T00:01:00.000Z",
        type: "response_item",
        payload: {
          type: "custom_tool_call",
          name: "exec",
          call_id: "hidden-exec",
          input: "large command",
        },
      }),
      line({
        timestamp: "2026-08-21T00:01:01.000Z",
        type: "response_item",
        payload: {
          type: "custom_tool_call_output",
          call_id: "hidden-exec",
          output: "large output",
        },
      }),
      line({
        timestamp: "2026-08-21T00:01:02.000Z",
        type: "response_item",
        payload: {
          type: "message",
          id: "message-30",
          role: "assistant",
          content: [{ type: "output_text", text: "message 30" }],
        },
      }),
    ].join(""),
  );

  try {
    const response = new CodexTranscriptService({
      sessionsRoot: join(root, "sessions"),
    }).read({ sessionId, limit: 30 });

    assert.equal(response.entries.length, 30);
    assert.equal(
      response.entries.some((entry) => entry.title.startsWith("exec ")),
      false,
    );
    assert.equal(
      response.entries.some((entry) => entry.text.includes("large output")),
      false,
    );
    assert.equal(response.hasMore, false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("CodexTranscriptService reads a remote Codex JSONL session by working directory", async () => {
  const remoteRoot = "/home/demo/.codex/sessions/2026/08/25";
  const olderPath = `${remoteRoot}/rollout-older.jsonl`;
  const newerPath = `${remoteRoot}/rollout-newer.jsonl`;
  const olderContent = Buffer.from(
    [
      line({
        timestamp: "2026-08-25T01:00:00.000Z",
        type: "session_meta",
        payload: { id: "remote-older", cwd: "/home/demo/project" },
      }),
      line({
        timestamp: "2026-08-25T01:00:01.000Z",
        type: "response_item",
        payload: {
          type: "message",
          id: "older-message",
          role: "assistant",
          content: [{ type: "output_text", text: "older" }],
        },
      }),
    ].join(""),
  );
  const newerContent = Buffer.from(
    [
      line({
        timestamp: "2026-08-25T02:00:00.000Z",
        type: "session_meta",
        payload: { id: "remote-newer", cwd: "/home/demo/project" },
      }),
      line({
        timestamp: "2026-08-25T02:00:01.000Z",
        type: "response_item",
        payload: {
          type: "message",
          id: "remote-message",
          role: "assistant",
          content: [{ type: "output_text", text: "remote history" }],
        },
      }),
      line({
        timestamp: "2026-08-25T02:00:02.000Z",
        type: "event_msg",
        payload: {
          type: "task_complete",
          turn_id: "remote-turn",
          last_agent_message: "remote history",
        },
      }),
    ].join(""),
  );
  const contents = new Map([
    [olderPath, olderContent],
    [newerPath, newerContent],
  ]);
  const remoteAccess = {
    async resolveRemotePath(
      _target: unknown,
      inputPath: string,
    ): Promise<string> {
      return inputPath === "~/project"
        ? "/home/demo/project"
        : "/home/demo/.codex/sessions";
    },
    async listRecursive() {
      return [
        {
          path: olderPath,
          size: olderContent.length,
          modifiedAt: "2026-08-25T01:00:01.000Z",
        },
        {
          path: newerPath,
          size: newerContent.length,
          modifiedAt: "2026-08-25T02:00:01.000Z",
        },
      ];
    },
    async readRange(
      _target: unknown,
      path: string,
      offset: number,
      length: number,
    ) {
      const content = contents.get(path) ?? Buffer.alloc(0);
      return {
        path,
        size: content.length,
        buffer: content.subarray(offset, offset + length),
      };
    },
  };

  const response = await new CodexTranscriptService({
    remoteFileAccess: remoteAccess as never,
  }).readRemote({
    sshTarget: { host: "remote.example", username: "demo" },
    workingDirectory: "~/project",
  });

  assert.equal(response.available, true);
  assert.equal(response.sessionId, "remote-newer");
  assert.equal(response.matchedBy, "working-directory");
  assert.equal(response.entries.at(-1)?.text, "remote history");

  const completion = await new CodexTranscriptService({
    remoteFileAccess: remoteAccess as never,
  }).readLatestRemoteCompletion({
    sshTarget: { host: "remote.example", username: "demo" },
    workingDirectory: "~/project",
  });
  assert.deepEqual(completion, {
    completionId: "remote-turn",
    content: "remote history",
    completedAt: "2026-08-25T02:00:02.000Z",
  });
});
