import assert from "node:assert/strict";
import test from "node:test";
import type {
  AgentSessionRecord,
  AgentTranscriptResponse,
} from "@agent-orchestrator/shared";
import { FeishuWorkspaceTranscript } from "./feishu-workspace-transcript.js";

const session = {
  id: "s1",
  workingDirectory: "/project",
} as AgentSessionRecord;
const page = (
  text: string,
  more = false,
  agentKind: "codex" | "claude" = "codex",
  sessionId = "thread-123",
): AgentTranscriptResponse => ({
  available: true,
  agentKind,
  sessionId,
  matchedBy: "session-id",
  updatedAt: null,
  entries: [
    {
      id: text,
      kind: "assistant",
      timestamp: "2026-09-09",
      title: "Codex",
      text,
      collapsedByDefault: false,
    },
    {
      id: "secret",
      kind: "tool",
      timestamp: "",
      title: "exec",
      text: "private tool output",
      collapsedByDefault: true,
    },
    {
      id: "internal",
      kind: "user",
      timestamp: "",
      title: "internal",
      text: "hidden continuation",
      collapsedByDefault: false,
      internal: true,
    },
  ],
  hasMore: more,
  nextCursor: more ? "older" : null,
});

test("reads exact thread only and strips tool/internal entries", async () => {
  const calls: unknown[] = [];
  const service = new FeishuWorkspaceTranscript({
    read: (input) => {
      calls.push(input);
      return page("recent");
    },
    readRemote: async () => page("remote"),
  });
  const result = await service.read(session, "thread-123");
  assert.deepEqual(calls, [{ sessionId: "thread-123", limit: 5 }]);
  assert.deepEqual(
    result.entries.map((e) => e.text),
    ["recent"],
  );
  const remote = await service.read(
    { ...session, sshTarget: { host: "host" } },
    "thread-123",
  );
  assert.equal(remote.entries[0].text, "remote");
});

test("exports complete human conversation in chronological page order without tools", async () => {
  const service = new FeishuWorkspaceTranscript({
    read: (input) => page(input.cursor ? "old" : "new", !input.cursor),
    readRemote: async () => page("remote"),
  });
  const result = await service.export(session, "thread-123");
  assert.equal(result.name, "codex-thread-123.md");
  const text = result.data.toString();
  assert.ok(text.indexOf("old") < text.indexOf("new"));
  assert.doesNotMatch(text, /private tool|hidden continuation/);
});

test("reads and exports Claude records from the optional Claude source", async () => {
  const claudeSessionId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
  const codexCalls: unknown[] = [];
  const claudeCalls: unknown[] = [];
  const service = new FeishuWorkspaceTranscript(
    {
      read: (input) => {
        codexCalls.push(input);
        return page("codex");
      },
      readRemote: async () => page("remote-codex"),
    },
    {
      read: (input) => {
        claudeCalls.push(input);
        return page("claude", false, "claude", claudeSessionId);
      },
      readRemote: async () =>
        page("remote-claude", false, "claude", claudeSessionId),
    },
  );

  const result = await service.read(
    session,
    claudeSessionId,
    undefined,
    "claude",
  );
  assert.deepEqual(codexCalls, []);
  assert.deepEqual(claudeCalls, [{ sessionId: claudeSessionId, limit: 5 }]);
  assert.equal(result.entries[0].text, "claude");

  const exported = await service.export(session, claudeSessionId, "claude");
  assert.equal(exported.name, `claude-${claudeSessionId}.md`);
  assert.match(exported.data.toString(), /Claude/);
});

test("remote Claude records retain the bound session location", async () => {
  const claudeSessionId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
  const remoteSession = {
    ...session,
    sshTarget: { host: "remote.example" },
    transportRef: { tmuxSession: "claude-work", tmuxPane: "%9" },
  } as AgentSessionRecord;
  const remoteInputs: unknown[] = [];
  const service = new FeishuWorkspaceTranscript(
    {
      read: () => page("codex"),
      readRemote: async () => page("remote-codex"),
    },
    {
      read: () => page("local-claude", false, "claude", claudeSessionId),
      readRemote: async (input) => {
        remoteInputs.push(input);
        return page("remote-claude", false, "claude", claudeSessionId);
      },
    },
  );

  await service.read(remoteSession, claudeSessionId, undefined, "claude");
  await service.export(remoteSession, claudeSessionId, "claude");
  assert.deepEqual(remoteInputs, [
    {
      sessionId: claudeSessionId,
      limit: 5,
      workingDirectory: "/project",
      tmuxSession: "claude-work",
      tmuxPane: "%9",
      sshTarget: remoteSession.sshTarget,
    },
    {
      sessionId: claudeSessionId,
      limit: 100,
      workingDirectory: "/project",
      tmuxSession: "claude-work",
      tmuxPane: "%9",
      sshTarget: remoteSession.sshTarget,
    },
  ]);
});

test("rejects stale Claude records that do not match the requested UUID", async () => {
  const claudeSessionId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
  const service = new FeishuWorkspaceTranscript(
    {
      read: () => page("codex"),
      readRemote: async () => page("remote-codex"),
    },
    {
      read: () =>
        page(
          "wrong claude",
          false,
          "claude",
          "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
        ),
      readRemote: async () =>
        page("remote-claude", false, "claude", claudeSessionId),
    },
  );

  await assert.rejects(
    service.read(session, claudeSessionId, undefined, "claude"),
    /Claude/,
  );
});

test("rejects mismatched identity, stalled cursors and oversize exports rather than silently truncate", async () => {
  for (const read of [
    () => ({ ...page("wrong"), sessionId: "other-thread" }),
    () => page("repeated", true),
    () => page("a".repeat(10 * 1024 * 1024 + 1)),
  ]) {
    const service = new FeishuWorkspaceTranscript({
      read,
      readRemote: async () => page("remote"),
    });
    await assert.rejects(service.export(session, "thread-123"));
  }
});
