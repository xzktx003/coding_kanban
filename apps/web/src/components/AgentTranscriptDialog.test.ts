import assert from "node:assert/strict";
import test from "node:test";

import type { AgentTranscriptResponse } from "@agent-orchestrator/shared";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import {
  AgentTranscriptEntries,
  getNextTranscriptVisibleCount,
} from "./AgentTranscriptDialog.js";

test("transcript entries hide exec calls and outputs while showing visible records newest first", () => {
  const middle = Array.from(
    { length: 50 },
    (_, index) => `middle-${index + 1}`,
  ).join("\n");
  const transcript: AgentTranscriptResponse = {
    available: true,
    agentKind: "codex",
    sessionId: "codex-1",
    matchedBy: "working-directory",
    updatedAt: "2026-08-13T01:00:00.000Z",
    entries: [
      {
        id: "user-markdown",
        timestamp: "2026-08-13T00:59:59.000Z",
        kind: "user",
        title: "你",
        text: "# Request\n\n- keep this readable",
        collapsedByDefault: false,
      },
      {
        id: "before",
        timestamp: "2026-08-13T01:00:00.000Z",
        kind: "assistant",
        title: "Codex",
        text: "before",
        collapsedByDefault: false,
      },
      {
        id: "exec-request",
        timestamp: "2026-08-13T01:00:00.500Z",
        kind: "tool",
        title: "exec 调用",
        text: "hidden command",
        collapsedByDefault: true,
      },
      {
        id: "middle",
        timestamp: "2026-08-13T01:00:01.000Z",
        kind: "tool",
        title: "exec 输出",
        text: middle,
        collapsedByDefault: true,
      },
      {
        id: "visible-tool-output",
        timestamp: "2026-08-13T01:00:01.500Z",
        kind: "tool",
        title: "apply_patch 输出",
        text: "visible tool output",
        collapsedByDefault: true,
      },
      {
        id: "after",
        timestamp: "2026-08-13T01:00:02.000Z",
        kind: "assistant",
        title: "Codex",
        text: "after",
        collapsedByDefault: false,
      },
    ],
  };

  const markup = renderToStaticMarkup(
    createElement(AgentTranscriptEntries, {
      terminalFontSize: 18,
      transcript,
    }),
  );

  assert.ok(
    markup.indexOf('data-transcript-entry-id="after"') <
      markup.indexOf('data-transcript-entry-id="visible-tool-output"'),
  );
  assert.ok(
    markup.indexOf('data-transcript-entry-id="visible-tool-output"') <
      markup.indexOf('data-transcript-entry-id="before"'),
  );
  assert.doesNotMatch(markup, /exec 调用/);
  assert.doesNotMatch(markup, /exec 输出/);
  assert.doesNotMatch(markup, /hidden command/);
  assert.doesNotMatch(markup, /middle-1/);
  assert.match(markup, /按工作目录匹配/);
  assert.match(markup, /<details/);
  assert.equal(
    (markup.match(/data-transcript-rendering="markdown"/g) ?? []).length,
    3,
  );
  assert.equal(
    (markup.match(/data-transcript-rendering="text"/g) ?? []).length,
    1,
  );
  assert.match(
    markup,
    /data-transcript-rendering="text"[^>]*>visible tool output<\/pre>/,
  );
  assert.match(markup, /style="--agent-transcript-font-size:18px"/);
});

test("transcript entries initially stop after one batch and offer manual continuation", () => {
  const transcript: AgentTranscriptResponse = {
    available: true,
    agentKind: "codex",
    sessionId: "codex-long",
    matchedBy: "session-id",
    updatedAt: "2026-08-18T01:00:00.000Z",
    entries: Array.from({ length: 65 }, (_, index) => ({
      id: `message-${index + 1}`,
      timestamp: `2026-08-18T00:00:${String(index).padStart(2, "0")}.000Z`,
      kind: "assistant" as const,
      title: "Codex",
      text: `message body ${index + 1}`,
      collapsedByDefault: false,
    })),
  };

  const markup = renderToStaticMarkup(
    createElement(AgentTranscriptEntries, { transcript }),
  );

  assert.match(markup, /data-transcript-entry-id="message-65"/);
  assert.match(markup, /data-transcript-entry-id="message-36"/);
  assert.doesNotMatch(markup, /data-transcript-entry-id="message-35"/);
  assert.equal((markup.match(/data-transcript-entry-id=/g) ?? []).length, 30);
  assert.match(markup, /已显示 30 \/ 65 条/);
  assert.match(markup, />继续加载</);
  assert.equal(getNextTranscriptVisibleCount(30, 65), 60);
  assert.equal(getNextTranscriptVisibleCount(60, 65), 65);
});
