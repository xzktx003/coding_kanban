import assert from "node:assert/strict";
import {
  mkdirSync,
  mkdtempSync,
  rmSync,
  symlinkSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import type {
  AgentSessionRecord,
  ListAgentSessionsResponse,
} from "@agent-orchestrator/shared";

import {
  AgentCompletionFeishuNotifier,
  type FeishuCompletionEvent,
} from "./agent-completion-feishu-notifier.js";
import { CodexCompletionContentResolver } from "./codex-completion-content-resolver.js";
import { CodexSessionLocator } from "./codex-session-locator.js";
import { CodexTranscriptService } from "./codex-transcript-service.js";

class SnapshotSource {
  #listener: ((snapshot: ListAgentSessionsResponse) => void) | null = null;

  constructor(private snapshot: ListAgentSessionsResponse) {}

  subscribe(listener: (snapshot: ListAgentSessionsResponse) => void) {
    this.#listener = listener;
    listener(this.snapshot);
    return () => {
      this.#listener = null;
    };
  }

  emitSession(session: AgentSessionRecord): void {
    this.snapshot = {
      ...this.snapshot,
      items: [session],
      updatedAt: new Date().toISOString(),
    };
    this.#listener?.(this.snapshot);
  }
}

async function waitFor(
  check: () => boolean,
  message: string,
  timeoutMs = 1000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!check()) {
    assert.ok(Date.now() < deadline, message);
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

function writeCodexSession(
  sessionsRoot: string,
  name: string,
  id: string,
  cwd: string,
  payloadTimestamp: string,
  events: Array<{ turnId: string; content: string; timestamp: string }> = [],
): string {
  const path = join(sessionsRoot, `${name}.jsonl`);
  const lines = [
    JSON.stringify({
      timestamp: "2026-10-12T15:30:00.000Z",
      type: "session_meta",
      payload: {
        id,
        cwd,
        source: "vscode",
        timestamp: payloadTimestamp,
      },
    }),
    ...events.map((event) =>
      JSON.stringify({
        timestamp: event.timestamp,
        type: "event_msg",
        payload: {
          type: "task_complete",
          turn_id: event.turnId,
          last_agent_message: event.content,
        },
      }),
    ),
  ];
  writeFileSync(path, `${lines.join("\n")}\n`);
  return path;
}

function appendTaskComplete(
  path: string,
  event: { turnId: string; content: string; timestamp: string },
): void {
  writeFileSync(
    path,
    `${JSON.stringify({
      timestamp: event.timestamp,
      type: "event_msg",
      payload: {
        type: "task_complete",
        turn_id: event.turnId,
        last_agent_message: event.content,
      },
    })}\n`,
    { flag: "a" },
  );
}

function exposeProcess(
  procRoot: string,
  processId: number,
  input: {
    children?: string;
    cmdline?: string;
    cwd?: string;
    startedAtMs?: number;
  } = {},
): void {
  const processRoot = join(procRoot, String(processId));
  mkdirSync(join(processRoot, "task", String(processId)), { recursive: true });
  writeFileSync(
    join(processRoot, "task", String(processId), "children"),
    input.children ?? "",
  );
  if (input.cmdline !== undefined) {
    writeFileSync(join(processRoot, "cmdline"), input.cmdline);
  }
  if (input.cwd) {
    symlinkSync(input.cwd, join(processRoot, "cwd"));
  }
  if (input.startedAtMs !== undefined) {
    const startedSeconds = input.startedAtMs / 1000;
    utimesSync(processRoot, startedSeconds, startedSeconds);
  }
}

function makeNodeTmuxSession(
  interactionState: AgentSessionRecord["interactionState"],
  lastOutputAt: string,
): AgentSessionRecord {
  return {
    id: "kanban-terminal-1",
    workspaceId: "default",
    sourceType: "local",
    agentKind: "node",
    displayName: "xh2modelzoo Codex",
    workingDirectory: "/workspace/xh2modelzoo",
    connectionState: "online",
    interactionState,
    lastOutputAt,
    transportRef: {
      tmuxSession: "xh2modelzoo-terminal",
      tmuxPane: "%291",
      processId: 601,
    },
  };
}

test("terminal Codex completion notification recovers a launch-born thread without a rollout handle", async () => {
  const root = mkdtempSync(join(tmpdir(), "terminal-codex-completion-"));
  const sessionsRoot = join(root, "sessions");
  const procRoot = join(root, "proc");
  const snapshotsRoot = join(root, "no-snapshots");
  mkdirSync(sessionsRoot, { recursive: true });

  const startedAtMs = Date.parse("2026-10-12T15:00:00.000Z");
  exposeProcess(procRoot, 601, { children: "602" });
  exposeProcess(procRoot, 602, {
    cmdline: "/usr/local/bin/codex\0--yolo\0",
    cwd: "/workspace/xh2modelzoo",
    startedAtMs,
  });

  const selectedPath = writeCodexSession(
    sessionsRoot,
    "selected",
    "codex-selected-thread",
    "/workspace/xh2modelzoo",
    "2026-10-12T15:00:02.000Z",
    [
      {
        turnId: "turn-old",
        content: "旧完成，只用于建立 baseline",
        timestamp: "2026-10-12T15:01:00.000Z",
      },
    ],
  );
  writeCodexSession(
    sessionsRoot,
    "old-history",
    "codex-old-history",
    "/workspace/xh2modelzoo",
    "2026-10-12T14:00:00.000Z",
  );
  writeCodexSession(
    sessionsRoot,
    "later-history",
    "codex-later-history",
    "/workspace/xh2modelzoo",
    "2026-10-12T16:30:00.000Z",
  );
  writeCodexSession(
    sessionsRoot,
    "other-directory",
    "codex-other-directory",
    "/workspace/other",
    "2026-10-12T15:00:01.000Z",
  );

  const session = makeNodeTmuxSession("running", "2026-10-12T15:01:00.000Z");
  const source = new SnapshotSource({
    items: [session],
    activeAgentSessionId: session.id,
    updatedAt: "2026-10-12T15:01:00.000Z",
  });
  let registryUpdates = 0;
  const locator = new CodexSessionLocator({
    procRoot,
    sessionsRoot,
    shellSnapshotsRoot: snapshotsRoot,
    resolveTmuxPanePid: async () => 601,
    listTmuxPanes: async () => [
      {
        paneId: "%291",
        processId: 601,
        workingDirectory: "/workspace/xh2modelzoo",
      },
    ],
  });
  const transcriptService = new CodexTranscriptService({ sessionsRoot });
  const registry = {
    get: () => session,
    updateSession: () => {
      registryUpdates += 1;
      return session;
    },
  };
  const realResolver = new CodexCompletionContentResolver({
    registry,
    codexSessionLocator: locator,
    codexTranscriptService: transcriptService,
  });
  let inspections = 0;
  const resolver = {
    resolve: realResolver.resolve.bind(realResolver),
    inspectLatestCompletion:
      realResolver.inspectLatestCompletion.bind(realResolver),
    inspectLatestCompletions: async (event: FeishuCompletionEvent) => {
      inspections += 1;
      return realResolver.inspectLatestCompletions(event);
    },
  };
  const sent: FeishuCompletionEvent[] = [];
  const stop = new AgentCompletionFeishuNotifier({
    source,
    settings: {
      get: () => ({ configured: true, enabled: true }),
    },
    contentResolver: resolver,
    structuredCompletionProbeDelayMs: 0,
    structuredCompletionProbeIntervalMs: 0,
    sender: {
      send: async (event) => {
        sent.push(event);
        return {
          messages: [{ messageId: "fake-message", chatId: "fake-chat" }],
        };
      },
    },
  }).start();

  try {
    assert.deepEqual(
      await locator.resolveTmuxPanes("xh2modelzoo-terminal"),
      [],
    );
    await waitFor(
      () => inspections === 1 && sent.length === 0 && registryUpdates === 0,
      "startup baseline was not established without notifying",
    );

    appendTaskComplete(selectedPath, {
      turnId: "turn-new",
      content: "最新完成内容：已经同步并修复通知。",
      timestamp: "2026-10-12T15:02:00.000Z",
    });
    source.emitSession(
      makeNodeTmuxSession("running", "2026-10-12T15:02:00.000Z"),
    );

    await waitFor(() => sent.length === 1, "completion was not notified");
    assert.deepEqual(
      await locator.resolveTmuxPanes("xh2modelzoo-terminal", {
        readOnlyCompletion: true,
      }),
      [
        {
          paneId: "%291",
          sessionId: "codex-selected-thread",
          workingDirectory: "/workspace/xh2modelzoo",
        },
      ],
    );
    assert.equal(sent[0]?.sessionId, "kanban-terminal-1");
    assert.equal(sent[0]?.displayName, "xh2modelzoo Codex");
    assert.equal(sent[0]?.agentKind, "codex");
    assert.equal(sent[0]?.codexThreadId, "codex-selected-thread");
    assert.equal(sent[0]?.transcriptAgentKind, "codex");
    assert.equal(sent[0]?.transcriptSessionId, "codex-selected-thread");
    assert.equal(sent[0]?.completionId, "turn-new");
    assert.equal(sent[0]?.summary, "最新完成内容：已经同步并修复通知。");
    assert.equal(sent[0]?.completedAt, "2026-10-12T15:02:00.000Z");
    assert.equal(registryUpdates, 0);

    source.emitSession(
      makeNodeTmuxSession("running", "2026-10-12T15:02:00.000Z"),
    );
    source.emitSession(makeNodeTmuxSession("idle", "2026-10-12T15:02:00.000Z"));
    await new Promise((resolve) => setTimeout(resolve, 20));
    assert.equal(sent.length, 1);

    stop();
    appendTaskComplete(selectedPath, {
      turnId: "turn-after-stop",
      content: "停止后不应发送",
      timestamp: "2026-10-12T15:03:00.000Z",
    });
    source.emitSession(
      makeNodeTmuxSession("running", "2026-10-12T15:03:00.000Z"),
    );
    await new Promise((resolve) => setTimeout(resolve, 20));
    assert.equal(sent.length, 1);
  } finally {
    stop();
    rmSync(root, { recursive: true, force: true });
  }
});
