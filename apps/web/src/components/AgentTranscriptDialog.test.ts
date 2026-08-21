import assert from "node:assert/strict";
import test from "node:test";

import type { AgentTranscriptResponse } from "@agent-orchestrator/shared";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import {
  AGENT_TRANSCRIPT_PAGE_SIZE,
  AgentTranscriptEntries,
  mergeTranscriptPage,
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
    hasMore: false,
    nextCursor: null,
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

test("transcript entries render one server page and offer manual continuation", () => {
  const transcript: AgentTranscriptResponse = {
    available: true,
    agentKind: "codex",
    sessionId: "codex-long",
    matchedBy: "session-id",
    updatedAt: "2026-08-18T01:00:00.000Z",
    hasMore: true,
    nextCursor: "4096",
    entries: Array.from({ length: AGENT_TRANSCRIPT_PAGE_SIZE }, (_, index) => ({
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

  assert.match(markup, /data-transcript-entry-id="message-30"/);
  assert.match(markup, /data-transcript-entry-id="message-1"/);
  assert.equal((markup.match(/data-transcript-entry-id=/g) ?? []).length, 30);
  assert.match(markup, /已加载 30 条/);
  assert.match(markup, />继续加载</);
});

test("lightweight transcript window keeps the newly loaded older records bounded", () => {
  const page = (start: number, count: number): AgentTranscriptResponse => ({
    available: true,
    agentKind: "codex",
    sessionId: "codex-long",
    matchedBy: "session-id",
    updatedAt: "2026-08-18T01:00:00.000Z",
    hasMore: start > 1,
    nextCursor: start > 1 ? String(start * 100) : null,
    entries: Array.from({ length: count }, (_, index) => ({
      id: `message-${start + index}`,
      timestamp: "2026-08-18T00:00:00.000Z",
      kind: "assistant" as const,
      title: "Codex",
      text: `message body ${start + index}`,
      collapsedByDefault: false,
    })),
  });

  const newest = page(91, 30);
  const merged = mergeTranscriptPage(newest, page(61, 30), 90);
  const bounded = mergeTranscriptPage(merged, page(31, 30), 90);
  const shifted = mergeTranscriptPage(bounded, page(1, 30), 90);

  assert.deepEqual(
    shifted.entries.map((entry) => entry.id),
    Array.from({ length: 90 }, (_, index) => `message-${index + 1}`),
  );
  assert.equal(
    shifted.entries.some((entry) => entry.id === "message-120"),
    false,
  );
  assert.equal(shifted.hasMore, false);
  assert.equal(shifted.nextCursor, null);
});
