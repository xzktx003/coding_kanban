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
  parseCodexTranscript,
  summarizeCodexTranscript,
} from "./codex-transcript-service.js";

function line(value: unknown): string {
  return `${JSON.stringify(value)}\n`;
}

test("parseCodexTranscript hides exec calls and their associated output", () => {
  const expectedLines = Array.from(
    { length: 100 },
    (_, index) => `output-${index + 1}`,
  ).join("\n");
  const transcript = [
    line({
      timestamp: "2026-08-13T01:00:00.000Z",
      type: "response_item",
      payload: {
        type: "message",
        id: "user-1",
        role: "user",
        content: [{ type: "input_text", text: "run it" }],
      },
    }),
    line({
      timestamp: "2026-08-13T01:00:01.000Z",
      type: "response_item",
      payload: {
        type: "custom_tool_call",
        name: "exec",
        call_id: "call-1",
        input: "do work",
      },
    }),
    line({
      timestamp: "2026-08-13T01:00:02.000Z",
      type: "response_item",
      payload: {
        type: "custom_tool_call_output",
        call_id: "call-1",
        output: [{ type: "input_text", text: expectedLines }],
      },
    }),
    line({
      timestamp: "2026-08-13T01:00:03.000Z",
      type: "response_item",
      payload: {
        type: "message",
        id: "assistant-1",
        role: "assistant",
        content: [{ type: "output_text", text: "finished" }],
      },
    }),
  ].join("");

  const entries = parseCodexTranscript(transcript);

  assert.deepEqual(
    entries.map((entry) => entry.kind),
    ["user", "assistant"],
  );
  assert.equal(
    entries.some((entry) => entry.title.startsWith("exec ")),
    false,
  );
  assert.equal(
    entries.some((entry) => entry.text.includes("output-1")),
    false,
  );
});

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
